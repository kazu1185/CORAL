<?php

namespace App\Middleware;

use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use PDO;

/**
 * 認証ミドルウェア（スタッフセッション / デバイストークン）
 */
class AuthMiddleware
{
    /**
     * スタッフセッション認証
     */
    public static function handle(Request $request): void
    {
        $token = self::extractBearerToken();
        if ($token === null) {
            Response::error('認証トークンが必要です', 401);
        }

        $db = Database::getInstance();

        // セッション検索
        $stmt = $db->prepare('
            SELECT ss.id, ss.staff_id, ss.expires_at
            FROM staff_sessions ss
            WHERE ss.session_token = :token
        ');
        $stmt->execute(['token' => $token]);
        $session = $stmt->fetch();

        if (!$session) {
            Response::error('無効なセッショントークンです', 401);
        }

        // 有効期限チェック
        if (strtotime($session['expires_at']) < time()) {
            // 期限切れセッションを削除
            $db->prepare('DELETE FROM staff_sessions WHERE id = :id')
               ->execute(['id' => $session['id']]);
            Response::error('セッションの有効期限が切れています', 401);
        }

        // セッション延長（アイドルタイムアウト）
        $timeout = self::getSettingValue($db, 'session_timeout_minutes', 120);
        $newExpires = date('Y-m-d H:i:s', time() + ($timeout * 60));
        $db->prepare('UPDATE staff_sessions SET expires_at = :expires WHERE id = :id')
           ->execute(['expires' => $newExpires, 'id' => $session['id']]);

        // スタッフ情報取得
        $stmt = $db->prepare('
            SELECT id, staff_name, role, is_active, must_change_pin
            FROM staff
            WHERE id = :id
        ');
        $stmt->execute(['id' => $session['staff_id']]);
        $staff = $stmt->fetch();

        if (!$staff || !$staff['is_active']) {
            Response::error('アカウントが無効です', 401);
        }

        // 権限一覧取得
        $permissions = self::getPermissions($db, $staff['role']);

        $request->auth = [
            'staff_id'       => (int) $staff['id'],
            'staff_name'     => $staff['staff_name'],
            'role'           => $staff['role'],
            'must_change_pin' => (bool) $staff['must_change_pin'],
            'permissions'    => $permissions,
        ];
    }

    /**
     * デバイストークン認証（清掃用iPad等）
     */
    public static function handleDevice(Request $request): void
    {
        $token = $request->query['token'] ?? null;
        if ($token === null || $token === '') {
            Response::error('デバイストークンが必要です', 401);
        }

        $db = Database::getInstance();

        $stmt = $db->prepare('
            SELECT id, device_name, role
            FROM device_tokens
            WHERE token = :token AND is_active = 1
        ');
        $stmt->execute(['token' => $token]);
        $device = $stmt->fetch();

        if (!$device) {
            Response::error('無効なデバイストークンです', 401);
        }

        // デバイスのロールの権限一覧を取得
        $permissions = self::getPermissions($db, $device['role']);

        $request->auth = [
            'device_token' => true,
            'device_name'  => $device['device_name'],
            'role'         => $device['role'],
            'permissions'  => $permissions,
        ];
    }

    /**
     * Authorization ヘッダーからBearerトークンを取得
     */
    private static function extractBearerToken(): ?string
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

    /**
     * ロールの権限キー一覧を取得
     */
    private static function getPermissions(PDO $db, string $role): array
    {
        $stmt = $db->prepare('
            SELECT permission_key
            FROM role_permissions
            WHERE role = :role AND is_granted = 1
        ');
        $stmt->execute(['role' => $role]);
        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    /**
     * system_settings から値を取得
     */
    private static function getSettingValue(PDO $db, string $key, int $default): int
    {
        $stmt = $db->prepare('
            SELECT setting_value FROM system_settings WHERE setting_key = :key
        ');
        $stmt->execute(['key' => $key]);
        $value = $stmt->fetchColumn();
        return $value !== false ? (int) $value : $default;
    }
}
