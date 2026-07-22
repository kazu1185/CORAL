<?php

namespace App\Controllers;

use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use PDO;

/**
 * マスタ管理コントローラー
 * Phase 11: 全マスタデータのCRUD APIを提供
 */
class MasterController
{
    // ============================================================
    // 部屋タイプ
    // ============================================================

    /** GET /api/v1/master/room-types */
    public function roomTypes(Request $request): void
    {
        $db = Database::getInstance();
        // all=1 で非アクティブ（論理削除済み）も返す（設定画面用）
        // 通常のAPI呼び出し（アサインボード等）ではアクティブのみ
        $includeAll = ($request->query['all'] ?? '') === '1';

        $sql = "
            SELECT id, type_code, type_name, max_adults, max_occupancy,
                   description, sort_order, is_active
            FROM room_types
        ";
        if (!$includeAll) {
            $sql .= " WHERE is_active = 1";
        }
        $sql .= " ORDER BY sort_order";

        $stmt = $db->query($sql);
        Response::json(['room_types' => $stmt->fetchAll()]);
    }

    /** POST /api/v1/master/room-types */
    public function storeRoomType(Request $request): void
    {
        $body = $request->body;

        if (empty($body['type_code']) || empty($body['type_name'])) {
            Response::error('タイプコードとタイプ名は必須です', 400);
        }

        // max_adults ≤ max_occupancy のバリデーション
        $maxAdults = $body['max_adults'] ?? 2;
        $maxOccupancy = $body['max_occupancy'] ?? 3;
        if ($maxAdults > $maxOccupancy) {
            Response::error('大人最大人数は最大定員以下にしてください', 400);
        }

        $db = Database::getInstance();

        // type_code の一意性チェック（予約データから参照されるため重複不可）
        $this->assertUniqueCode($db, 'room_types', 'type_code', $body['type_code'], 'このタイプコードは既に使用されています');

        $stmt = $db->prepare("
            INSERT INTO room_types (type_code, type_name, max_adults, max_occupancy, description, sort_order, is_active)
            VALUES (:type_code, :type_name, :max_adults, :max_occupancy, :description, :sort_order, 1)
        ");
        $stmt->execute([
            'type_code'     => $body['type_code'],
            'type_name'     => $body['type_name'],
            'max_adults'    => $maxAdults,
            'max_occupancy' => $maxOccupancy,
            'description'   => $body['description'] ?? null,
            'sort_order'    => $body['sort_order'] ?? 99,
        ]);

        Response::json(['message' => '作成しました', 'id' => (int) $db->lastInsertId()], 201);
    }

    /** PUT /api/v1/master/room-types/:id */
    public function updateRoomType(Request $request): void
    {
        $body = $request->body;

        // max_adults ≤ max_occupancy のバリデーション（定員超過を防ぐため）
        if (isset($body['max_adults'], $body['max_occupancy'])) {
            if ($body['max_adults'] > $body['max_occupancy']) {
                Response::error('大人最大人数は最大定員以下にしてください', 400);
            }
        }

        // type_code は変更不可（予約データからFK参照されるためホワイトリストに含めない）
        $this->updateMaster(
            'room_types',
            $request->params['id'] ?? null,
            ['type_name', 'max_adults', 'max_occupancy', 'description', 'sort_order', 'is_active'],
            $body,
            '部屋タイプが見つかりません'
        );
    }

    // ============================================================
    // 部屋
    // ============================================================

    /** GET /api/v1/master/rooms */
    public function rooms(Request $request): void
    {
        $db = Database::getInstance();
        $stmt = $db->query("
            SELECT r.id, r.room_number, r.floor, r.room_type_id, r.status,
                   r.sort_order, r.notes,
                   rt.type_code, rt.type_name
            FROM rooms r
            JOIN room_types rt ON r.room_type_id = rt.id
            ORDER BY r.floor, r.sort_order, r.room_number
        ");
        Response::json(['rooms' => $stmt->fetchAll()]);
    }

    /** PUT /api/v1/master/rooms/:id */
    public function updateRoom(Request $request): void
    {
        $id = $request->params['id'] ?? null;
        $body = $request->body;

        $db = Database::getInstance();

        // room_type_idが指定されている場合、存在確認（不正なタイプへの変更を防ぐ）
        if (isset($body['room_type_id'])) {
            $check = $db->prepare("SELECT id FROM room_types WHERE id = :id");
            $check->execute(['id' => $body['room_type_id']]);
            if (!$check->fetch()) {
                Response::error('指定された部屋タイプが存在しません', 400);
            }
        }

        // room_number は変更不可（物理的な部屋番号のためホワイトリストに含めない）
        $this->updateMaster('rooms', $id, ['room_type_id', 'status', 'sort_order', 'notes'], $body, '部屋が見つかりません');
    }

    // ============================================================
    // プラン
    // ============================================================

    /** GET /api/v1/master/plans */
    public function plans(Request $request): void
    {
        $db = Database::getInstance();
        // 設定画面では非アクティブも表示する（管理者がステータスを確認・変更するため）
        $stmt = $db->query("
            SELECT id, plan_name, meal_type, breakfast_price, dinner_price, is_active
            FROM plans
            ORDER BY id
        ");
        Response::json(['plans' => $stmt->fetchAll()]);
    }

    /** POST /api/v1/master/plans */
    public function storePlan(Request $request): void
    {
        $body = $request->body;
        $required = ['plan_name', 'meal_type'];

        foreach ($required as $field) {
            if (empty($body[$field])) {
                Response::error("{$field} は必須です", 400);
            }
        }

        $validMealTypes = ['none', 'breakfast', 'dinner', 'two_meals'];
        if (!in_array($body['meal_type'], $validMealTypes, true)) {
            Response::error('無効な食事タイプです', 400);
        }

        $db = Database::getInstance();
        $stmt = $db->prepare("
            INSERT INTO plans (plan_name, meal_type, breakfast_price, dinner_price, is_active)
            VALUES (:plan_name, :meal_type, :breakfast_price, :dinner_price, 1)
        ");
        $stmt->execute([
            'plan_name'       => $body['plan_name'],
            'meal_type'       => $body['meal_type'],
            'breakfast_price' => $body['breakfast_price'] ?? 0,
            'dinner_price'    => $body['dinner_price'] ?? 0,
        ]);

        Response::json(['message' => '作成しました', 'id' => (int) $db->lastInsertId()], 201);
    }

    /** PUT /api/v1/master/plans/:id */
    public function updatePlan(Request $request): void
    {
        $this->updateMaster(
            'plans',
            $request->params['id'] ?? null,
            ['plan_name', 'meal_type', 'breakfast_price', 'dinner_price', 'is_active'],
            $request->body,
            'プランが見つかりません'
        );
    }

    // ============================================================
    // 宿泊税
    // ============================================================

    /** GET /api/v1/master/tax-rules */
    public function taxRules(Request $request): void
    {
        $db = Database::getInstance();
        $rulesStmt = $db->query("
            SELECT id, prefecture_code, municipality_code, tax_type, rate,
                   round_unit, max_base_amount, max_tax_amount,
                   include_consumption_tax, min_charge, child_exempt,
                   valid_from, valid_to
            FROM accommodation_tax_rules
            ORDER BY id
        ");
        $rules = $rulesStmt->fetchAll();

        // 各ルールにbrackets（定額制の料金帯）をネスト
        $bracketStmt = $db->prepare("
            SELECT id, min_amount, max_amount, tax_amount
            FROM accommodation_tax_flat_brackets
            WHERE rule_id = :rule_id
            ORDER BY min_amount
        ");

        foreach ($rules as &$rule) {
            $bracketStmt->execute(['rule_id' => $rule['id']]);
            $rule['brackets'] = $bracketStmt->fetchAll();
        }

        Response::json(['tax_rules' => $rules]);
    }

    /** PUT /api/v1/master/tax-rules/:id */
    public function updateTaxRule(Request $request): void
    {
        $id = $request->params['id'] ?? null;
        $body = $request->body;

        $db = Database::getInstance();

        // 存在確認
        $check = $db->prepare("SELECT id FROM accommodation_tax_rules WHERE id = :id");
        $check->execute(['id' => $id]);
        if (!$check->fetch()) {
            Response::error('宿泊税ルールが見つかりません', 404);
        }

        // バリデーション
        if (isset($body['tax_type'])) {
            if ($body['tax_type'] === 'rate' && empty($body['rate'])) {
                Response::error('定率制の場合、税率は必須です', 400);
            }
        }

        // トランザクション内で更新（ルールとbracketsの整合性を保つため）
        $db->beginTransaction();
        try {
            $allowed = [
                'prefecture_code', 'municipality_code', 'tax_type', 'rate',
                'round_unit', 'max_base_amount', 'max_tax_amount',
                'include_consumption_tax', 'min_charge', 'child_exempt',
                'valid_from', 'valid_to'
            ];
            $params = ['id' => $id];
            $sets = $this->buildUpdateSets($allowed, $body, $params);

            if (!empty($sets)) {
                $sql = "UPDATE accommodation_tax_rules SET " . implode(', ', $sets) . " WHERE id = :id";
                $stmt = $db->prepare($sql);
                $stmt->execute($params);
            }

            // brackets が送られた場合、全削除→再挿入（設定データなので物理削除OK）
            if (isset($body['brackets']) && is_array($body['brackets'])) {
                $db->prepare("DELETE FROM accommodation_tax_flat_brackets WHERE rule_id = :rule_id")
                   ->execute(['rule_id' => $id]);

                $insertStmt = $db->prepare("
                    INSERT INTO accommodation_tax_flat_brackets (rule_id, min_amount, max_amount, tax_amount)
                    VALUES (:rule_id, :min_amount, :max_amount, :tax_amount)
                ");

                foreach ($body['brackets'] as $bracket) {
                    $insertStmt->execute([
                        'rule_id'    => $id,
                        'min_amount' => $bracket['min_amount'],
                        'max_amount' => $bracket['max_amount'] ?? null,
                        'tax_amount' => $bracket['tax_amount'],
                    ]);
                }
            }

            $db->commit();
            Response::json(['message' => '更新しました']);
        } catch (\Throwable $e) {
            $db->rollBack();
            Response::error('宿泊税ルールの更新に失敗しました: ' . $e->getMessage(), 500);
        }
    }

    // ============================================================
    // 法人
    // ============================================================

    /** GET /api/v1/master/corporates */
    public function corporates(Request $request): void
    {
        $db = Database::getInstance();
        // 設定画面では非アクティブも表示
        $stmt = $db->query("
            SELECT id, company_name, billing_address, contact_person, contact_email,
                   payment_cycle, payment_terms, notes, is_active
            FROM corporate_clients
            ORDER BY is_active DESC, company_name
        ");
        Response::json(['corporates' => $stmt->fetchAll()]);
    }

    /** POST /api/v1/master/corporates */
    public function storeCorporate(Request $request): void
    {
        $body = $request->body;

        if (empty($body['company_name'])) {
            Response::error('会社名は必須です', 400);
        }

        $db = Database::getInstance();
        $stmt = $db->prepare("
            INSERT INTO corporate_clients
                (company_name, billing_address, contact_person, contact_email,
                 payment_cycle, payment_terms, notes, is_active, updated_by)
            VALUES
                (:company_name, :billing_address, :contact_person, :contact_email,
                 :payment_cycle, :payment_terms, :notes, 1, :updated_by)
        ");
        $stmt->execute([
            'company_name'   => $body['company_name'],
            'billing_address' => $body['billing_address'] ?? null,
            'contact_person' => $body['contact_person'] ?? null,
            'contact_email'  => $body['contact_email'] ?? null,
            'payment_cycle'  => $body['payment_cycle'] ?? 'monthly',
            'payment_terms'  => $body['payment_terms'] ?? null,
            'notes'          => $body['notes'] ?? null,
            'updated_by'     => $request->auth['id'] ?? null,
        ]);

        Response::json(['message' => '作成しました', 'id' => (int) $db->lastInsertId()], 201);
    }

    /** PUT /api/v1/master/corporates/:id */
    public function updateCorporate(Request $request): void
    {
        $this->updateMaster(
            'corporate_clients',
            $request->params['id'] ?? null,
            [
                'company_name', 'billing_address', 'contact_person', 'contact_email',
                'payment_cycle', 'payment_terms', 'notes', 'is_active'
            ],
            $request->body,
            '法人が見つかりません',
            ['updated_by = :updated_by'],
            ['updated_by' => $request->auth['id'] ?? null]
        );
    }

    // ============================================================
    // スタッフ
    // ============================================================

    /** GET /api/v1/master/staff */
    public function staff(Request $request): void
    {
        $db = Database::getInstance();
        // pin_hashは絶対に返さない（セキュリティ）
        $stmt = $db->query("
            SELECT id, staff_name, login_name, role, must_change_pin,
                   is_active, created_at, updated_at
            FROM staff
            ORDER BY is_active DESC, role, id
        ");
        Response::json(['staff' => $stmt->fetchAll()]);
    }

    /** POST /api/v1/master/staff */
    public function storeStaff(Request $request): void
    {
        $body = $request->body;
        $required = ['staff_name', 'login_name', 'role', 'pin'];

        foreach ($required as $field) {
            if (empty($body[$field])) {
                Response::error("{$field} は必須です", 400);
            }
        }

        $validRoles = ['admin', 'front_manager', 'front', 'housekeeping'];
        if (!in_array($body['role'], $validRoles, true)) {
            Response::error('無効なロールです', 400);
        }

        // PIN長の検証
        $pin = $body['pin'];
        if (!preg_match('/^\d{4,6}$/', $pin)) {
            Response::error('PINは4〜6桁の数字で入力してください', 400);
        }

        $db = Database::getInstance();

        // login_name の一意性チェック（重複ログイン名を防ぐ）
        $this->assertUniqueCode($db, 'staff', 'login_name', $body['login_name'], 'このログイン名は既に使用されています');

        $stmt = $db->prepare("
            INSERT INTO staff (staff_name, login_name, pin_hash, role, must_change_pin, is_active)
            VALUES (:staff_name, :login_name, :pin_hash, :role, 1, 1)
        ");
        $stmt->execute([
            'staff_name' => $body['staff_name'],
            'login_name' => $body['login_name'],
            'pin_hash'   => password_hash($pin, PASSWORD_BCRYPT),
            'role'       => $body['role'],
        ]);

        $newId = (int) $db->lastInsertId();

        // 操作ログ記録（誰がスタッフを追加したか追跡するため）
        $this->logActivity($db, $request->auth['id'] ?? null, 'staff_create', "スタッフ追加: {$body['staff_name']} (ID:{$newId})");

        Response::json(['message' => '作成しました', 'id' => $newId], 201);
    }

    /** PUT /api/v1/master/staff/:id */
    public function updateStaff(Request $request): void
    {
        $id = $request->params['id'] ?? null;
        $body = $request->body;

        $db = Database::getInstance();

        // 自分自身の無効化を防止（管理者が自身をロックアウトしないように）
        if (isset($body['is_active']) && !$body['is_active'] && (int) $id === ($request->auth['id'] ?? null)) {
            Response::error('自分自身を無効化することはできません', 400);
        }

        // 最後のadmin無効化を防止（管理不能状態を防ぐ）
        if (isset($body['is_active']) && !$body['is_active']) {
            $target = $db->prepare("SELECT role FROM staff WHERE id = :id");
            $target->execute(['id' => $id]);
            $targetStaff = $target->fetch();

            if ($targetStaff && $targetStaff['role'] === 'admin') {
                $countStmt = $db->prepare("SELECT COUNT(*) as cnt FROM staff WHERE role = 'admin' AND is_active = 1 AND id != :id");
                $countStmt->execute(['id' => $id]);
                $count = $countStmt->fetch();
                if ($count['cnt'] < 1) {
                    Response::error('最後の管理者を無効化することはできません', 400);
                }
            }
        }

        // login_nameの一意性チェック（変更時のみ・自分自身は除外）
        if (isset($body['login_name'])) {
            $this->assertUniqueCode($db, 'staff', 'login_name', $body['login_name'], 'このログイン名は既に使用されています', (int) $id);
        }

        $this->updateMaster('staff', $id, ['staff_name', 'login_name', 'role', 'is_active'], $body, 'スタッフが見つかりません');
    }

    /** POST /api/v1/master/staff/:id/reset-pin */
    public function resetPin(Request $request): void
    {
        $id = $request->params['id'] ?? null;

        $db = Database::getInstance();

        // デフォルトPIN '1234' にリセット + 次回ログイン時に変更を強制
        $stmt = $db->prepare("
            UPDATE staff
            SET pin_hash = :pin_hash, must_change_pin = 1
            WHERE id = :id AND is_active = 1
        ");
        $stmt->execute([
            'pin_hash' => password_hash('1234', PASSWORD_BCRYPT),
            'id'       => $id,
        ]);

        if ($stmt->rowCount() === 0) {
            Response::error('スタッフが見つかりません', 404);
        }

        // 操作ログ記録（PINリセットはセキュリティ上重要な操作のため必ず記録）
        $this->logActivity($db, $request->auth['id'] ?? null, 'pin_reset', "PINリセット: スタッフID {$id}");

        Response::json(['message' => 'PINをリセットしました（初期PIN: 1234）']);
    }

    // ============================================================
    // 権限
    // ============================================================

    /** GET /api/v1/master/permissions */
    public function permissions(Request $request): void
    {
        $db = Database::getInstance();
        $stmt = $db->query("
            SELECT id, permission_key, permission_name, category, sort_order
            FROM permissions
            ORDER BY sort_order
        ");
        Response::json(['permissions' => $stmt->fetchAll()]);
    }

    /** GET /api/v1/master/role-permissions/:role */
    public function rolePermissions(Request $request): void
    {
        $role = $request->params['role'] ?? null;

        $validRoles = ['admin', 'front_manager', 'front', 'housekeeping'];
        if (!in_array($role, $validRoles, true)) {
            Response::error('無効なロールです', 400);
        }

        $db = Database::getInstance();
        $stmt = $db->prepare("
            SELECT permission_key, is_granted
            FROM role_permissions
            WHERE role = :role
        ");
        $stmt->execute(['role' => $role]);

        // permission_key → is_granted のマップで返す（フロント側で扱いやすくするため）
        $result = [];
        foreach ($stmt->fetchAll() as $row) {
            $result[$row['permission_key']] = (bool) $row['is_granted'];
        }

        Response::json(['role' => $role, 'permissions' => $result]);
    }

    /** PUT /api/v1/master/role-permissions/:role */
    public function updateRolePermissions(Request $request): void
    {
        $role = $request->params['role'] ?? null;

        // admin権限は固定（全権限付与済み）のため変更不可
        if ($role === 'admin') {
            Response::error('admin ロールの権限は変更できません', 400);
        }

        $validRoles = ['front_manager', 'front', 'housekeeping'];
        if (!in_array($role, $validRoles, true)) {
            Response::error('無効なロールです', 400);
        }

        $body = $request->body;
        $permissions = $body['permissions'] ?? [];

        if (!is_array($permissions)) {
            Response::error('permissions は配列で指定してください', 400);
        }

        $db = Database::getInstance();
        $staffId = $request->auth['id'] ?? null;

        // INSERT ON DUPLICATE KEYで一括更新（既存レコードがあればupdate、なければinsert）
        $stmt = $db->prepare("
            INSERT INTO role_permissions (role, permission_key, is_granted, updated_by)
            VALUES (:role, :permission_key, :is_granted, :updated_by)
            ON DUPLICATE KEY UPDATE is_granted = VALUES(is_granted), updated_by = VALUES(updated_by)
        ");

        foreach ($permissions as $permKey => $isGranted) {
            $stmt->execute([
                'role'           => $role,
                'permission_key' => $permKey,
                'is_granted'     => $isGranted ? 1 : 0,
                'updated_by'     => $staffId,
            ]);
        }

        // 操作ログ（権限変更は影響範囲が大きいため記録）
        $this->logActivity($db, $staffId, 'permission_update', "権限更新: ロール={$role}");

        Response::json(['message' => '権限を更新しました']);
    }

    // ============================================================
    // システム設定
    // ============================================================

    /** GET /api/v1/master/settings */
    public function settings(Request $request): void
    {
        $db = Database::getInstance();
        $stmt = $db->query("SELECT setting_key, setting_value FROM system_settings ORDER BY id");

        // key-valueマップで返す（フロント側でオブジェクトとして扱いやすくするため）
        $result = [];
        foreach ($stmt->fetchAll() as $row) {
            $result[$row['setting_key']] = $row['setting_value'];
        }

        Response::json(['settings' => $result]);
    }

    /** PUT /api/v1/master/settings */
    public function updateSettings(Request $request): void
    {
        $body = $request->body;
        $settings = $body['settings'] ?? [];

        // ホワイトリスト（想定外のキーの注入を防ぐ）
        $allowedKeys = [
            'session_timeout_minutes',
            'pin_min_length',
            'pin_max_length',
            'login_fail_lock_count',
            'login_fail_lock_minutes',
            'show_layout_editor',
        ];

        $db = Database::getInstance();
        $staffId = $request->auth['id'] ?? null;

        $stmt = $db->prepare("
            UPDATE system_settings
            SET setting_value = :value, updated_by = :updated_by
            WHERE setting_key = :key
        ");

        $updated = 0;
        foreach ($settings as $key => $value) {
            if (!in_array($key, $allowedKeys, true)) {
                continue;
            }
            // 数値バリデーション
            // トグル型（0/1）は0を許容、それ以外は1以上の正の整数
            $toggleKeys = ['show_layout_editor'];
            if (in_array($key, $toggleKeys, true)) {
                $value = ((int) $value) ? '1' : '0';
            } elseif (!is_numeric($value) || (int) $value < 1) {
                Response::error("{$key} は1以上の数値を指定してください", 400);
            }
            $stmt->execute(['key' => $key, 'value' => (string) $value, 'updated_by' => $staffId]);
            $updated++;
        }

        Response::json(['message' => "{$updated}件の設定を更新しました"]);
    }

    // ============================================================
    // ホテル基本情報
    // ============================================================

    /** GET /api/v1/master/hotel-info */
    public function hotelInfo(Request $request): void
    {
        $db = Database::getInstance();
        $stmt = $db->query("
            SELECT id, hotel_name, hotel_name_en, postal_code, address, phone,
                   invoice_registration_no
            FROM hotel_settings
            LIMIT 1
        ");
        $info = $stmt->fetch();
        Response::json(['hotel_info' => $info ?: null]);
    }

    /** PUT /api/v1/master/hotel-info */
    public function updateHotelInfo(Request $request): void
    {
        $body = $request->body;

        // 適格請求書番号のフォーマット検証（T + 13桁の数字）
        if (isset($body['invoice_registration_no']) && $body['invoice_registration_no'] !== '') {
            if (!preg_match('/^T\d{13}$/', $body['invoice_registration_no'])) {
                Response::error('適格請求書番号は T + 13桁の数字で入力してください', 400);
            }
        }

        $allowed = ['hotel_name', 'hotel_name_en', 'postal_code', 'address', 'phone', 'invoice_registration_no'];
        $sets = ['updated_by = :updated_by'];
        $params = ['updated_by' => $request->auth['id'] ?? null];
        $sets = array_merge($sets, $this->buildUpdateSets($allowed, $body, $params));

        $db = Database::getInstance();
        // hotel_settingsは1レコードのみ（WHERE条件なし、LIMIT 1相当）
        $sql = "UPDATE hotel_settings SET " . implode(', ', $sets) . " WHERE id = 1";
        $stmt = $db->prepare($sql);
        $stmt->execute($params);

        Response::json(['message' => '更新しました']);
    }

    // ============================================================
    // 決済方法
    // ============================================================

    /** GET /api/v1/master/payment-methods */
    public function paymentMethods(Request $request): void
    {
        $db = Database::getInstance();

        // all=1 パラメータで非アクティブも返す（設定画面用）
        // 通常のAPI呼び出し（予約詳細等）ではアクティブのみ
        $includeAll = ($request->query['all'] ?? '') === '1';

        $sql = "SELECT id, method_code, method_name, sort_order, is_active FROM payment_methods";
        if (!$includeAll) {
            $sql .= " WHERE is_active = 1";
        }
        $sql .= " ORDER BY sort_order";

        $stmt = $db->query($sql);
        Response::json(['payment_methods' => $stmt->fetchAll()]);
    }

    /** POST /api/v1/master/payment-methods */
    public function storePaymentMethod(Request $request): void
    {
        $body = $request->body;

        if (empty($body['method_name']) || empty($body['method_code'])) {
            Response::error('決済方法名とコードは必須です', 400);
        }

        $db = Database::getInstance();

        // method_code の一意性チェック（FK参照で使用されるため重複不可）
        $this->assertUniqueCode($db, 'payment_methods', 'method_code', $body['method_code'], 'この決済コードは既に使用されています');

        $stmt = $db->prepare("
            INSERT INTO payment_methods (method_name, method_code, sort_order, is_active)
            VALUES (:method_name, :method_code, :sort_order, 1)
        ");
        $stmt->execute([
            'method_name' => $body['method_name'],
            'method_code' => $body['method_code'],
            'sort_order'  => $body['sort_order'] ?? 99,
        ]);

        Response::json(['message' => '作成しました', 'id' => (int) $db->lastInsertId()], 201);
    }

    /** PUT /api/v1/master/payment-methods/:id */
    public function updatePaymentMethod(Request $request): void
    {
        $id = $request->params['id'] ?? null;
        $body = $request->body;

        // method_code は変更不可（他テーブルからの参照があるためホワイトリストに含めない）
        $this->updateMaster('payment_methods', $id, ['method_name', 'sort_order', 'is_active'], $body, '決済方法が見つかりません');
    }

    /**
     * POST /api/v1/master/payment-methods/reorder
     * ドラッグ&ドロップ後の並び順を一括更新
     * body: { "order": [3, 1, 5, 2, ...] } — IDの配列（表示順どおり）
     */
    public function reorderPaymentMethods(Request $request): void
    {
        $this->reorderMaster($request, 'payment_methods');
    }

    // ============================================================
    // 商品（物販）
    // ============================================================

    /** GET /api/v1/master/products */
    public function products(Request $request): void
    {
        $db = Database::getInstance();

        // all=1 で非アクティブも返す（設定画面用）。
        // 販売画面（物販ページ・予約詳細のモーダル）は売れる商品だけを出すためアクティブのみ
        $includeAll = ($request->query['all'] ?? '') === '1';

        $sql = "SELECT id, product_name, category, price, tax_rate, sort_order, is_active FROM products";
        if (!$includeAll) {
            $sql .= " WHERE is_active = 1";
        }
        $sql .= " ORDER BY sort_order, id";

        $stmt = $db->query($sql);
        Response::json(['products' => $stmt->fetchAll()]);
    }

    /** POST /api/v1/master/products */
    public function storeProduct(Request $request): void
    {
        $body = $request->body;

        if (empty($body['product_name'])) {
            Response::error('商品名は必須です', 400);
        }
        // 新規作成時は price / tax_rate の省略を許さない（未指定で0円・税率0の商品が生まれるのを防ぐ）
        if (!isset($body['price']) || !isset($body['tax_rate'])) {
            Response::error('価格と税率は必須です', 400);
        }
        $this->assertValidProductFields($body);

        $db = Database::getInstance();
        $stmt = $db->prepare("
            INSERT INTO products (product_name, category, price, tax_rate, sort_order, is_active)
            VALUES (:product_name, :category, :price, :tax_rate, :sort_order, 1)
        ");
        $stmt->execute([
            'product_name' => $body['product_name'],
            'category'     => $body['category'] ?: 'その他',
            'price'        => (int) $body['price'],
            'tax_rate'     => (int) $body['tax_rate'],
            'sort_order'   => $body['sort_order'] ?? 99,
        ]);

        Response::json(['message' => '作成しました', 'id' => (int) $db->lastInsertId()], 201);
    }

    /** PUT /api/v1/master/products/:id */
    public function updateProduct(Request $request): void
    {
        $id = $request->params['id'] ?? null;
        $body = $request->body;

        // is_active のみのトグル更新（useMasterCrud）でも通るよう、送られた項目だけ検証する
        $this->assertValidProductFields($body);

        $this->updateMaster(
            'products',
            $id,
            ['product_name', 'category', 'price', 'tax_rate', 'sort_order', 'is_active'],
            $body,
            '商品が見つかりません'
        );
    }

    /** POST /api/v1/master/products/reorder */
    public function reorderProducts(Request $request): void
    {
        $this->reorderMaster($request, 'products');
    }

    /**
     * 商品の価格・税率のバリデーション
     * 税率の選択肢（8/10）はハードコード禁止ルールの対象外:
     *   ここは「DBに保存してよい値かどうか」の入力検証であり、
     *   金額計算に税率を埋め込んでいるわけではない（計算は常に products.tax_rate を参照する）
     */
    private function assertValidProductFields(array $body): void
    {
        if (array_key_exists('price', $body)) {
            if (!is_numeric($body['price']) || (int) $body['price'] < 0) {
                Response::error('価格は0以上の数値で入力してください', 400);
            }
        }
        if (array_key_exists('tax_rate', $body)) {
            if (!in_array((int) $body['tax_rate'], [10, 8], true)) {
                Response::error('税率は10%または8%（軽減税率）のみ指定できます', 400);
            }
        }
    }

    /**
     * POST /api/v1/master/rooms/reorder
     * フロア内の部屋並び順を一括更新
     * body: { "order": [5, 3, 1, 2, ...] } — 部屋IDの配列（表示順どおり）
     */
    public function reorderRooms(Request $request): void
    {
        $this->reorderMaster($request, 'rooms');
    }

    /**
     * POST /api/v1/master/room-types/reorder
     * 部屋タイプの並び順を一括更新
     */
    public function reorderRoomTypes(Request $request): void
    {
        $this->reorderMaster($request, 'room_types');
    }

    // ============================================================
    // ヘルパー
    // ============================================================

    /**
     * ホワイトリストに基づいて UPDATE の SET句とバインドパラメータを組み立てる
     * 各マスタの update メソッドで同一のループがコピペされていたため集約した。
     * プレースホルダ名はフィールド名と同名（規約 #3: 同名プレースホルダの重複使用はないこと）
     */
    private function buildUpdateSets(array $allowed, array $body, array &$params): array
    {
        $sets = [];
        foreach ($allowed as $field) {
            if (array_key_exists($field, $body)) {
                $sets[] = "{$field} = :{$field}";
                $params[$field] = $body[$field];
            }
        }
        return $sets;
    }

    /**
     * マスタ更新の共通処理（WHERE id = :id の標準パターン）
     * 「ホワイトリスト→SET句組立→UPDATE→404判定→完了レスポンス」が
     * 8つの update メソッドで同じ構造のコピペになっていたため集約した。
     *
     * @param array $extraSets   ホワイトリスト外で常に付与するSET句（例: 'updated_by = :updated_by'）
     * @param array $extraParams $extraSets 用のバインドパラメータ
     */
    private function updateMaster(string $table, mixed $id, array $allowed, array $body, string $notFoundMessage, array $extraSets = [], array $extraParams = []): void
    {
        $params = array_merge(['id' => $id], $extraParams);
        $sets = array_merge($extraSets, $this->buildUpdateSets($allowed, $body, $params));

        // extraSets がある場合（updated_by 等）は本体フィールドが空でも更新を実行する（従来挙動の維持）
        if (empty($sets)) {
            Response::error('更新するフィールドがありません', 400);
        }

        $db = Database::getInstance();
        $stmt = $db->prepare("UPDATE {$table} SET " . implode(', ', $sets) . " WHERE id = :id");
        $stmt->execute($params);

        if ($stmt->rowCount() === 0) {
            Response::error($notFoundMessage, 404);
        }

        Response::json(['message' => '更新しました']);
    }

    /**
     * コード系カラムの一意性チェック
     * type_code / method_code / channel_code / login_name は予約データや他テーブルから
     * 参照されるため重複登録を防ぐ。$excludeId は更新時に自分自身を除外する用。
     */
    private function assertUniqueCode(\PDO $db, string $table, string $column, mixed $value, string $message, ?int $excludeId = null): void
    {
        $sql = "SELECT id FROM {$table} WHERE {$column} = :value";
        $params = ['value' => $value];
        if ($excludeId !== null) {
            $sql .= " AND id != :exclude_id";
            $params['exclude_id'] = $excludeId;
        }
        $check = $db->prepare($sql);
        $check->execute($params);
        if ($check->fetch()) {
            Response::error($message, 400);
        }
    }

    /**
     * 並び順一括更新の共通処理
     * payment_methods / rooms / room_types で完全に同一のロジックだったため集約。
     * SQLインジェクション防止のため、$table には呼び出し側の固定文字列のみ渡すこと
     */
    private function reorderMaster(Request $request, string $table): void
    {
        $order = $request->body['order'] ?? null;
        if (!is_array($order) || empty($order)) {
            Response::error('order 配列は必須です', 400);
        }

        $db = Database::getInstance();
        $stmt = $db->prepare("UPDATE {$table} SET sort_order = :sort WHERE id = :id");
        foreach ($order as $index => $id) {
            $stmt->execute([
                'sort' => $index + 1, // 1始まり
                'id'   => (int) $id,
            ]);
        }

        Response::json(['message' => '並び順を更新しました']);
    }

    /**
     * 操作ログ記録
     * 重要な操作（スタッフ追加・PINリセット・権限変更）を追跡するため
     */
    private function logActivity(\PDO $db, ?int $staffId, string $action, string $detail): void
    {
        try {
            // detailカラムはJSON型のため、文字列をJSONオブジェクトに変換
            $stmt = $db->prepare("
                INSERT INTO staff_activity_logs (staff_id, action, detail, created_at)
                VALUES (:staff_id, :action, :detail, NOW())
            ");
            $stmt->execute([
                'staff_id' => $staffId,
                'action'   => $action,
                'detail'   => json_encode(['message' => $detail], JSON_UNESCAPED_UNICODE),
            ]);
        } catch (\Throwable $e) {
            // ログ記録失敗は本体処理をブロックしない
        }
    }

    // ============================================================
    // チャネルマスタ
    // ============================================================

    /** GET /api/v1/master/channels */
    public function channels(Request $request): void
    {
        $db = Database::getInstance();
        $includeAll = ($request->query['all'] ?? '') === '1';

        $sql = "
            SELECT id, channel_code, channel_name, color, channel_type,
                   tl_match_patterns, sort_order, is_active
            FROM channels
        ";
        if (!$includeAll) {
            $sql .= " WHERE is_active = 1";
        }
        $sql .= " ORDER BY sort_order";

        $stmt = $db->query($sql);
        $channels = $stmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($channels as &$ch) {
            $ch['id'] = (int) $ch['id'];
            $ch['sort_order'] = (int) $ch['sort_order'];
            $ch['is_active'] = (bool) $ch['is_active'];
        }

        Response::json(['channels' => $channels]);
    }

    /** POST /api/v1/master/channels */
    public function storeChannel(Request $request): void
    {
        $body = $request->body;

        if (empty($body['channel_code']) || empty($body['channel_name'])) {
            Response::error('チャネルコードとチャネル名は必須です', 400);
            return;
        }

        // チャネルコードは英数字・アンダースコアのみ
        if (!preg_match('/^[a-z0-9_]+$/', $body['channel_code'])) {
            Response::error('チャネルコードは英小文字・数字・アンダースコアのみ使用できます', 400);
            return;
        }

        $db = Database::getInstance();

        // channel_code の一意性チェック（予約データから参照されるため重複不可）
        $this->assertUniqueCode($db, 'channels', 'channel_code', $body['channel_code'], 'このチャネルコードは既に使用されています');

        $stmt = $db->prepare("
            INSERT INTO channels (channel_code, channel_name, color, channel_type, tl_match_patterns, sort_order, is_active)
            VALUES (:code, :name, :color, :type, :patterns, :sort, 1)
        ");
        $stmt->execute([
            'code'     => $body['channel_code'],
            'name'     => $body['channel_name'],
            'color'    => $body['color'] ?? '#6B7280',
            'type'     => $body['channel_type'] ?? 'ota',
            'patterns' => $body['tl_match_patterns'] ?? null,
            'sort'     => $body['sort_order'] ?? 99,
        ]);

        $newId = (int) $db->lastInsertId();

        Response::json(['message' => 'チャネルを作成しました', 'id' => $newId], 201);
    }

    /** PUT /api/v1/master/channels/:id */
    public function updateChannel(Request $request): void
    {
        $id = $request->params['id'] ?? null;
        $body = $request->body;

        // channel_code は変更不可（予約データのchannel列から参照されるためホワイトリストに含めない）
        $this->updateMaster('channels', $id, ['channel_name', 'color', 'channel_type', 'tl_match_patterns', 'sort_order', 'is_active'], $body, 'チャネルが見つかりません');
    }

    /**
     * POST /api/v1/master/channels/remap-other
     * 新チャネル登録後に、channel='other' の予約を新チャネルに一括変更する
     * tl_match_patterns でreservation_eventsのunknown_channelイベントを照合し、
     * マッチした予約のchannelを更新する
     */
    public function remapOtherReservations(Request $request): void
    {
        $body = $request->body;
        $channelCode = $body['channel_code'] ?? '';

        if (!$channelCode) {
            Response::error('channel_code は必須です', 400);
            return;
        }

        $db = Database::getInstance();

        // 対象チャネルのtl_match_patternsを取得
        $stmt = $db->prepare("SELECT tl_match_patterns FROM channels WHERE channel_code = :code");
        $stmt->execute(['code' => $channelCode]);
        $patterns = $stmt->fetchColumn();

        if (!$patterns) {
            Response::error('このチャネルにはTLマッチパターンが設定されていません', 400);
            return;
        }

        // パターンをカンマ区切りで分解
        $patternList = array_map('trim', explode(',', $patterns));
        $updated = 0;

        // unknown_channelイベントのdetailからcompany_nameを照合し、
        // マッチする予約のchannelを一括更新
        foreach ($patternList as $pattern) {
            // detail JSON内のcompany_nameに部分一致する予約IDを取得
            $matchStmt = $db->prepare("
                SELECT DISTINCT re.reservation_id
                FROM reservation_events re
                JOIN reservations r ON r.id = re.reservation_id
                WHERE re.event_type = 'unknown_channel'
                  AND r.channel = 'other'
                  AND re.detail LIKE :pattern
            ");
            $matchStmt->execute(['pattern' => '%' . $pattern . '%']);
            $ids = $matchStmt->fetchAll(PDO::FETCH_COLUMN);

            if (!empty($ids)) {
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $updateStmt = $db->prepare("
                    UPDATE reservations SET channel = ? WHERE id IN ({$placeholders})
                ");
                $updateStmt->execute(array_merge([$channelCode], $ids));
                $updated += $updateStmt->rowCount();
            }
        }

        Response::json(['message' => "{$updated}件の予約を更新しました", 'updated' => $updated]);
    }
}
