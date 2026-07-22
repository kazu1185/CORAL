<?php

/**
 * 既存予約からゲストを自動登録するワンショットスクリプト
 *
 * guest_id が NULL の予約に対して:
 * - 常に新規ゲストを作成してリンク（自動マッチングは廃止）
 * - 同一人物の統合はスタッフが手動で行う
 *
 * 同一ローマ字姓名は同一ゲストとしてグループ化する。
 *
 * 使い方:
 *   cd ~/NewPMS/backend && php cli/create-guests-from-reservations.php
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../config/config.php';

use App\Core\Database;

$db = Database::getInstance();

echo date('[Y-m-d H:i:s]') . " ゲスト自動登録を開始します...\n";

// guest_id が NULL の予約を取得（キャンセル含む全件）
// tl_last_name（統合名）でグループ化し、各グループの予約数もカウント
// 旧データはtl_last_name+tl_first_nameに分かれているためCONCATで統合
$stmt = $db->query("
    SELECT
        TRIM(CONCAT(tl_last_name, ' ', COALESCE(NULLIF(tl_first_name, ''), ''))) as guest_name,
        COUNT(*) as reservation_count,
        GROUP_CONCAT(id ORDER BY id) as reservation_ids
    FROM reservations
    WHERE guest_id IS NULL
    GROUP BY TRIM(CONCAT(tl_last_name, ' ', COALESCE(NULLIF(tl_first_name, ''), '')))
    ORDER BY guest_name
");
$groups = $stmt->fetchAll(PDO::FETCH_ASSOC);

if (empty($groups)) {
    echo "未リンクの予約はありません。\n";
    exit(0);
}

echo count($groups) . " 件のユニークなゲスト名が見つかりました。\n";

// 現在のguest_codeの最大番号を取得
$maxStmt = $db->query("SELECT MAX(CAST(SUBSTRING(guest_code, 2) AS UNSIGNED)) FROM guests");
$nextNum = ((int) $maxStmt->fetchColumn()) + 1;

$createdCount = 0;
$linkedCount = 0;

foreach ($groups as $group) {
    $guestName = $group['guest_name'];
    $reservationIds = explode(',', $group['reservation_ids']);

    // 常に新規ゲスト作成（自動マッチングは誤リンクの原因になるため廃止）
    $guestCode = 'G' . str_pad($nextNum, 5, '0', STR_PAD_LEFT);
    $nextNum++;

    $insertStmt = $db->prepare("
        INSERT INTO guests (
            guest_code, name_romaji,
            country_code, preferred_language
        ) VALUES (
            :guest_code, :name,
            'JP', 'ja'
        )
    ");
    $insertStmt->execute([
        'guest_code' => $guestCode,
        'name'       => $guestName,
    ]);
    $guestId = (int) $db->lastInsertId();
    $matchStatus = 'new_guest';
    $createdCount++;

    // 予約を一括リンク
    // IN句でまとめて更新（同じ名前の予約を一度に処理）
    $placeholders = implode(',', array_fill(0, count($reservationIds), '?'));
    $updateStmt = $db->prepare("
        UPDATE reservations
        SET guest_id = ?, guest_match_status = ?
        WHERE id IN ({$placeholders})
    ");
    $params = array_merge([$guestId, $matchStatus], $reservationIds);
    $updateStmt->execute($params);

    $linkedCount += count($reservationIds);

    echo "  [新規作成] {$guestName} → {$group['reservation_count']}件の予約をリンク\n";
}

echo "\n" . date('[Y-m-d H:i:s]') . " 完了！\n";
echo "  新規ゲスト作成: {$createdCount}件\n";
echo "  リンクした予約数: {$linkedCount}件\n";
