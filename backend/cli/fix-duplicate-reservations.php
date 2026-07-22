<?php

/**
 * 既存の重複予約を統合するワンショットスクリプト
 *
 * 同一 reservation_no で複数レコードがある予約（324組）を統合する。
 * - 最新のレコード（MAX(id)）を「正」として残す
 * - 古い方のレコードは guest_id=NULL, status='cancelled' に変更
 * - 古い方の情報を reservation_events に履歴として記録
 * - 古い方の reservation_charges, room_assignments は正レコードに移行
 *
 * 使い方:
 *   cd ~/NewPMS/backend && php cli/fix-duplicate-reservations.php
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../config/config.php';

use App\Core\Database;

$db = Database::getInstance();

echo date('[Y-m-d H:i:s]') . " 重複予約の統合を開始します...\n";

// 同一 reservation_no で複数レコードがある予約を取得
$stmt = $db->query("
    SELECT reservation_no, GROUP_CONCAT(id ORDER BY id) AS ids, COUNT(*) AS cnt
    FROM reservations
    WHERE reservation_no IS NOT NULL AND reservation_no != ''
    GROUP BY reservation_no
    HAVING cnt > 1
    ORDER BY reservation_no
");
$duplicates = $stmt->fetchAll(PDO::FETCH_ASSOC);

if (empty($duplicates)) {
    echo "重複予約はありません。\n";
    exit(0);
}

echo count($duplicates) . " 組の重複が見つかりました。\n";

$mergedCount = 0;
$errorCount = 0;

foreach ($duplicates as $dup) {
    $ids = array_map('intval', explode(',', $dup['ids']));
    $keepId = max($ids); // 最新のIDを正とする
    $removeIds = array_filter($ids, fn($id) => $id !== $keepId);

    $db->beginTransaction();
    try {
        foreach ($removeIds as $removeId) {
            // 古い方の情報を取得（履歴記録用）
            $oldStmt = $db->prepare("SELECT * FROM reservations WHERE id = :id");
            $oldStmt->execute(['id' => $removeId]);
            $oldData = $oldStmt->fetch(PDO::FETCH_ASSOC);

            // reservation_events に統合履歴を記録
            $detail = "重複統合: id={$removeId}のレコードをid={$keepId}に統合。"
                     . " 旧status={$oldData['status']}, 旧amount={$oldData['amount']}";
            $db->prepare("
                INSERT INTO reservation_events
                    (reservation_id, event_type, event_at, summary, detail, tl_data_id)
                VALUES
                    (:rid, 'data_merge', NOW(), 'データ統合', :detail, :tl_data_id)
            ")->execute([
                'rid'        => $keepId,
                'detail'     => $detail,
                'tl_data_id' => $oldData['tl_data_id'],
            ]);

            // 古い方の reservation_charges を正レコードに移行
            $db->prepare("
                UPDATE reservation_charges SET reservation_id = :keep_id
                WHERE reservation_id = :remove_id
            ")->execute(['keep_id' => $keepId, 'remove_id' => $removeId]);

            // 古い方の room_assignments を正レコードに移行
            $db->prepare("
                UPDATE room_assignments SET reservation_id = :keep_id
                WHERE reservation_id = :remove_id
            ")->execute(['keep_id' => $keepId, 'remove_id' => $removeId]);

            // 古い方のレコードを無効化（物理DELETE禁止のためstatus変更）
            $db->prepare("
                UPDATE reservations
                SET guest_id = NULL, guest_match_status = 'pending',
                    status = 'cancelled', reservation_notes = CONCAT(COALESCE(reservation_notes, ''), '\n[統合済み→id={$keepId}]')
                WHERE id = :id
            ")->execute(['id' => $removeId]);
        }

        $db->commit();
        $mergedCount++;
        echo "  [{$dup['reservation_no']}] id=" . implode(',', $removeIds) . " → id={$keepId} に統合\n";

    } catch (\Throwable $e) {
        $db->rollBack();
        $errorCount++;
        echo "  [ERROR] {$dup['reservation_no']}: {$e->getMessage()}\n";
    }
}

echo "\n" . date('[Y-m-d H:i:s]') . " 完了！\n";
echo "  統合成功: {$mergedCount}組\n";
echo "  エラー: {$errorCount}組\n";
