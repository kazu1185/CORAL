<?php

/**
 * PMS API エントリポイント
 * 全リクエストをこのファイルで受け取り、ルーターに振り分ける
 */

// ============================================================
// CORS設定（開発環境: React dev server からのアクセスを許可）
// ============================================================
if (getenv('APP_ENV') !== 'production') {
    header('Access-Control-Allow-Origin: http://localhost:3000');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Allow-Credentials: true');

    // preflight リクエスト（OPTIONS）はここで終了
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

// ============================================================
// Autoload & 設定読み込み
// ============================================================
require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../config/config.php';

use App\Core\Router;
use App\Core\Request;
use App\Core\Response;

// ============================================================
// ルーティング
// ============================================================
try {
    $router = new Router();
    require __DIR__ . '/../config/routes.php';

    $request = Request::fromGlobals();
    $router->dispatch($request);
} catch (\PDOException $e) {
    Response::error('データベースエラーが発生しました', 500);
} catch (\Throwable $e) {
    Response::error('内部エラーが発生しました: ' . $e->getMessage(), 500);
}
