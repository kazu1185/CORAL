<?php

namespace App\Controllers;

use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use PDO;

/**
 * 認証コントローラー
 */
class AuthController
{
    /**
     * POST /api/v1/auth/login
     * PIN照合・セッション発行・ロック判定
     */
    public function login(Request $request): void
    {
        $staffId = $request->body['staff_id'] ?? null;
        $pin = $request->body['pin'] ?? null;

        if ($staffId === null || $pin === null) {
            Response::error('staff_id と pin は必須です', 400);
        }

        $db = Database::getInstance();

        // スタッフ取得（有効なスタッフのみ）
        $stmt = $db->prepare('
            SELECT id, staff_name, login_name, pin_hash, role, must_change_pin,
                   is_active, login_fail_count, last_login_fail_at
            FROM staff
            WHERE id = :id AND is_active = 1
        ');
        $stmt->execute(['id' => $staffId]);
        $staff = $stmt->fetch();

        if (!$staff) {
            Response::error('スタッフが見つかりません', 401);
        }

        // ロック判定
        $lockCount = $this->getSettingValue($db, 'login_fail_lock_count', 5);
        $lockMinutes = $this->getSettingValue($db, 'login_fail_lock_minutes', 15);

        if ($staff['login_fail_count'] >= $lockCount && $staff['last_login_fail_at'] !== null) {
            $lockUntil = strtotime($staff['last_login_fail_at']) + ($lockMinutes * 60);
            if ($lockUntil > time()) {
                $remainMinutes = (int) ceil(($lockUntil - time()) / 60);
                Response::error(
                    "アカウントがロックされています。{$remainMinutes}分後に再試行してください",
                    423
                );
            }
            // ロック期間が過ぎている場合はカウントをリセット
            $db->prepare('UPDATE staff SET login_fail_count = 0 WHERE id = :id')
               ->execute(['id' => $staff['id']]);
            $staff['login_fail_count'] = 0;
        }

        // PIN照合
        if (!password_verify($pin, $staff['pin_hash'])) {
            // 失敗カウント更新
            $db->prepare('
                UPDATE staff
                SET login_fail_count = login_fail_count + 1,
                    last_login_fail_at = NOW()
                WHERE id = :id
            ')->execute(['id' => $staff['id']]);

            Response::error('PINが正しくありません', 401);
        }

        // 成功: 失敗カウントリセット
        $db->prepare('UPDATE staff SET login_fail_count = 0 WHERE id = :id')
           ->execute(['id' => $staff['id']]);

        // セッショントークン生成
        $token = bin2hex(random_bytes(32));
        $timeout = $this->getSettingValue($db, 'session_timeout_minutes', 120);
        $expiresAt = date('Y-m-d H:i:s', time() + ($timeout * 60));

        $db->prepare('
            INSERT INTO staff_sessions (staff_id, session_token, expires_at)
            VALUES (:staff_id, :token, :expires_at)
        ')->execute([
            'staff_id'   => $staff['id'],
            'token'      => $token,
            'expires_at' => $expiresAt,
        ]);

        // 権限一覧取得
        $permissions = $this->getPermissions($db, $staff['role']);

        // 操作ログ記録
        $this->logActivity($db, (int) $staff['id'], 'login');

        Response::json([
            'token' => $token,
            'staff' => [
                'id'              => (int) $staff['id'],
                'staff_name'      => $staff['staff_name'],
                'role'            => $staff['role'],
                'must_change_pin' => (bool) $staff['must_change_pin'],
                'permissions'     => $permissions,
            ],
        ]);
    }

    /**
     * POST /api/v1/auth/logout
     * セッション削除
     */
    public function logout(Request $request): void
    {
        $token = $this->extractBearerToken();
        if ($token === null) {
            Response::error('認証トークンが必要です', 401);
        }

        $db = Database::getInstance();
        $db->prepare('DELETE FROM staff_sessions WHERE session_token = :token')
           ->execute(['token' => $token]);

        // 操作ログ記録
        if ($request->auth !== null) {
            $this->logActivity($db, $request->auth['staff_id'], 'logout');
        }

        Response::json(['message' => 'ログアウトしました']);
    }

    /**
     * GET /api/v1/auth/me
     * 現在のセッション情報
     */
    public function me(Request $request): void
    {
        Response::json([
            'staff' => [
                'id'              => $request->auth['staff_id'],
                'staff_name'      => $request->auth['staff_name'],
                'role'            => $request->auth['role'],
                'must_change_pin' => $request->auth['must_change_pin'],
                'permissions'     => $request->auth['permissions'],
            ],
        ]);
    }

    /**
     * PUT /api/v1/auth/pin
     * PIN変更
     */
    public function changePin(Request $request): void
    {
        $currentPin = $request->body['current_pin'] ?? null;
        $newPin = $request->body['new_pin'] ?? null;

        if ($currentPin === null || $newPin === null) {
            Response::error('current_pin と new_pin は必須です', 400);
        }

        $db = Database::getInstance();

        // 現在のPINハッシュ取得
        $stmt = $db->prepare('SELECT pin_hash FROM staff WHERE id = :id');
        $stmt->execute(['id' => $request->auth['staff_id']]);
        $staff = $stmt->fetch();

        if (!$staff) {
            Response::error('スタッフが見つかりません', 404);
        }

        // 現在のPIN照合
        if (!password_verify($currentPin, $staff['pin_hash'])) {
            Response::error('現在のPINが正しくありません', 401);
        }

        // 新PINの長さ検証
        $minLength = $this->getSettingValue($db, 'pin_min_length', 4);
        $maxLength = $this->getSettingValue($db, 'pin_max_length', 6);

        if (strlen($newPin) < $minLength || strlen($newPin) > $maxLength) {
            Response::error("PINは{$minLength}〜{$maxLength}桁で入力してください", 400);
        }

        // PIN更新
        $newHash = password_hash($newPin, PASSWORD_BCRYPT);
        $db->prepare('
            UPDATE staff
            SET pin_hash = :hash, must_change_pin = 0, updated_at = NOW()
            WHERE id = :id
        ')->execute([
            'hash' => $newHash,
            'id'   => $request->auth['staff_id'],
        ]);

        // 操作ログ記録
        $this->logActivity($db, $request->auth['staff_id'], 'change_pin');

        Response::json(['message' => 'PINを変更しました']);
    }

    /**
     * GET /api/v1/auth/staff-list
     * ログイン画面用スタッフ一覧（認証不要）
     */
    public function staffList(Request $request): void
    {
        $db = Database::getInstance();

        $stmt = $db->query('
            SELECT id, staff_name
            FROM staff
            WHERE is_active = 1
            ORDER BY id
        ');

        Response::json(['staff' => $stmt->fetchAll()]);
    }

    // ================================================================
    // プライベートメソッド
    // ================================================================

    private function extractBearerToken(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION']
            ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
            ?? null;

        if ($header === null) {
            return null;
        }

        if (preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
            return $matches[1];
        }

        return null;
    }

    private function getPermissions(PDO $db, string $role): array
    {
        $stmt = $db->prepare('
            SELECT permission_key
            FROM role_permissions
            WHERE role = :role AND is_granted = 1
        ');
        $stmt->execute(['role' => $role]);
        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    private function getSettingValue(PDO $db, string $key, int $default): int
    {
        $stmt = $db->prepare('
            SELECT setting_value FROM system_settings WHERE setting_key = :key
        ');
        $stmt->execute(['key' => $key]);
        $value = $stmt->fetchColumn();
        return $value !== false ? (int) $value : $default;
    }

    private function logActivity(PDO $db, int $staffId, string $action, ?string $targetType = null, ?int $targetId = null): void
    {
        $db->prepare('
            INSERT INTO staff_activity_logs (staff_id, action, target_type, target_id)
            VALUES (:staff_id, :action, :target_type, :target_id)
        ')->execute([
            'staff_id'    => $staffId,
            'action'      => $action,
            'target_type' => $targetType,
            'target_id'   => $targetId,
        ]);
    }
}
