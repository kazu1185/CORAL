<?php
/**
 * テストデータ一括取込スクリプト
 *
 * OTA通知日時（TravelAgencyBookingDate + Time）順にソートして取り込む
 * ファイル名順だと取消通知が新規より先に来るケースで不整合が起きるため
 *
 * 使い方:
 *   php backend/scripts/import_test_data.php [XMLディレクトリ]
 *   デフォルト: storage/tl_import/
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../config/config.php';

use App\Services\TlXmlParser;
use App\Services\TlImportService;

$inputDir = $argv[1] ?? dirname(__DIR__, 2) . '/storage/tl_import';

echo "=== テストデータ一括取込 ===\n";
echo "対象ディレクトリ: {$inputDir}\n\n";

// XMLファイル収集
$files = [];
$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($inputDir, RecursiveDirectoryIterator::SKIP_DOTS)
);
foreach ($iterator as $file) {
    if (strtolower($file->getExtension()) === 'xml') {
        $files[] = $file->getPathname();
    }
}

if (empty($files)) {
    echo "XMLファイルが見つかりません。\n";
    exit(1);
}

echo "XMLファイル数: " . count($files) . "\n";

// 各ファイルからOTA通知日時を抽出してソート用配列を構築
$parser = new TlXmlParser();
$fileEntries = [];

foreach ($files as $filePath) {
    $xmlContent = file_get_contents($filePath);
    if ($xmlContent === false) {
        echo "  [SKIP] 読み込み失敗: {$filePath}\n";
        continue;
    }

    try {
        // XMLからOTA通知日時を直接抽出（フルパースより軽量）
        $xml = new SimpleXMLElement($xmlContent);
        $basic = $xml->BasicInformation;
        $bookingDate = (string)$basic->TravelAgencyBookingDate;
        $bookingTime = (string)$basic->TravelAgencyBookingTime;
        $otaDateTime = trim("{$bookingDate} {$bookingTime}");

        // 日時がない場合はSystemDateをフォールバック
        if (empty($bookingDate)) {
            $otaDateTime = (string)$xml->TransactionType->SystemDate . ' 00:00:00';
        }

        $fileEntries[] = [
            'path'         => $filePath,
            'ota_datetime' => $otaDateTime,
            'filename'     => basename($filePath),
        ];
    } catch (\Throwable $e) {
        echo "  [SKIP] パースエラー: " . basename($filePath) . " - {$e->getMessage()}\n";
    }
}

// OTA通知日時で昇順ソート（同一日時はファイル名順）
usort($fileEntries, function ($a, $b) {
    $cmp = strcmp($a['ota_datetime'], $b['ota_datetime']);
    if ($cmp !== 0) return $cmp;
    return strcmp($a['filename'], $b['filename']);
});

echo "ソート完了（OTA通知日時順）\n";
echo "最古: {$fileEntries[0]['ota_datetime']} ({$fileEntries[0]['filename']})\n";
echo "最新: " . end($fileEntries)['ota_datetime'] . " (" . end($fileEntries)['filename'] . ")\n\n";

// TlImportServiceで1件ずつ処理
$service = new TlImportService();

$summary = [
    'processed' => 0,
    'new'       => 0,
    'modify'    => 0,
    'cancel'    => 0,
    'duplicate' => 0,
    'errors'    => 0,
];

foreach ($fileEntries as $i => $entry) {
    $result = $service->processFile($entry['path']);
    $summary['processed']++;

    $num = $i + 1;
    $status = $result['status'];
    $type = $result['type'] ?? '-';

    if ($status === 'success') {
        $summary[$type]++;
        // 100件ごとに進捗表示
        if ($num % 100 === 0) {
            echo "  [{$num}/" . count($fileEntries) . "] 処理中...\n";
        }
    } elseif ($status === 'duplicate') {
        $summary['duplicate']++;
    } else {
        $summary['errors']++;
        echo "  [ERROR] {$entry['filename']}: {$result['error']}\n";
    }
}

echo "\n=== 取込完了 ===\n";
echo "処理件数: {$summary['processed']}\n";
echo "  新規: {$summary['new']}\n";
echo "  変更: {$summary['modify']}\n";
echo "  取消: {$summary['cancel']}\n";
echo "  重複: {$summary['duplicate']}\n";
echo "  エラー: {$summary['errors']}\n";
