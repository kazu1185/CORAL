<?php

namespace App\Services;

use PDO;

/**
 * 領収書・請求書の発行ビジネスロジック
 * DocumentController と CheckinController の両方から呼ばれる共通サービス
 *
 * 設計判断:
 * - 採番は年次連番（R-YYYY-NNNN）。UNIQUE制約で重複防止
 * - 分割発行: charge_ids を指定すると対象明細のみで発行
 * - グループ発行: 親予約IDを指定すると全子予約の明細をまとめる
 * - 宛名の直接入力時は guests.receipt_addressee に保存（次回のデフォルト値）
 */
class DocumentService
{
    /**
     * 領収書を発行する
     *
     * @param PDO $db
     * @param int $reservationId 予約ID
     * @param string $addressee 宛名
     * @param string $description 但し書き
     * @param int $staffId 発行スタッフID
     * @param int|null $paymentMethodId 決済方法ID
     * @param array|null $chargeIds 対象明細ID（null=全active明細、指定=分割発行）
     * @param bool $saveAddressee 宛名をゲストに保存するか
     * @return int 生成された documents.id
     */
    public function issueReceipt(
        PDO $db,
        int $reservationId,
        string $addressee,
        string $description,
        int $staffId,
        ?int $paymentMethodId = null,
        ?array $chargeIds = null,
        bool $saveAddressee = false
    ): int {
        // 予約の存在確認（room_type_nameは領収書明細の摘要に使う）
        $stmt = $db->prepare("
            SELECT r.id, r.guest_id, r.status, COALESCE(rt.type_name, r.room_type) AS room_type_name
            FROM reservations r
            LEFT JOIN room_types rt ON rt.type_code = r.room_type
            WHERE r.id = :id
        ");
        $stmt->execute(['id' => $reservationId]);
        $reservation = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$reservation) {
            throw new \RuntimeException('予約が見つかりません');
        }

        // 対象明細を取得
        // 領収書に含める種別: 宿泊料・キャンセル料・NS料・追加・割引
        // 含めない種別: payment（入金）・refund（返金）は費目ではなく決済の記録
        $charges = $this->getTargetCharges($db, $reservationId, $chargeIds);

        if (empty($charges)) {
            throw new \RuntimeException('領収書に含める明細がありません');
        }

        // 金額集計
        $totals = $this->calculateTotals($charges);

        // 採番
        $documentNumber = $this->generateDocumentNumber($db, 'receipt');

        // documents テーブルに INSERT
        $stmt = $db->prepare("
            INSERT INTO documents (document_number, type, reservation_id, addressee, description,
                subtotal, tax_amount, accommodation_tax, total, payment_method_id, issued_by)
            VALUES (:doc_number, 'receipt', :reservation_id, :addressee, :description,
                :subtotal, :tax_amount, :accommodation_tax, :total, :payment_method_id, :issued_by)
        ");
        $stmt->execute([
            'doc_number'        => $documentNumber,
            'reservation_id'    => $reservationId,
            'addressee'         => $addressee,
            'description'       => $description,
            'subtotal'          => $totals['subtotal'],
            'tax_amount'        => $totals['tax_amount'],
            'accommodation_tax' => $totals['accommodation_tax'],
            'total'             => $totals['total'],
            'payment_method_id' => $paymentMethodId,
            'issued_by'         => $staffId,
        ]);
        $documentId = (int) $db->lastInsertId();

        // document_items に各明細行を INSERT
        // tax_rate を持たせるのはインボイスの税率区分記載のため（NULL=10%扱い）
        $itemStmt = $db->prepare("
            INSERT INTO document_items (document_id, charge_id, date, description, quantity, unit_price, tax_amount, accommodation_tax, amount, tax_rate)
            VALUES (:document_id, :charge_id, :date, :description, 1, :unit_price, :tax_amount, :accommodation_tax, :amount, :tax_rate)
        ");
        foreach ($charges as $c) {
            // room行の摘要はプラン名（長い）ではなく部屋タイプ名に差し替える
            // goods行の摘要は「商品名 ×N」のままで良いので差し替えない（規約 #18）
            $desc = $c['charge_type'] === 'room'
                ? '宿泊（' . ($reservation['room_type_name'] ?? '客室') . '）'
                : $c['description'];
            $itemStmt->execute([
                'document_id'       => $documentId,
                'charge_id'         => $c['id'],
                'date'              => $c['date'],
                'description'       => $desc,
                'unit_price'        => $c['amount'],
                'tax_amount'        => $c['tax_amount'],
                'accommodation_tax' => $c['accommodation_tax'],
                'amount'            => $c['amount'],
                'tax_rate'          => $c['tax_rate'],   // 既存明細は NULL のまま（10%扱い）
            ]);
        }

        // 宛名をゲストに保存（直接入力の場合）
        if ($saveAddressee && $reservation['guest_id']) {
            $db->prepare("UPDATE guests SET receipt_addressee = :addr WHERE id = :gid")
               ->execute(['addr' => $addressee, 'gid' => $reservation['guest_id']]);
        }

        // イベント履歴を記録
        $chargeCount = count($charges);
        $isPartial = $chargeIds !== null;
        $summary = $isPartial
            ? "領収書発行（分割: {$chargeCount}件）"
            : "領収書発行";
        $db->prepare("
            INSERT INTO reservation_events (reservation_id, event_type, summary, detail, staff_id, event_at)
            VALUES (:rid, 'receipt_issued', :summary, :detail, :staff_id, NOW())
        ")->execute([
            'rid'      => $reservationId,
            'summary'  => $summary,
            'detail'   => "{$documentNumber} 宛名:{$addressee} 金額:{$totals['total']}円",
            'staff_id' => $staffId,
        ]);

        return $documentId;
    }

    /**
     * グループ予約（複数室）の領収書を一括発行
     * 親予約に紐づく全子予約の明細をまとめた1枚の領収書を発行する
     */
    public function issueGroupReceipt(
        PDO $db,
        int $parentReservationId,
        string $addressee,
        string $description,
        int $staffId,
        ?int $paymentMethodId = null,
        bool $saveAddressee = false
    ): int {
        // 親予約の確認
        $stmt = $db->prepare("SELECT id, guest_id, status FROM reservations WHERE id = :id");
        $stmt->execute(['id' => $parentReservationId]);
        $parent = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$parent) {
            throw new \RuntimeException('親予約が見つかりません');
        }

        // 子予約IDと部屋タイプを取得
        $stmt = $db->prepare("
            SELECT r.id, COALESCE(rt.type_name, r.room_type) AS room_type_name
            FROM reservations r
            LEFT JOIN room_types rt ON rt.type_code = r.room_type
            WHERE r.parent_reservation_id = :pid ORDER BY r.room_index
        ");
        $stmt->execute(['pid' => $parentReservationId]);
        $children = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (empty($children)) {
            throw new \RuntimeException('子予約が見つかりません');
        }

        // 全子予約の明細を取得（各子のroom_type_nameを付与）
        $allCharges = [];
        foreach ($children as $child) {
            $charges = $this->getTargetCharges($db, (int) $child['id']);
            // room行の摘要を部屋タイプ名に差し替えるための情報を付与
            foreach ($charges as &$c) {
                $c['_room_type_name'] = $child['room_type_name'];
            }
            unset($c);
            $allCharges = array_merge($allCharges, $charges);
        }

        if (empty($allCharges)) {
            throw new \RuntimeException('領収書に含める明細がありません');
        }

        // 金額集計
        $totals = $this->calculateTotals($allCharges);

        // 採番
        $documentNumber = $this->generateDocumentNumber($db, 'receipt');

        // documents — reservation_id は親予約IDを使用
        $stmt = $db->prepare("
            INSERT INTO documents (document_number, type, reservation_id, addressee, description,
                subtotal, tax_amount, accommodation_tax, total, payment_method_id, issued_by)
            VALUES (:doc_number, 'receipt', :reservation_id, :addressee, :description,
                :subtotal, :tax_amount, :accommodation_tax, :total, :payment_method_id, :issued_by)
        ");
        $stmt->execute([
            'doc_number'        => $documentNumber,
            'reservation_id'    => $parentReservationId,
            'addressee'         => $addressee,
            'description'       => $description,
            'subtotal'          => $totals['subtotal'],
            'tax_amount'        => $totals['tax_amount'],
            'accommodation_tax' => $totals['accommodation_tax'],
            'total'             => $totals['total'],
            'payment_method_id' => $paymentMethodId,
            'issued_by'         => $staffId,
        ]);
        $documentId = (int) $db->lastInsertId();

        // document_items
        $itemStmt = $db->prepare("
            INSERT INTO document_items (document_id, charge_id, date, description, quantity, unit_price, tax_amount, accommodation_tax, amount, tax_rate)
            VALUES (:document_id, :charge_id, :date, :description, 1, :unit_price, :tax_amount, :accommodation_tax, :amount, :tax_rate)
        ");
        foreach ($allCharges as $c) {
            // room行の摘要はプラン名ではなく部屋タイプ名に差し替え
            $desc = $c['charge_type'] === 'room'
                ? '宿泊（' . ($c['_room_type_name'] ?? '客室') . '）'
                : $c['description'];
            $itemStmt->execute([
                'document_id'       => $documentId,
                'charge_id'         => $c['id'],
                'date'              => $c['date'],
                'description'       => $desc,
                'unit_price'        => $c['amount'],
                'tax_amount'        => $c['tax_amount'],
                'accommodation_tax' => $c['accommodation_tax'],
                'amount'            => $c['amount'],
                'tax_rate'          => $c['tax_rate'],
            ]);
        }

        // 宛名をゲストに保存
        if ($saveAddressee && $parent['guest_id']) {
            $db->prepare("UPDATE guests SET receipt_addressee = :addr WHERE id = :gid")
               ->execute(['addr' => $addressee, 'gid' => $parent['guest_id']]);
        }

        // イベント履歴（親予約に記録）
        $roomCount = count($children);
        $db->prepare("
            INSERT INTO reservation_events (reservation_id, event_type, summary, detail, staff_id, event_at)
            VALUES (:rid, 'receipt_issued', :summary, :detail, :staff_id, NOW())
        ")->execute([
            'rid'      => $parentReservationId,
            'summary'  => "領収書発行（グループ{$roomCount}室一括）",
            'detail'   => "{$documentNumber} 宛名:{$addressee} 金額:{$totals['total']}円",
            'staff_id' => $staffId,
        ]);

        return $documentId;
    }

    /**
     * 即売（宿泊予約に紐づかない物販）の領収書を発行する
     *
     * 宿泊の領収書と違い reservation_id は NULL。
     * 対象は product_sales の行で、document_items.sale_id で紐付ける
     * （即売には reservation_charges 行が無いため charge_id が使えない）。
     *
     * @param array $saleIds product_sales.id の配列
     * @return int documents.id
     */
    public function issueSalesReceipt(
        PDO $db,
        array $saleIds,
        string $addressee,
        string $description,
        int $staffId,
        ?int $paymentMethodId = null
    ): int {
        if (empty($saleIds)) {
            throw new \RuntimeException('領収書に含める販売がありません');
        }

        $placeholders = implode(',', array_fill(0, count($saleIds), '?'));

        // 即売分のみ（部屋付けはCO精算で宿泊の領収書に含まれるため対象外）
        // 取消済みも除外する
        $stmt = $db->prepare("
            SELECT id, sale_date, product_name, unit_price, tax_rate, quantity, amount, tax_amount
            FROM product_sales
            WHERE id IN ({$placeholders})
              AND status = 'active'
              AND reservation_id IS NULL
            ORDER BY id
        ");
        $stmt->execute($saleIds);
        $sales = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (count($sales) !== count($saleIds)) {
            throw new \RuntimeException('取消済み、または部屋付けの販売が含まれています');
        }

        // 二重発行の防止（同じ販売で有効な領収書が既にある場合は弾く。再発行は既存の再発行フローを使う）
        $dup = $db->prepare("
            SELECT COUNT(*) FROM document_items di
            JOIN documents d ON d.id = di.document_id AND d.status = 'issued'
            WHERE di.sale_id IN ({$placeholders})
        ");
        $dup->execute($saleIds);
        if ((int) $dup->fetchColumn() > 0) {
            throw new \RuntimeException('この販売の領収書は既に発行されています');
        }

        // 金額集計。
        // 税額は行ごとのスナップショット（product_sales.tax_amount）を合算せず、
        // 税率ごとの対象額合計から1回で計算する（インボイスの端数処理原則）。
        // 即売領収書は物販機能と同時に新設された書式なので、既存領収書との互換を気にせず
        // 全税率この方式で統一する
        $total = 0;
        $amountsByRate = [];
        foreach ($sales as $s) {
            $total += (int) $s['amount'];
            $rate = (int) $s['tax_rate'];
            $amountsByRate[$rate] = ($amountsByRate[$rate] ?? 0) + (int) $s['amount'];
        }
        $taxAmount = 0;
        foreach ($amountsByRate as $rate => $amount) {
            $taxAmount += TaxCalc::includedTax($amount, $rate);
        }
        $subtotal = $total - $taxAmount;

        $documentNumber = $this->generateDocumentNumber($db, 'receipt');

        // reservation_id は NULL（即売は宿泊予約に紐づかない）
        $stmt = $db->prepare("
            INSERT INTO documents (document_number, type, reservation_id, addressee, description,
                subtotal, tax_amount, accommodation_tax, total, payment_method_id, issued_by)
            VALUES (:doc_number, 'receipt', NULL, :addressee, :description,
                :subtotal, :tax_amount, 0, :total, :payment_method_id, :issued_by)
        ");
        $stmt->execute([
            'doc_number'        => $documentNumber,
            'addressee'         => $addressee,
            'description'       => $description,
            'subtotal'          => $subtotal,
            'tax_amount'        => $taxAmount,
            'total'             => $total,
            'payment_method_id' => $paymentMethodId,
            'issued_by'         => $staffId,
        ]);
        $documentId = (int) $db->lastInsertId();

        $itemStmt = $db->prepare("
            INSERT INTO document_items (document_id, sale_id, date, description, quantity, unit_price, tax_amount, accommodation_tax, amount, tax_rate)
            VALUES (:document_id, :sale_id, :date, :description, :quantity, :unit_price, :tax_amount, 0, :amount, :tax_rate)
        ");
        foreach ($sales as $s) {
            $itemStmt->execute([
                'document_id' => $documentId,
                'sale_id'     => $s['id'],
                'date'        => $s['sale_date'],
                // 摘要は部屋付け（reservation_charges.description）と同じ「商品名 ×N」形式に揃える
                'description' => $s['product_name'] . ' ×' . $s['quantity'],
                'quantity'    => $s['quantity'],
                'unit_price'  => $s['unit_price'],
                'tax_amount'  => $s['tax_amount'],
                'amount'      => $s['amount'],
                'tax_rate'    => $s['tax_rate'],
            ]);
        }

        // reservation_events は予約に紐づく履歴なので即売では記録しない（FK制約もある）

        return $documentId;
    }

    /**
     * 領収書を再発行する
     * 元ドキュメントの reissue_count を +1 し、新しいドキュメントをコピー生成する
     * 宛名・但し書きは変更可能（再発行時に法人名に変更するケースがある）
     */
    public function reissueDocument(
        PDO $db,
        int $originalDocumentId,
        string $addressee,
        string $description,
        int $staffId
    ): int {
        // 元ドキュメントの取得
        $stmt = $db->prepare("SELECT * FROM documents WHERE id = :id AND status = 'issued'");
        $stmt->execute(['id' => $originalDocumentId]);
        $original = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$original) {
            throw new \RuntimeException('元の帳票が見つかりません（キャンセル済みの可能性）');
        }

        // 元ドキュメントの再発行回数を更新
        $newReissueCount = (int) $original['reissue_count'] + 1;
        $db->prepare("UPDATE documents SET reissue_count = :cnt WHERE id = :id")
           ->execute(['cnt' => $newReissueCount, 'id' => $originalDocumentId]);

        // 新しい帳票番号を採番
        $documentNumber = $this->generateDocumentNumber($db, $original['type']);

        // 新ドキュメントを INSERT（元ドキュメントの金額情報をコピー）
        $stmt = $db->prepare("
            INSERT INTO documents (document_number, type, reservation_id, corporate_id,
                billing_period_from, billing_period_to, addressee, description,
                subtotal, tax_amount, accommodation_tax, total,
                payment_method_id, issued_by, reissue_count, original_document_id)
            VALUES (:doc_number, :type, :reservation_id, :corporate_id,
                :period_from, :period_to, :addressee, :description,
                :subtotal, :tax_amount, :accommodation_tax, :total,
                :payment_method_id, :issued_by, :reissue_count, :original_id)
        ");
        $stmt->execute([
            'doc_number'        => $documentNumber,
            'type'              => $original['type'],
            'reservation_id'    => $original['reservation_id'],
            'corporate_id'      => $original['corporate_id'],
            'period_from'       => $original['billing_period_from'],
            'period_to'         => $original['billing_period_to'],
            'addressee'         => $addressee,
            'description'       => $description,
            'subtotal'          => $original['subtotal'],
            'tax_amount'        => $original['tax_amount'],
            'accommodation_tax' => $original['accommodation_tax'],
            'total'             => $original['total'],
            'payment_method_id' => $original['payment_method_id'],
            'issued_by'         => $staffId,
            'reissue_count'     => $newReissueCount,
            'original_id'       => $originalDocumentId,
        ]);
        $newDocumentId = (int) $db->lastInsertId();

        // 元ドキュメントの明細をコピー
        $items = $db->prepare("SELECT * FROM document_items WHERE document_id = :did ORDER BY id");
        $items->execute(['did' => $originalDocumentId]);
        // tax_rate / sale_id もコピーする（税率区分記載と即売領収書の紐付けを再発行後も保つ）
        $itemStmt = $db->prepare("
            INSERT INTO document_items (document_id, charge_id, sale_id, date, description, quantity, unit_price, tax_amount, accommodation_tax, amount, tax_rate)
            VALUES (:document_id, :charge_id, :sale_id, :date, :description, :quantity, :unit_price, :tax_amount, :accommodation_tax, :amount, :tax_rate)
        ");
        foreach ($items as $item) {
            $itemStmt->execute([
                'document_id'       => $newDocumentId,
                'charge_id'         => $item['charge_id'],
                'sale_id'           => $item['sale_id'],
                'date'              => $item['date'],
                'description'       => $item['description'],
                'quantity'          => $item['quantity'],
                'unit_price'        => $item['unit_price'],
                'tax_amount'        => $item['tax_amount'],
                'accommodation_tax' => $item['accommodation_tax'],
                'amount'            => $item['amount'],
                'tax_rate'          => $item['tax_rate'],
            ]);
        }

        // イベント履歴
        if ($original['reservation_id']) {
            $db->prepare("
                INSERT INTO reservation_events (reservation_id, event_type, summary, detail, staff_id, event_at)
                VALUES (:rid, 'receipt_reissued', :summary, :detail, :staff_id, NOW())
            ")->execute([
                'rid'      => $original['reservation_id'],
                'summary'  => "領収書再発行（{$newReissueCount}回目）",
                'detail'   => "{$documentNumber} 元:{$original['document_number']} 宛名:{$addressee}",
                'staff_id' => $staffId,
            ]);
        }

        return $newDocumentId;
    }

    /**
     * 対象明細を取得する
     * charge_ids が指定されていれば分割発行（指定IDのみ）、未指定なら全active明細
     */
    private function getTargetCharges(PDO $db, int $reservationId, ?array $chargeIds = null): array
    {
        // 領収書に含める種別（入金・返金は決済の記録であり費目ではないため除外）
        // goods（物販の部屋付け）はCO精算で宿泊料と一緒に精算するため含める
        $validTypes = "('room','cancel_fee','no_show_fee','addon','discount','goods')";

        if ($chargeIds !== null && !empty($chargeIds)) {
            // 分割発行: 指定IDのみ
            $placeholders = implode(',', array_fill(0, count($chargeIds), '?'));
            $params = $chargeIds;
            $params[] = $reservationId;
            $stmt = $db->prepare("
                SELECT id, date, charge_type, description, amount, tax_amount, accommodation_tax, tax_rate
                FROM reservation_charges
                WHERE id IN ({$placeholders})
                  AND reservation_id = ?
                  AND status = 'active'
                  AND charge_type IN {$validTypes}
                ORDER BY date, id
            ");
            $stmt->execute($params);
        } else {
            // 全明細
            $stmt = $db->prepare("
                SELECT id, date, charge_type, description, amount, tax_amount, accommodation_tax, tax_rate
                FROM reservation_charges
                WHERE reservation_id = :rid
                  AND status = 'active'
                  AND charge_type IN {$validTypes}
                ORDER BY date, id
            ");
            $stmt->execute(['rid' => $reservationId]);
        }

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * 明細から金額を集計する
     */
    private function calculateTotals(array $charges): array
    {
        $total = 0;
        $taxAmount = 0;
        $accommodationTax = 0;
        $reducedAmounts = [];   // 軽減税率(8%等)の税込対象額を税率ごとに合算

        foreach ($charges as $c) {
            $total += (int) $c['amount'];
            $accommodationTax += (int) $c['accommodation_tax'];

            // インボイスの端数処理原則（税率ごとに1回）への対応:
            //   軽減税率の明細は行ごとの税額を合算せず、対象額を税率ごとに集めて後で1回計算する。
            //   （行ごとに切り捨ててから合算すると税額が数円小さくなり得るため）
            // 標準税率(tax_rate NULL含む)の明細は従来通り行の税額を合算する。
            //   宿泊料の税額は既存の計算体系（明細作成時に確定）があり、
            //   ここで再計算すると物販導入前の領収書と金額が変わってしまうため触らない
            $rate = isset($c['tax_rate']) && $c['tax_rate'] !== null ? (int) $c['tax_rate'] : null;
            if ($rate !== null && $rate !== 10) {
                $reducedAmounts[$rate] = ($reducedAmounts[$rate] ?? 0) + (int) $c['amount'];
            } else {
                $taxAmount += (int) $c['tax_amount'];
            }
        }

        foreach ($reducedAmounts as $rate => $amount) {
            $taxAmount += TaxCalc::includedTax($amount, $rate);
        }

        // 小計 = 合計 - 消費税 - 宿泊税（税抜金額）
        $subtotal = $total - $taxAmount - $accommodationTax;

        return [
            'subtotal'          => $subtotal,
            'tax_amount'        => $taxAmount,
            'accommodation_tax' => $accommodationTax,
            'total'             => $total,
        ];
    }

    /**
     * 帳票番号を自動採番する
     * 形式: R-YYYY-NNNN（領収書）/ I-YYYY-NNNN（請求書）
     * 同一年内の最大番号 +1。UNIQUE制約で重複防止
     */
    private function generateDocumentNumber(PDO $db, string $type): string
    {
        $prefix = $type === 'receipt' ? 'R' : 'I';
        $year = date('Y');
        $pattern = "{$prefix}-{$year}-%";

        $stmt = $db->prepare("
            SELECT document_number FROM documents
            WHERE document_number LIKE :pattern
            ORDER BY document_number DESC
            LIMIT 1
        ");
        $stmt->execute(['pattern' => $pattern]);
        $last = $stmt->fetchColumn();

        if ($last) {
            // R-2026-0042 → 42 → 43
            $seq = (int) substr($last, -4) + 1;
        } else {
            $seq = 1;
        }

        return sprintf('%s-%s-%04d', $prefix, $year, $seq);
    }
}
