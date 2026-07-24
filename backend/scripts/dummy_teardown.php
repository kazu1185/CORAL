<?php
/**
 * ダミー予約 完全削除（TL連携開始前に実行する）
 *
 * dummy_seed.php が投入したレコードだけを、DMY マーカーで特定して物理削除する。
 *   - reservations.reservation_no LIKE 'DMY%'
 *   - guests.guest_code LIKE 'DMY%'
 * 本物のTLデータは reservation_no が 'DMY' で始まらない・guest_code も 'G%' 形式のため、
 * このスクリプトでは絶対に削除されない。
 *
 * 物理DELETEを使う理由: これはテスト用ダミーであり履歴を残す価値がない（CLAUDE.md #3 の
 * 論理削除原則は本物の業務データが対象。TL連携前に「跡形もなく消す」というユーザー要件に従う）。
 *
 * FK順序: reservation_charges / guest_links / room_assignments → 子予約 → 親予約 → guests。
 *
 * 使い方（サーバー上）: cd /var/www/pms/backend && php scripts/dummy_teardown.php
 */

// config.php はローカルではデフォルトDB定義、本番では config.local.php を取り込む共通入口
require __DIR__ . '/../config/config.php';

$pdo = new PDO(
    'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
    DB_USER, DB_PASS,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);

$before = [];
foreach (['reservations', 'guests', 'reservation_charges', 'room_assignments', 'guest_links'] as $t) {
    $before[$t] = (int) $pdo->query("SELECT COUNT(*) FROM $t")->fetchColumn();
}
$dmyRes = (int) $pdo->query("SELECT COUNT(*) FROM reservations WHERE reservation_no LIKE 'DMY%'")->fetchColumn();
$dmyGuest = (int) $pdo->query("SELECT COUNT(*) FROM guests WHERE guest_code LIKE 'DMY%'")->fetchColumn();

if ($dmyRes === 0 && $dmyGuest === 0) {
    echo "削除対象のダミーデータはありません（既にクリーンです）。\n";
    exit(0);
}

$pdo->beginTransaction();
try {
    // 対象予約ID（DMY）を確定
    $ids = $pdo->query("SELECT id FROM reservations WHERE reservation_no LIKE 'DMY%'")->fetchAll(PDO::FETCH_COLUMN);
    $del = ['charges' => 0, 'links' => 0, 'assignments' => 0, 'children' => 0, 'parents' => 0, 'guests' => 0];

    if ($ids) {
        $in = implode(',', array_map('intval', $ids));
        $del['charges'] = $pdo->exec("DELETE FROM reservation_charges WHERE reservation_id IN ($in)");
        $del['links'] = $pdo->exec("DELETE FROM guest_links WHERE reservation_id IN ($in)");
        $del['assignments'] = $pdo->exec("DELETE FROM room_assignments WHERE reservation_id IN ($in)");
        // 自己参照FK: 子予約（parent_reservation_id あり）を先に、次に親
        $del['children'] = $pdo->exec("DELETE FROM reservations WHERE reservation_no LIKE 'DMY%' AND parent_reservation_id IS NOT NULL");
        $del['parents'] = $pdo->exec("DELETE FROM reservations WHERE reservation_no LIKE 'DMY%'");
    }
    // ゲスト（予約を消した後）
    $del['guests'] = $pdo->exec("DELETE FROM guests WHERE guest_code LIKE 'DMY%'");

    $pdo->commit();
} catch (\Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "エラーによりロールバックしました: " . $e->getMessage() . "\n");
    exit(1);
}

$after = [];
foreach (['reservations', 'guests', 'reservation_charges', 'room_assignments', 'guest_links'] as $t) {
    $after[$t] = (int) $pdo->query("SELECT COUNT(*) FROM $t")->fetchColumn();
}

echo "=== ダミー削除 完了 ===\n";
echo "削除: 明細 {$del['charges']} / 連結 {$del['links']} / アサイン {$del['assignments']} / 子予約 {$del['children']} / 予約(親含む) {$del['parents']} / ゲスト {$del['guests']}\n";
echo "--- テーブル件数 before → after ---\n";
foreach ($after as $t => $c) echo "  {$t}: {$before[$t]} → {$c}\n";
$残 = (int) $pdo->query("SELECT COUNT(*) FROM reservations WHERE reservation_no LIKE 'DMY%'")->fetchColumn()
     + (int) $pdo->query("SELECT COUNT(*) FROM guests WHERE guest_code LIKE 'DMY%'")->fetchColumn();
echo ($残 === 0) ? "残存DMY: 0（完全に削除されました）\n" : "!!! 残存DMYが {$残} 件あります。確認してください\n";
