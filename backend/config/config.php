<?php

/**
 * アプリケーション設定
 */

// 本番サーバー固有の設定（本番DBパスワード等）は config.local.php で上書きする。
// config.local.php はリポジトリに含めない（サーバー上にのみ置く）。
// 理由: 本番の認証情報をGit管理・開発機に置かないため。
$localConfig = __DIR__ . '/config.local.php';
if (file_exists($localConfig)) {
    require $localConfig;
}

// タイムゾーンをアプリ側で明示する。
// 理由: 本番VPSのphp.iniはUTC設定（共有php.iniは会計システムに影響するため変更不可）。
// CI/CO日付・cron取込時刻がずれるのを防ぐため、環境に依存せずJSTに固定する。
date_default_timezone_set('Asia/Tokyo');

// 環境判定（本番: same-origin のためCORS不要）
defined('APP_ENV') || define('APP_ENV', getenv('APP_ENV') ?: 'development');

// DB接続情報（開発環境のデフォルト。本番は config.local.php で定義済みのため再定義されない）
defined('DB_HOST') || define('DB_HOST', 'localhost');
defined('DB_NAME') || define('DB_NAME', 'pms_db');
defined('DB_USER') || define('DB_USER', 'pms_user');
defined('DB_PASS') || define('DB_PASS', 'PmsD3v2026!');
defined('DB_CHARSET') || define('DB_CHARSET', 'utf8mb4');
