<?php

namespace App\Controllers;

use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use PDO;

/**
 * ゲストコントローラー
 * 顧客管理のCRUD + パスポート画像管理
 * 名前は姓名分割ではなく統合フィールド（name_kanji, name_kana, name_romaji）で管理
 */
class GuestController
{
    /** GET /api/v1/guests — ゲスト一覧（検索・ページネーション） */
    public function index(Request $request): void
    {
        $db = Database::getInstance();
        $q = $request->query;

        $page    = max(1, (int) ($q['page'] ?? 1));
        $perPage = min(100, max(1, (int) ($q['per_page'] ?? 20)));
        $offset  = ($page - 1) * $perPage;

        // WHERE条件構築（マージ済みは除外）
        $where = ["g.status = 'active'"];
        $params = [];

        // 検索: 顧客コード、名前（漢字/カナ/ローマ字）、電話番号でOR検索
        if (!empty($q['q'])) {
            $search = '%' . $q['q'] . '%';
            $where[] = "(
                g.guest_code LIKE :q1
                OR g.name_kanji LIKE :q2
                OR g.name_kana LIKE :q3
                OR g.name_romaji LIKE :q4
                OR g.phone LIKE :q5
                OR g.mobile_phone LIKE :q6
            )";
            for ($i = 1; $i <= 6; $i++) {
                $params["q{$i}"] = $search;
            }
        }

        $whereClause = 'WHERE ' . implode(' AND ', $where);

        // ソート
        $sortMap = [
            'guest_code'     => 'g.guest_code',
            'name'           => 'g.name_kana',
            'stay_count'     => 'g.visit_count',
            'visit_count'    => 'g.visit_count',
            'last_stay_date' => 'g.last_stay_date',
        ];
        $sortKey = $sortMap[$q['sort'] ?? ''] ?? 'g.guest_code';
        $sortOrder = strtoupper($q['order'] ?? 'ASC') === 'DESC' ? 'DESC' : 'ASC';

        // 件数取得
        $countSql = "SELECT COUNT(*) FROM guests g {$whereClause}";
        $countStmt = $db->prepare($countSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        // データ取得
        // name: 漢字優先、なければカナ、なければローマ字（一覧での主表示名）
        $dataSql = "
            SELECT
                g.id,
                g.guest_code,
                g.name_kanji,
                g.name_kana,
                g.name_romaji,
                COALESCE(g.name_kanji, g.name_kana, g.name_romaji) AS name,
                g.country_code,
                g.phone,
                g.mobile_phone,
                g.email,
                g.visit_count AS stay_count,
                g.first_stay_date,
                g.last_stay_date,
                g.is_vip,
                g.company_name
            FROM guests g
            {$whereClause}
            ORDER BY {$sortKey} {$sortOrder}
            LIMIT {$perPage} OFFSET {$offset}
        ";
        $stmt = $db->prepare($dataSql);
        $stmt->execute($params);
        $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // 型変換
        foreach ($items as &$item) {
            $item['id']         = (int) $item['id'];
            $item['stay_count'] = (int) $item['stay_count'];
            $item['is_vip']     = (bool) $item['is_vip'];
        }

        Response::json([
            'data' => $items,
            'pagination' => [
                'total'       => $total,
                'page'        => $page,
                'per_page'    => $perPage,
                'total_pages' => (int) ceil($total / $perPage),
            ],
        ]);
    }

    /** GET /api/v1/guests/:id — ゲスト詳細（基本情報+宿泊履歴+パスポート画像） */
    public function show(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];

        // 基本情報取得
        $stmt = $db->prepare("
            SELECT * FROM guests WHERE id = :id AND status = 'active'
        ");
        $stmt->execute(['id' => $id]);
        $guest = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$guest) {
            Response::error('ゲストが見つかりません', 404);
            return;
        }

        // 型変換
        $guest['id']          = (int) $guest['id'];
        $guest['visit_count'] = (int) $guest['visit_count'];
        $guest['is_vip']      = (bool) $guest['is_vip'];
        if ($guest['merged_into_guest_id']) {
            $guest['merged_into_guest_id'] = (int) $guest['merged_into_guest_id'];
        }
        if ($guest['updated_by']) {
            $guest['updated_by'] = (int) $guest['updated_by'];
        }

        // 宿泊履歴（reservationsテーブルからJOIN）
        $historyStmt = $db->prepare("
            SELECT
                r.id,
                r.reservation_no,
                r.checkin_date,
                r.checkout_date,
                r.nights,
                r.room_type,
                rt.type_name AS room_type_name,
                r.status,
                r.amount,
                r.channel,
                r.adult_count,
                r.child_count,
                r.reservation_notes,
                rm.room_number
            FROM reservations r
            LEFT JOIN room_types rt ON rt.type_code = r.room_type
            LEFT JOIN room_assignments ra ON ra.reservation_id = r.id AND ra.status = 'active'
            LEFT JOIN rooms rm ON rm.id = ra.room_id
            WHERE r.guest_id = :guest_id
              AND r.status NOT IN ('cancelled', 'no_show')
            ORDER BY r.checkin_date DESC
        ");
        $historyStmt->execute(['guest_id' => $id]);
        $stayHistory = $historyStmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($stayHistory as &$h) {
            $h['id']          = (int) $h['id'];
            $h['nights']      = (int) $h['nights'];
            $h['amount']      = (int) $h['amount'];
            $h['adult_count'] = (int) $h['adult_count'];
            $h['child_count'] = (int) $h['child_count'];
        }

        // パスポート画像（予約経由で取得）
        $passportStmt = $db->prepare("
            SELECT
                rp.id,
                rp.reservation_id,
                rp.is_representative,
                rp.image_path,
                rp.scanned_at,
                r.checkin_date,
                r.reservation_no
            FROM reservation_passports rp
            INNER JOIN reservations r ON r.id = rp.reservation_id
            WHERE r.guest_id = :guest_id AND rp.deleted_at IS NULL
            ORDER BY rp.scanned_at DESC
        ");
        $passportStmt->execute(['guest_id' => $id]);
        $passports = $passportStmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($passports as &$p) {
            $p['id']                = (int) $p['id'];
            $p['reservation_id']    = (int) $p['reservation_id'];
            $p['is_representative'] = (bool) $p['is_representative'];
        }

        Response::json([
            'guest'        => $guest,
            'stay_history' => $stayHistory,
            'passports'    => $passports,
        ]);
    }

    /** POST /api/v1/guests — ゲスト新規登録 */
    public function store(Request $request): void
    {
        $db = Database::getInstance();
        $data = $request->body;

        // バリデーション: 漢字・カナ・ローマ字のいずれかは必要（識別のため）
        if (empty($data['name_kanji']) && empty($data['name_kana']) && empty($data['name_romaji'])) {
            Response::error('氏名（漢字・カナ・ローマ字のいずれか）は必須です', 400);
            return;
        }

        // email形式チェック（入力ありの場合のみ）
        if (!empty($data['email']) && !filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
            Response::error('メールアドレスの形式が不正です', 400);
            return;
        }

        // gender許可値チェック
        $allowedGenders = ['male', 'female', 'other', 'unknown'];
        if (!empty($data['gender']) && !in_array($data['gender'], $allowedGenders)) {
            Response::error('性別の値が不正です', 400);
            return;
        }

        // birth_date日付形式チェック
        if (!empty($data['birth_date'])) {
            $d = \DateTime::createFromFormat('Y-m-d', $data['birth_date']);
            if (!$d || $d->format('Y-m-d') !== $data['birth_date']) {
                Response::error('生年月日の形式が不正です（YYYY-MM-DD）', 400);
                return;
            }
        }

        // guest_code 自動採番（MAX+1方式）
        $guestCode = null;
        for ($retry = 0; $retry < 3; $retry++) {
            $maxStmt = $db->query(
                "SELECT MAX(CAST(SUBSTRING(guest_code, 2) AS UNSIGNED)) FROM guests"
            );
            $maxNum = (int) $maxStmt->fetchColumn();
            $guestCode = 'G' . str_pad($maxNum + 1, 5, '0', STR_PAD_LEFT);

            $checkStmt = $db->prepare("SELECT COUNT(*) FROM guests WHERE guest_code = :code");
            $checkStmt->execute(['code' => $guestCode]);
            if ((int) $checkStmt->fetchColumn() === 0) {
                break;
            }
            $guestCode = null;
        }

        if (!$guestCode) {
            Response::error('顧客コードの採番に失敗しました。再度お試しください', 500);
            return;
        }

        $sql = "
            INSERT INTO guests (
                guest_code, name_kanji, name_kana, name_romaji,
                country_code, email, phone, mobile_phone,
                postal_code, prefecture, city, address_line,
                gender, birth_date, company_name,
                preferred_language, guest_notes, is_vip,
                updated_by
            ) VALUES (
                :guest_code, :name_kanji, :name_kana, :name_romaji,
                :country_code, :email, :phone, :mobile_phone,
                :postal_code, :prefecture, :city, :address_line,
                :gender, :birth_date, :company_name,
                :preferred_language, :guest_notes, :is_vip,
                :updated_by
            )
        ";

        // 空文字列をNULLに変換するヘルパー
        $nullIfEmpty = function($v) { return ($v === '' || $v === null) ? null : $v; };

        $stmt = $db->prepare($sql);
        $stmt->execute([
            'guest_code'         => $guestCode,
            'name_kanji'         => $nullIfEmpty($data['name_kanji'] ?? null),
            'name_kana'          => $nullIfEmpty($data['name_kana'] ?? null),
            'name_romaji'        => $nullIfEmpty($data['name_romaji'] ?? null),
            'country_code'       => $data['country_code'] ?? 'JP',
            'email'              => $nullIfEmpty($data['email'] ?? null),
            'phone'              => $nullIfEmpty($data['phone'] ?? null),
            'mobile_phone'       => $nullIfEmpty($data['mobile_phone'] ?? null),
            'postal_code'        => $nullIfEmpty($data['postal_code'] ?? null),
            'prefecture'         => $nullIfEmpty($data['prefecture'] ?? null),
            'city'               => $nullIfEmpty($data['city'] ?? null),
            'address_line'       => $nullIfEmpty($data['address_line'] ?? null),
            'gender'             => $nullIfEmpty($data['gender'] ?? null),
            'birth_date'         => $nullIfEmpty($data['birth_date'] ?? null),
            'company_name'       => $nullIfEmpty($data['company_name'] ?? null),
            'preferred_language' => $data['preferred_language'] ?? 'ja',
            'guest_notes'        => $nullIfEmpty($data['guest_notes'] ?? null),
            'is_vip'             => !empty($data['is_vip']) ? 1 : 0,
            'updated_by'         => $request->staffId ?? null,
        ]);

        $newId = (int) $db->lastInsertId();

        Response::json([
            'id'         => $newId,
            'guest_code' => $guestCode,
            'message'    => 'ゲストを登録しました',
        ], 201);
    }

    /** PUT /api/v1/guests/:id — ゲスト情報更新 */
    public function update(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];
        $data = $request->body;

        // 存在チェック
        $checkStmt = $db->prepare("SELECT id FROM guests WHERE id = :id AND status = 'active'");
        $checkStmt->execute(['id' => $id]);
        if (!$checkStmt->fetch()) {
            Response::error('ゲストが見つかりません', 404);
            return;
        }

        // email形式チェック（入力ありの場合のみ）
        if (isset($data['email']) && $data['email'] !== null && $data['email'] !== ''
            && !filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
            Response::error('メールアドレスの形式が不正です', 400);
            return;
        }

        // gender許可値チェック
        $allowedGenders = ['male', 'female', 'other', 'unknown'];
        if (!empty($data['gender']) && !in_array($data['gender'], $allowedGenders)) {
            Response::error('性別の値が不正です', 400);
            return;
        }

        // 更新可能フィールド（guest_codeは更新不可）
        $updatableFields = [
            'name_kanji', 'name_kana', 'name_romaji',
            'country_code', 'email', 'phone', 'mobile_phone',
            'postal_code', 'prefecture', 'city', 'address_line',
            'gender', 'birth_date', 'company_name',
            'preferred_language', 'guest_notes', 'is_vip',
        ];

        // 空文字列をNULLに変換すべきカラム
        // ENUM型やDATE型、および名前カラムは空文字列をNULLに変換する
        $nullableFields = [
            'name_kanji', 'name_kana', 'name_romaji',
            'gender', 'birth_date', 'email', 'phone', 'mobile_phone',
            'postal_code', 'prefecture', 'city', 'address_line',
            'company_name', 'preferred_language', 'country_code',
        ];

        $setClauses = [];
        $params = ['id' => $id];

        foreach ($updatableFields as $field) {
            if (array_key_exists($field, $data)) {
                if ($field === 'is_vip') {
                    $setClauses[] = "{$field} = :{$field}";
                    $params[$field] = !empty($data[$field]) ? 1 : 0;
                } else {
                    $value = $data[$field];
                    // 空文字列をNULLに変換
                    if (in_array($field, $nullableFields) && $value === '') {
                        $value = null;
                    }
                    $setClauses[] = "{$field} = :{$field}";
                    $params[$field] = $value;
                }
            }
        }

        if (empty($setClauses)) {
            Response::error('更新するフィールドがありません', 400);
            return;
        }

        // updated_by を必ずセット
        $setClauses[] = "updated_by = :updated_by";
        $params['updated_by'] = $request->staffId ?? null;

        $sql = "UPDATE guests SET " . implode(', ', $setClauses) . " WHERE id = :id";
        $stmt = $db->prepare($sql);
        $stmt->execute($params);

        Response::json(['message' => 'ゲスト情報を更新しました']);
    }

    /** POST /api/v1/reservations/:id/passport — パスポート画像アップロード */
    public function uploadPassport(Request $request): void
    {
        $db = Database::getInstance();
        $reservationId = (int) $request->params['id'];

        $checkStmt = $db->prepare("SELECT id FROM reservations WHERE id = :id");
        $checkStmt->execute(['id' => $reservationId]);
        if (!$checkStmt->fetch()) {
            Response::error('予約が見つかりません', 404);
            return;
        }

        if (empty($_FILES['passport_image'])) {
            Response::error('パスポート画像が送信されていません', 400);
            return;
        }

        $file = $_FILES['passport_image'];

        if ($file['error'] !== UPLOAD_ERR_OK) {
            Response::error('ファイルのアップロードに失敗しました', 400);
            return;
        }

        // MIMEタイプチェック（jpeg/pngのみ許可）
        $allowedMimes = ['image/jpeg', 'image/png'];
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mimeType = $finfo->file($file['tmp_name']);
        if (!in_array($mimeType, $allowedMimes)) {
            Response::error('JPEG または PNG 画像のみアップロードできます', 400);
            return;
        }

        // サイズ上限チェック（10MB）
        if ($file['size'] > 10 * 1024 * 1024) {
            Response::error('ファイルサイズが10MBを超えています', 400);
            return;
        }

        // 保存ディレクトリの作成（storage/passports/YYYY/MM/）
        $year = date('Y');
        $month = date('m');
        $storageBase = dirname(__DIR__, 2) . '/../storage/passports';
        $subDir = "{$year}/{$month}";
        $fullDir = "{$storageBase}/{$subDir}";
        if (!is_dir($fullDir)) {
            mkdir($fullDir, 0755, true);
        }

        // ファイル名はセキュリティのためユーザー指定のファイル名を使わない
        $ext = $mimeType === 'image/png' ? 'png' : 'jpg';
        $fileName = "{$reservationId}_" . uniqid() . ".{$ext}";
        $relativePath = "{$subDir}/{$fileName}";
        $fullPath = "{$storageBase}/{$relativePath}";

        if (!move_uploaded_file($file['tmp_name'], $fullPath)) {
            Response::error('ファイルの保存に失敗しました', 500);
            return;
        }

        $isRepresentative = !empty($_POST['is_representative']) ? 1 : 0;

        $stmt = $db->prepare("
            INSERT INTO reservation_passports
                (reservation_id, is_representative, image_path, scanned_at, scanned_by)
            VALUES
                (:reservation_id, :is_representative, :image_path, NOW(), :scanned_by)
        ");
        $stmt->execute([
            'reservation_id'    => $reservationId,
            'is_representative' => $isRepresentative,
            'image_path'        => $relativePath,
            'scanned_by'        => $request->staffId ?? null,
        ]);

        Response::json([
            'id'         => (int) $db->lastInsertId(),
            'image_path' => $relativePath,
            'message'    => 'パスポート画像を保存しました',
        ], 201);
    }

    /** DELETE /api/v1/passports/:id — パスポート画像のソフトデリート */
    public function deletePassport(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];

        $checkStmt = $db->prepare("
            SELECT id FROM reservation_passports WHERE id = :id AND deleted_at IS NULL
        ");
        $checkStmt->execute(['id' => $id]);
        if (!$checkStmt->fetch()) {
            Response::error('パスポート画像が見つかりません', 404);
            return;
        }

        // 物理DELETE禁止のためソフトデリート
        $stmt = $db->prepare("
            UPDATE reservation_passports SET deleted_at = NOW() WHERE id = :id
        ");
        $stmt->execute(['id' => $id]);

        Response::json(['message' => 'パスポート画像を削除しました']);
    }

    /** GET /api/v1/passports/:id/image — パスポート画像の配信 */
    public function servePassportImage(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];

        $stmt = $db->prepare("
            SELECT image_path FROM reservation_passports WHERE id = :id AND deleted_at IS NULL
        ");
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            Response::error('パスポート画像が見つかりません', 404);
            return;
        }

        $storageBase = dirname(__DIR__, 2) . '/../storage/passports';
        $fullPath = "{$storageBase}/{$row['image_path']}";

        if (!file_exists($fullPath)) {
            Response::error('画像ファイルが見つかりません', 404);
            return;
        }

        // 認証必須のためPHP経由で安全に配信
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mimeType = $finfo->file($fullPath);

        header("Content-Type: {$mimeType}");
        header("Content-Length: " . filesize($fullPath));
        header("Cache-Control: private, max-age=86400");
        readfile($fullPath);
        exit;
    }

    /**
     * POST /api/v1/guests/:id/merge — ゲストマージ
     *
     * 複数の重複ゲストレコードを1つに統合する。
     * merge_from_ids で指定されたゲストの予約を全て :id のゲストに移し、
     * 元のゲストは status='merged' に変更する。
     *
     * Body: { merge_from_ids: [102, 103, 104] }
     */
    public function merge(Request $request): void
    {
        $db = Database::getInstance();
        $targetId = (int) $request->params['id'];
        $staffId = $request->auth['staff_id'];
        $mergeFromIds = $request->body['merge_from_ids'] ?? [];

        if (empty($mergeFromIds)) {
            Response::error('merge_from_ids は必須です', 400);
            return;
        }

        // マージ先ゲストの存在確認
        $stmt = $db->prepare("SELECT id, guest_code, name_kanji, name_kana, name_romaji FROM guests WHERE id = :id AND status = 'active'");
        $stmt->execute(['id' => $targetId]);
        $target = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$target) {
            Response::error('マージ先ゲストが見つかりません', 404);
            return;
        }

        // マージ元ゲストの存在確認
        $sources = [];
        foreach ($mergeFromIds as $fromId) {
            $fromId = (int) $fromId;
            if ($fromId === $targetId) {
                Response::error('マージ先とマージ元に同じゲストは指定できません', 400);
                return;
            }
            $stmt = $db->prepare("SELECT id, guest_code, name_kanji, name_kana, name_romaji FROM guests WHERE id = :id AND status = 'active'");
            $stmt->execute(['id' => $fromId]);
            $source = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$source) {
                Response::error("マージ元ゲスト ID={$fromId} が見つかりません", 404);
                return;
            }
            $sources[] = $source;
        }

        $db->beginTransaction();
        try {
            foreach ($sources as $source) {
                $fromId = (int) $source['id'];

                // 1. マージ元の予約を全てマージ先に移す
                $db->prepare("
                    UPDATE reservations SET guest_id = :target_id, updated_at = NOW(), updated_by = :staff_id
                    WHERE guest_id = :from_id
                ")->execute([
                    'target_id' => $targetId,
                    'from_id'   => $fromId,
                    'staff_id'  => $staffId,
                ]);

                // 2. マージ元の旧姓(aliases)をマージ先に移す
                $db->prepare("UPDATE guest_aliases SET guest_id = :target_id WHERE guest_id = :from_id")
                   ->execute(['target_id' => $targetId, 'from_id' => $fromId]);

                // 3. マージ元をmerged状態に変更
                $db->prepare("
                    UPDATE guests SET status = 'merged', merged_into_guest_id = :target_id, updated_at = NOW(), updated_by = :staff_id
                    WHERE id = :from_id
                ")->execute([
                    'target_id' => $targetId,
                    'from_id'   => $fromId,
                    'staff_id'  => $staffId,
                ]);

                // 4. マージ履歴を記録
                $db->prepare("
                    INSERT INTO guest_merge_logs (merged_from_guest_id, merged_into_guest_id, merged_by)
                    VALUES (:from_id, :target_id, :staff_id)
                ")->execute([
                    'from_id'   => $fromId,
                    'target_id' => $targetId,
                    'staff_id'  => $staffId,
                ]);
            }

            // 5. マージ先のvisit_countを再計算（CO済み予約数）
            $stmt = $db->prepare("
                SELECT COUNT(*) FROM reservations WHERE guest_id = :id AND status = 'checked_out'
            ");
            $stmt->execute(['id' => $targetId]);
            $visitCount = (int) $stmt->fetchColumn();
            $db->prepare("UPDATE guests SET visit_count = :cnt WHERE id = :id")
               ->execute(['cnt' => $visitCount, 'id' => $targetId]);

            // 6. 操作ログ
            $db->prepare("
                INSERT INTO staff_activity_logs (staff_id, action, target_type, target_id, detail)
                VALUES (:staff_id, 'guest_merge', 'guest', :target_id, :detail)
            ")->execute([
                'staff_id'  => $staffId,
                'target_id' => $targetId,
                'detail'    => json_encode([
                    'target_guest_code' => $target['guest_code'],
                    'merged_from'       => array_map(fn($s) => [
                        'id'         => (int) $s['id'],
                        'guest_code' => $s['guest_code'],
                        'name'       => $s['name_kanji'] ?? $s['name_kana'] ?? $s['name_romaji'],
                    ], $sources),
                ], JSON_UNESCAPED_UNICODE),
            ]);

            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            Response::error('ゲストマージに失敗しました: ' . $e->getMessage(), 500);
            return;
        }

        Response::json([
            'message'     => count($sources) . '件のゲストをマージしました',
            'target_id'   => $targetId,
            'target_code' => $target['guest_code'],
            'merged_from' => array_map(fn($s) => (int) $s['id'], $sources),
        ]);
    }

    /**
     * GET /api/v1/guests/match — マッチング候補検索
     *
     * 指定ゲストと名前が類似するゲストを検索する。
     * 予約の紐付け先を決めたり、重複ゲストを発見するために使用。
     *
     * Query: guest_id=123 または q=さいとう（テキスト検索）
     */
    public function matchCandidates(Request $request): void
    {
        $db = Database::getInstance();
        $q = $request->query;

        $guestId = !empty($q['guest_id']) ? (int) $q['guest_id'] : null;
        $searchText = $q['q'] ?? null;

        if (!$guestId && !$searchText) {
            Response::error('guest_id または q パラメータが必要です', 400);
            return;
        }

        // guest_idが指定された場合、そのゲストの名前・電話番号で候補を検索する
        $searchTerms = [];
        if ($guestId) {
            $stmt = $db->prepare("SELECT name_kanji, name_kana, name_romaji, phone, mobile_phone FROM guests WHERE id = :id");
            $stmt->execute(['id' => $guestId]);
            $guest = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$guest) {
                Response::error('ゲストが見つかりません', 404);
                return;
            }
            // 漢字・カナ・ローマ字・電話番号をそれぞれ検索キーワードにする
            if ($guest['name_kanji'])  $searchTerms[] = $guest['name_kanji'];
            if ($guest['name_kana'])   $searchTerms[] = $guest['name_kana'];
            if ($guest['name_romaji']) $searchTerms[] = $guest['name_romaji'];
            if ($guest['phone'])        $searchTerms[] = $guest['phone'];
            if ($guest['mobile_phone']) $searchTerms[] = $guest['mobile_phone'];

            // 名前のバリエーションを生成して検索語に追加
            // OTAごとに半角カナ/全角カナ/スペースの有無がバラバラなため
            // 例: ｻﾄｳ ｹﾝｲﾁ → サトウ ケンイチ / サトウケンイチ / ｻﾄｳｹﾝｲﾁ 等
            foreach (['name_kanji', 'name_kana', 'name_romaji'] as $nameField) {
                if (empty($guest[$nameField])) continue;
                $original = $guest[$nameField];
                $variants = [$original];

                // 半角カナ→全角カナ
                $variants[] = mb_convert_kana($original, 'KV');
                // 全角カナ→半角カナ
                $variants[] = mb_convert_kana($original, 'kh');
                // 全角英数→半角英数
                $variants[] = mb_convert_kana($original, 'a');
                // 半角英数→全角英数
                $variants[] = mb_convert_kana($original, 'A');

                // 各バリエーションのスペース除去版も追加
                // ｻﾄｳ ｹﾝｲﾁ → ｻﾄｳｹﾝｲﾁ、サトウ ケンイチ → サトウケンイチ
                foreach ($variants as $v) {
                    $noSpace = preg_replace('/[\s　]+/u', '', $v);
                    if ($noSpace !== $v) $variants[] = $noSpace;
                }

                foreach ($variants as $v) {
                    if ($v !== '' && $v !== $original) $searchTerms[] = $v;
                }
            }
            // 重複除去
            $searchTerms = array_values(array_unique($searchTerms));
        }
        if ($searchText) {
            $searchTerms[] = $searchText;
        }

        if (empty($searchTerms)) {
            Response::json(['candidates' => []]);
            return;
        }

        // 各検索キーワードでOR検索（部分一致）
        // 自分自身とmerged済みは除外
        $conditions = [];
        $params = [];
        foreach ($searchTerms as $i => $term) {
            $like = '%' . $term . '%';
            // 電話番号検索用: 記号を全て除去した番号でも比較
            // DB側: (+81)90-1234-5678 → 819012345678
            // 入力側: 09012345678, +819012345678, 090-1234-5678 いずれでもマッチ
            // ※ DB保存時の正規化はしない（OTAごとにフォーマットが異なるため原本保持）
            $phoneNormalized = '%' . preg_replace('/[-\s()\+]/', '', $term) . '%';
            // SQL側でも同様に記号を除去して比較（REPLACE をネスト）
            $phoneSqlNormalize = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(%s, '-', ''), ' ', ''), '+', ''), '(', ''), ')', '')";
            $phoneCol  = sprintf($phoneSqlNormalize, 'g.phone');
            $mobileCol = sprintf($phoneSqlNormalize, 'g.mobile_phone');
            // スペース除去版のLIKE（DB側もスペースを除去して比較）
            // 「ｻﾄｳ ｹﾝｲﾁ」と「サトウケンイチ」のようなスペース有無の差を吸収
            $likeNoSpace = '%' . preg_replace('/[\s　]+/u', '', $term) . '%';
            $conditions[] = "(
                g.name_kanji LIKE :t{$i}a
                OR g.name_kana LIKE :t{$i}b
                OR g.name_romaji LIKE :t{$i}c
                OR REPLACE(REPLACE(g.name_kanji, ' ', ''), '　', '') LIKE :t{$i}h
                OR REPLACE(REPLACE(g.name_kana, ' ', ''), '　', '') LIKE :t{$i}j
                OR REPLACE(REPLACE(g.name_romaji, ' ', ''), '　', '') LIKE :t{$i}k
                OR g.phone LIKE :t{$i}d
                OR g.mobile_phone LIKE :t{$i}e
                OR {$phoneCol} LIKE :t{$i}f
                OR {$mobileCol} LIKE :t{$i}g
            )";
            $params["t{$i}a"] = $like;
            $params["t{$i}b"] = $like;
            $params["t{$i}c"] = $like;
            $params["t{$i}h"] = $likeNoSpace;
            $params["t{$i}j"] = $likeNoSpace;
            $params["t{$i}k"] = $likeNoSpace;
            $params["t{$i}d"] = $like;
            $params["t{$i}e"] = $like;
            $params["t{$i}f"] = $phoneNormalized;
            $params["t{$i}g"] = $phoneNormalized;
        }
        $orClause = implode(' OR ', $conditions);

        $excludeId = $guestId ?? 0;
        $params['exclude_id'] = $excludeId;

        $sql = "
            SELECT
                g.id, g.guest_code,
                g.name_kanji, g.name_kana, g.name_romaji,
                COALESCE(g.name_kanji, g.name_kana, g.name_romaji) AS name,
                g.phone, g.email, g.country_code,
                CONCAT_WS(' ', g.prefecture, g.city, g.address_line) AS address,
                g.visit_count AS stay_count,
                g.last_stay_date, g.is_vip,
                (SELECT COUNT(*) FROM reservations r WHERE r.guest_id = g.id AND r.status != 'merged') AS reservation_count
            FROM guests g
            WHERE g.status = 'active'
              AND g.id != :exclude_id
              AND g.merged_into_guest_id IS NULL
              AND ({$orClause})
            HAVING reservation_count > 0
            ORDER BY stay_count DESC, g.name_kana, g.id
            LIMIT 20
        ";

        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $candidates = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // 各候補に「どのフィールドでマッチしたか」を付与
        // フロントでハイライト表示するために使う
        $phoneNormalize = fn($s) => preg_replace('/[-\s()\+]/', '', $s ?? '');
        foreach ($candidates as &$c) {
            $c['id']                = (int) $c['id'];
            $c['stay_count']        = (int) $c['stay_count'];
            $c['is_vip']            = (bool) $c['is_vip'];
            $c['reservation_count'] = (int) $c['reservation_count'];

            // マッチしたフィールドを判定
            $matched = [];
            foreach ($searchTerms as $term) {
                $lower = mb_strtolower($term);
                $termPhoneNorm = $phoneNormalize($term);
                if ($c['name_kanji'] && mb_stripos($c['name_kanji'], $term) !== false) $matched['name_kanji'] = true;
                if ($c['name_kana'] && mb_stripos($c['name_kana'], $term) !== false) $matched['name_kana'] = true;
                if ($c['name_romaji'] && mb_stripos($c['name_romaji'], $term) !== false) $matched['name_romaji'] = true;
                if ($c['phone'] && (
                    mb_strpos($c['phone'], $term) !== false ||
                    mb_strpos($phoneNormalize($c['phone']), $termPhoneNorm) !== false
                )) $matched['phone'] = true;
                if ($c['email'] && mb_stripos($c['email'], $term) !== false) $matched['email'] = true;
            }
            $c['matched_fields'] = array_keys($matched);
        }

        Response::json(['candidates' => $candidates]);
    }

    /**
     * POST /api/v1/reservations/:id/link-guest — ゲスト紐付け
     *
     * 予約を指定されたゲストに紐付ける（名寄せ操作）。
     * TL取込時に自動作成されたゲストから、正しいゲストに付け替える。
     *
     * Body: { guest_id: 100 }
     */
    public function linkGuest(Request $request): void
    {
        $db = Database::getInstance();
        $reservationId = (int) $request->params['id'];
        $staffId = $request->auth['staff_id'];
        $newGuestId = $request->body['guest_id'] ?? null;

        if (!$newGuestId) {
            Response::error('guest_id は必須です', 400);
            return;
        }
        $newGuestId = (int) $newGuestId;

        // 予約の存在確認
        $stmt = $db->prepare("SELECT id, guest_id, guest_match_status FROM reservations WHERE id = :id");
        $stmt->execute(['id' => $reservationId]);
        $reservation = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$reservation) {
            Response::error('予約が見つかりません', 404);
            return;
        }

        // ゲストの存在確認
        $stmt = $db->prepare("SELECT id, guest_code, name_kanji, name_kana, name_romaji FROM guests WHERE id = :id AND status = 'active'");
        $stmt->execute(['id' => $newGuestId]);
        $guest = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$guest) {
            Response::error('ゲストが見つかりません', 404);
            return;
        }

        $oldGuestId = $reservation['guest_id'] ? (int) $reservation['guest_id'] : null;
        $migrateAll = !empty($request->body['migrate_all']);

        $db->beginTransaction();
        try {
            // migrate_all: 旧ゲストに紐づく全予約を新ゲストに移行
            // 同一人物の予約→キャンセル→再予約で複数ゲストができるケースを一括解決
            if ($migrateAll && $oldGuestId && $oldGuestId !== $newGuestId) {
                $migratedStmt = $db->prepare("
                    SELECT id FROM reservations WHERE guest_id = :old_gid AND id != :rid
                ");
                $migratedStmt->execute(['old_gid' => $oldGuestId, 'rid' => $reservationId]);
                $otherReservationIds = $migratedStmt->fetchAll(PDO::FETCH_COLUMN);

                // 旧ゲストの全予約を新ゲストに差し替え
                $db->prepare("
                    UPDATE reservations
                    SET guest_id = :new_gid, guest_match_status = 'matched', updated_at = NOW(), updated_by = :staff_id
                    WHERE guest_id = :old_gid
                ")->execute([
                    'new_gid'  => $newGuestId,
                    'old_gid'  => $oldGuestId,
                    'staff_id' => $staffId,
                ]);

                // 移行した予約にもイベント記録
                $guestName = $guest['name_kanji'] ?? $guest['name_kana'] ?? $guest['name_romaji'];
                foreach ($otherReservationIds as $otherRid) {
                    $db->prepare("
                        INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, detail, staff_id)
                        VALUES (:rid, 'guest_link', NOW(), :summary, :detail, :staff_id)
                    ")->execute([
                        'rid'      => $otherRid,
                        'summary'  => "{$guest['guest_code']} {$guestName} に名寄せ移行",
                        'detail'   => json_encode([
                            'old_guest_id' => $oldGuestId,
                            'new_guest_id' => $newGuestId,
                            'migrated_from' => $reservationId,
                        ], JSON_UNESCAPED_UNICODE),
                        'staff_id' => $staffId,
                    ]);
                }
            } else {
                // 単一予約のみ差し替え
                $db->prepare("
                    UPDATE reservations
                    SET guest_id = :guest_id, guest_match_status = 'matched', updated_at = NOW(), updated_by = :staff_id
                    WHERE id = :id
                ")->execute([
                    'guest_id' => $newGuestId,
                    'staff_id' => $staffId,
                    'id'       => $reservationId,
                ]);
            }

            // イベント履歴に記録
            $guestName = $guest['name_kanji'] ?? $guest['name_kana'] ?? $guest['name_romaji'];
            $db->prepare("
                INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, detail, staff_id)
                VALUES (:rid, 'guest_link', NOW(), :summary, :detail, :staff_id)
            ")->execute([
                'rid'      => $reservationId,
                'summary'  => "{$guest['guest_code']} {$guestName} に紐付け",
                'detail'   => json_encode([
                    'old_guest_id' => $oldGuestId,
                    'new_guest_id' => $newGuestId,
                    'guest_code'   => $guest['guest_code'],
                    'migrate_all'  => $migrateAll,
                ], JSON_UNESCAPED_UNICODE),
                'staff_id' => $staffId,
            ]);

            // 操作ログ
            $db->prepare("
                INSERT INTO staff_activity_logs (staff_id, action, target_type, target_id, detail)
                VALUES (:staff_id, 'link_guest', 'reservation', :target_id, :detail)
            ")->execute([
                'staff_id'  => $staffId,
                'target_id' => $reservationId,
                'detail'    => json_encode([
                    'old_guest_id' => $oldGuestId,
                    'new_guest_id' => $newGuestId,
                ], JSON_UNESCAPED_UNICODE),
            ]);

            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            Response::error('紐付けに失敗しました: ' . $e->getMessage(), 500);
            return;
        }

        Response::json([
            'message'    => 'ゲストを紐付けました',
            'guest_id'   => $newGuestId,
            'guest_code' => $guest['guest_code'],
            'guest_name' => $guestName,
        ]);
    }
}
