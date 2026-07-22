<?php

namespace App\Middleware;

use App\Core\Request;
use App\Core\Response;

/**
 * 権限チェックミドルウェア
 */
class PermissionMiddleware
{
    /**
     * 指定された権限キーを持っているか検証
     */
    public static function handle(Request $request, string $permissionKey): void
    {
        if ($request->auth === null) {
            Response::error('認証が必要です', 401);
        }

        // admin は常に全権限を持つ
        if ($request->auth['role'] === 'admin') {
            return;
        }

        $permissions = $request->auth['permissions'] ?? [];

        if (!in_array($permissionKey, $permissions, true)) {
            Response::error('この操作を行う権限がありません', 403);
        }
    }
}
