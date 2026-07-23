<?php

namespace App\Controllers;

use App\Controllers\Concerns\OptimisticLock;
use App\Core\Database;
use App\Core\Request;
use App\Core\Response;

/**
 * 物販の販売コントローラー
 *
 * 販売形態は2種類:
 *   即売     … その場で決済（payment_method_id あり / reservation_id NULL）
 *   部屋付け … 宿泊予約の明細に追加してCO時に精算（reservation_id あり / payment_method_id NULL）
 *
 * 商品名・単価・税率は販売時点の値を product_sales にスナップショットする。
 * マスタを後から変更しても過去の売上・領収書が変わらないようにするため。
 */
class ProductSaleController
{
    use OptimisticLock;

    /**
     * POST /api/v1/product-sales
     * body: { items: [{product_id, quantity}], reservation_id?, payment_method_id?, updated_at? }
     */
    public function store(Request $request): void
    {
        $body = $request->body;
        $staffId = $request->auth['staff_id'];

        $items = $body['items'] ?? null;
        if (!is_array($items) || empty($items)) {
            Response::error('販売する商品がありません', 400);
        }

        $reservationId   = isset($body['reservation_id']) ? (int) $body['reservation_id'] : null;
        $paymentMethodId = isset($body['payment_method_id']) ? (int) $body['payment_method_id'] : null;

        // 即売と部屋付けは排他。両方指定は「どちらで精算するのか」が定まらないため弾く
        if ($reservationId && $paymentMethodId) {
            Response::error('部屋付けと即売は同時に指定できません', 400);
        }
        if (!$reservationId && !$paymentMethodId) {
            Response::error('支払方法または部屋付け先の予約を指定してください', 400);
        }

        $db = Database::getInstance();

        // 部屋付けはCI済み（在室中）の予約のみ。未CI/CO済みの予約に商品を付けると
        // 精算のタイミングが無くなるため
        $reservation = null;
        if ($reservationId) {
            $this->checkOptimisticLock($reservationId, $body['updated_at'] ?? null);

            $stmt = $db->prepare("SELECT id, status FROM reservations WHERE id = :id");
            $stmt->execute(['id' => $reservationId]);
            $reservation = $stmt->fetch();

            if (!$reservation) {
                Response::error('予約が見つかりません', 404);
            }
            if ($reservation['status'] !== 'checked_in') {
                Response::error('チェックイン済みの予約にのみ部屋付けできます', 422);
            }
        }

        // 即売の決済方法は有効なものだけ
        if ($paymentMethodId) {
            $stmt = $db->prepare("SELECT id FROM payment_methods WHERE id = :id AND is_active = 1");
            $stmt->execute(['id' => $paymentMethodId]);
            if (!$stmt->fetch()) {
                Response::error('無効な支払方法です', 400);
            }
        }

        // 商品情報はフロントから受け取らずマスタから読み直す（価格の改ざん防止）
        $lines = [];
        foreach ($items as $item) {
            $productId = (int) ($item['product_id'] ?? 0);
            $quantity  = (int) ($item['quantity'] ?? 0);

            if ($productId <= 0 || $quantity <= 0) {
                Response::error('商品と数量の指定が不正です', 400);
            }

            $stmt = $db->prepare("
                SELECT id, product_name, price, tax_rate
                FROM products
                WHERE id = :id AND is_active = 1
            ");
            $stmt->execute(['id' => $productId]);
            $product = $stmt->fetch();

            if (!$product) {
                Response::error('販売できない商品が含まれています（無効化された可能性があります）', 400);
            }

            $unitPrice = (int) $product['price'];
            $taxRate   = (int) $product['tax_rate'];
            $amount    = $unitPrice * $quantity;

            $lines[] = [
                'product_id'   => (int) $product['id'],
                'product_name' => $product['product_name'],
                'unit_price'   => $unitPrice,
                'tax_rate'     => $taxRate,
                'quantity'     => $quantity,
                'amount'       => $amount,
                'tax_amount'   => self::calcTaxAmount($amount, $taxRate),
            ];
        }

        // 販売日はサーバーの当日。フロントから受け取らない（端末の時計ずれ・改ざんを避ける）
        $saleDate = date('Y-m-d');

        $db->beginTransaction();
        try {
            $saleIds = [];

            foreach ($lines as $line) {
                $chargeId = null;

                // 部屋付けは明細行（goods）を先に作り、product_sales から charge_id で紐付ける。
                // 取消時に両方を連動して cancelled にするため
                if ($reservationId) {
                    $db->prepare("
                        INSERT INTO reservation_charges
                            (reservation_id, date, charge_type, description, amount, tax_amount, tax_rate)
                        VALUES
                            (:rid, :date, 'goods', :description, :amount, :tax_amount, :tax_rate)
                    ")->execute([
                        'rid'         => $reservationId,
                        'date'        => $saleDate,
                        'description' => $line['product_name'] . ' ×' . $line['quantity'],
                        'amount'      => $line['amount'],
                        'tax_amount'  => $line['tax_amount'],
                        'tax_rate'    => $line['tax_rate'],
                    ]);
                    $chargeId = (int) $db->lastInsertId();
                }

                $db->prepare("
                    INSERT INTO product_sales
                        (sale_date, reservation_id, charge_id, product_id, product_name,
                         unit_price, tax_rate, quantity, amount, tax_amount, payment_method_id, staff_id)
                    VALUES
                        (:sale_date, :reservation_id, :charge_id, :product_id, :product_name,
                         :unit_price, :tax_rate, :quantity, :amount, :tax_amount, :payment_method_id, :staff_id)
                ")->execute([
                    'sale_date'         => $saleDate,
                    'reservation_id'    => $reservationId,
                    'charge_id'         => $chargeId,
                    'product_id'        => $line['product_id'],
                    'product_name'      => $line['product_name'],
                    'unit_price'        => $line['unit_price'],
                    'tax_rate'          => $line['tax_rate'],
                    'quantity'          => $line['quantity'],
                    'amount'            => $line['amount'],
                    'tax_amount'        => $line['tax_amount'],
                    'payment_method_id' => $paymentMethodId,
                    'staff_id'          => $staffId,
                ]);

                $saleIds[] = (int) $db->lastInsertId();
            }

            // 同一会計の目印を付ける（先頭行のidをグループIDとして全行に振る）。
            // 3点まとめて買った会計に領収書を1枚だけ発行するために必要
            $groupPlaceholders = implode(',', array_fill(0, count($saleIds), '?'));
            $db->prepare("UPDATE product_sales SET sale_group_id = ? WHERE id IN ({$groupPlaceholders})")
               ->execute(array_merge([$saleIds[0]], $saleIds));

            // 部屋付けは予約の請求額に反映する（goods は売上明細なので amount に乗る）
            if ($reservationId) {
                $this->recalcReservationAmount($db, $reservationId);
            }

            $db->commit();
        } catch (\Exception $e) {
            $db->rollBack();
            Response::error('販売の登録に失敗しました: ' . $e->getMessage(), 500);
        }

        $total = array_sum(array_column($lines, 'amount'));

        Response::json([
            'message'  => $reservationId ? '部屋付けしました' : '販売しました',
            'sale_ids' => $saleIds,
            'total'    => $total,
        ], 201);
    }

    /**
     * GET /api/v1/product-sales?date=YYYY-MM-DD | from=&to=
     * 日付未指定は当日。物販ページの販売履歴と、レポートの明細取得で使う
     */
    public function index(Request $request): void
    {
        $db = Database::getInstance();

        // 単日指定（物販ページ）と期間指定（レポート）の両方に対応する
        $from = $request->query['from'] ?? $request->query['date'] ?? date('Y-m-d');
        $to   = $request->query['to']   ?? $request->query['date'] ?? $from;

        $params = ['from_date' => $from, 'to_date' => $to];

        // 取消済みも返す（履歴に打ち消し線で残すため）。予約の部屋番号は在室中のアサインから引く
        $sql = "
            SELECT ps.id, ps.sale_date, ps.sale_group_id, ps.reservation_id, ps.charge_id, ps.product_id,
                   ps.product_name, ps.unit_price, ps.tax_rate, ps.quantity, ps.amount,
                   ps.tax_amount, ps.payment_method_id, ps.staff_id, ps.status, ps.created_at,
                   -- 領収書の重複発行を防ぐため、発行済みかどうかを画面に返す
                   EXISTS(
                     SELECT 1 FROM document_items di
                     JOIN documents d ON d.id = di.document_id AND d.status = 'issued'
                     WHERE di.sale_id = ps.id
                   ) AS receipt_issued,
                   pm.method_name AS payment_method_name,
                   s.staff_name,
                   r.reservation_no,
                   COALESCE(g.name_kanji, g.name_kana, g.name_romaji,
                            TRIM(CONCAT(r.tl_last_name, ' ', r.tl_first_name))) AS guest_name,
                   -- 部屋番号はサブクエリで取る。1予約に複数アサインがあり得るため
                   -- JOIN すると販売行が重複してしまう
                   (SELECT ro.room_number
                      FROM room_assignments ra
                      JOIN rooms ro ON ro.id = ra.room_id
                     WHERE ra.reservation_id = ps.reservation_id AND ra.status = 'active'
                     ORDER BY ro.room_number
                     LIMIT 1) AS room_number
            FROM product_sales ps
            LEFT JOIN payment_methods pm ON pm.id = ps.payment_method_id
            LEFT JOIN staff s            ON s.id  = ps.staff_id
            LEFT JOIN reservations r     ON r.id  = ps.reservation_id
            LEFT JOIN guests g           ON g.id  = r.guest_id
            WHERE ps.sale_date BETWEEN :from_date AND :to_date
            ORDER BY ps.created_at DESC, ps.id DESC
        ";

        $stmt = $db->prepare($sql);
        $stmt->execute($params);

        Response::json(['sales' => $stmt->fetchAll()]);
    }

    /**
     * PUT /api/v1/product-sales/:id/cancel
     * 論理削除（規約 #13）。部屋付けの場合は紐づく明細行も連動して取消す
     */
    public function cancel(Request $request): void
    {
        $id = (int) $request->params['id'];
        $db = Database::getInstance();

        $stmt = $db->prepare("SELECT id, reservation_id, charge_id, status FROM product_sales WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $sale = $stmt->fetch();

        if (!$sale) {
            Response::error('販売記録が見つかりません', 404);
        }
        if ($sale['status'] === 'cancelled') {
            Response::error('この販売は既に取消済みです', 422);
        }

        // 領収書発行済みの販売は取消不可。
        // 取消を許すと「有効な領収書が取消済みの販売を参照する」状態になり、
        // 書面と売上記録の金額が食い違ってしまうため
        $stmt = $db->prepare("
            SELECT COUNT(*) FROM document_items di
            JOIN documents d ON d.id = di.document_id AND d.status = 'issued'
            WHERE di.sale_id = :sid
        ");
        $stmt->execute(['sid' => $id]);
        if ((int) $stmt->fetchColumn() > 0) {
            Response::error('この販売は領収書が発行済みのため取消できません。先に領収書の再発行（旧領収書の無効化）で対応してください', 422);
        }

        $reservationId = $sale['reservation_id'] ? (int) $sale['reservation_id'] : null;
        if ($reservationId) {
            $this->checkOptimisticLock($reservationId, $request->body['updated_at'] ?? null);
        }

        $db->beginTransaction();
        try {
            $db->prepare("UPDATE product_sales SET status = 'cancelled' WHERE id = :id")
               ->execute(['id' => $id]);

            // 部屋付けの明細行も取消す（片方だけ残ると請求額が合わなくなる）
            if ($sale['charge_id']) {
                $db->prepare("UPDATE reservation_charges SET status = 'cancelled' WHERE id = :id")
                   ->execute(['id' => (int) $sale['charge_id']]);
            }

            if ($reservationId) {
                $this->recalcReservationAmount($db, $reservationId);
            }

            $db->commit();
        } catch (\Exception $e) {
            $db->rollBack();
            Response::error('取消に失敗しました: ' . $e->getMessage(), 500);
        }

        Response::json(['message' => '取消しました']);
    }

    // ============================================================
    // ヘルパー
    // ============================================================

    /**
     * 税込金額から内消費税額を求める（円未満切り捨て）
     * 実体は TaxCalc::includedTax に一元化した（領収書側と式を共有するため）。
     * 税率は引数（= DBのスナップショット値）で受け取り、ロジックには埋め込まない。
     * フロント側（utils/tax.js）も同じ式で計算する
     */
    public static function calcTaxAmount(int $amount, int $taxRate): int
    {
        return \App\Services\TaxCalc::includedTax($amount, $taxRate);
    }

    /**
     * 予約の請求額（reservations.amount）を明細から再計算する
     *
     * ReservationController::recalcAmountFromCharges() と同じ条件式にしている
     * （active な明細のうち入金・返金以外の合計）。
     * private 同士で共有できないため意図的に同じ流儀で書いた。条件を変える場合は両方直すこと。
     */
    private function recalcReservationAmount(\PDO $db, int $reservationId): void
    {
        $stmt = $db->prepare("
            SELECT COALESCE(SUM(amount), 0) FROM reservation_charges
            WHERE reservation_id = :rid AND status = 'active' AND charge_type NOT IN ('payment','refund')
        ");
        $stmt->execute(['rid' => $reservationId]);
        $total = (int) $stmt->fetchColumn();

        $db->prepare("UPDATE reservations SET amount = :amount WHERE id = :id")
           ->execute(['amount' => $total, 'id' => $reservationId]);
    }
}
