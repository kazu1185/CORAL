<?php

/**
 * TL電文取込CLIスクリプト
 *
 * cron用: 5分間隔で実行 php /path/to/backend/cli/tl-import.php [input_dir]
 *
 * 使い方:
 *   php cli/tl-import.php /path/to/xml/directory
 *   php cli/tl-import.php  (デフォルトディレクトリを使用)
 */

// flock で排他制御（cron重複実行防止）
$lockFile = sys_get_temp_dir() . '/pms_tl_import.lock';
$lockFp = fopen($lockFile, 'w');
if (!flock($lockFp, LOCK_EX | LOCK_NB)) {
    echo date('[Y-m-d H:i:s]') . " 別プロセスが実行中です。スキップします。\n";
    exit(0);
}

// Autoload & 設定読み込み
require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../config/config.php';

use App\Services\TlImportService;

// 入力ディレクトリ（CLIの第1引数 or デフォルト）
$inputDir = $argv[1] ?? dirname(__DIR__) . '/../storage/tl_incoming';

if (!is_dir($inputDir)) {
    echo date('[Y-m-d H:i:s]') . " 入力ディレクトリが存在しません: {$inputDir}\n";
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    exit(1);
}

echo date('[Y-m-d H:i:s]') . " TL取込開始: {$inputDir}\n";

try {
    $service = new TlImportService();
    $result = $service->processDirectory($inputDir);

    echo date('[Y-m-d H:i:s]') . " 完了: "
        . "処理={$result['processed']}件 "
        . "新規={$result['new']} "
        . "変更={$result['modify']} "
        . "取消={$result['cancel']} "
        . "重複={$result['duplicate']} "
        . "エラー={$result['errors']}\n";

    // エラーがあった場合は詳細出力
    foreach ($result['details'] as $detail) {
        if ($detail['status'] === 'error') {
            echo date('[Y-m-d H:i:s]') . " ERROR: {$detail['file']} - {$detail['error']}\n";
        }
    }

    $exitCode = $result['errors'] > 0 ? 1 : 0;

} catch (\Throwable $e) {
    echo date('[Y-m-d H:i:s]') . " FATAL: {$e->getMessage()}\n";
    $exitCode = 1;
}

flock($lockFp, LOCK_UN);
fclose($lockFp);
exit($exitCode);
