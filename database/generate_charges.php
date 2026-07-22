<?php
/**
 * 全予約に対して売上明細（reservation_charges）を生成するスクリプト
 * 既存のchargeがある日付はスキップし、不足分のみINSERT
 *
 * 実行: php database/generate_charges.php
 */

require_once __DIR__ . '/../backend/vendor/autoload.php';
require_once __DIR__ . '/../backend/config/config.php';

use App\Core\Database;

$db = Database::getInstance();

// 全予約を取得（cancelled以外）
$reservations = $db->query("
    SELECT r.id, r.checkin_date, r.checkout_date, r.nights, r.amount,
           r.room_type, r.adult_count, r.plan_id, r.status,
           rt.type_name, rt.default_rate,
           p.plan_name, p.meal_type, p.breakfast_price, p.dinner_price
    FROM reservations r
    LEFT JOIN room_types rt ON rt.type_code = r.room_type
    LEFT JOIN plans p ON p.id = r.plan_id
    ORDER BY r.id
")->fetchAll();

$insertCount = 0;

foreach ($reservations as $res) {
    $resId = (int) $res['id'];
    $ciDate = $res['checkin_date'];
    $coDate = $res['checkout_date'];
    $nights = (int) $res['nights'];
    $totalAmount = (int) $res['amount'];
    $status = $res['status'];
    $defaultRate = (int) ($res['default_rate'] ?? 8000);
    $planName = $res['plan_name'] ?? '素泊まり';
    $typeName = $res['type_name'] ?? 'シングル';
    $breakfastPrice = (int) ($res['breakfast_price'] ?? 0);
    $dinnerPrice = (int) ($res['dinner_price'] ?? 0);

    // cancelled の場合はスキップ
    if ($status === 'cancelled') continue;

    // 1泊あたりの料金を計算（合計 ÷ 泊数、端数は初泊に寄せる）
    if ($nights <= 0) continue;

    $mealExtra = ($breakfastPrice + $dinnerPrice) * (int) $res['adult_count'];
    $perNight = $nights > 0 ? (int) floor($totalAmount / $nights) : $totalAmount;

    $d = new DateTime($ciDate);
    $endDate = new DateTime($coDate);
    $nightIdx = 0;

    while ($d < $endDate) {
        $dateStr = $d->format('Y-m-d');

        // 既にこの日のchargeがあればスキップ
        $stmt = $db->prepare("
            SELECT COUNT(*) FROM reservation_charges
            WHERE reservation_id = :rid AND date = :d AND charge_type = 'room'
        ");
        $stmt->execute(['rid' => $resId, 'd' => $dateStr]);
        if ((int) $stmt->fetchColumn() > 0) {
            $d->modify('+1 day');
            $nightIdx++;
            continue;
        }

        // 金額計算（最終泊で端数調整）
        if ($nightIdx === $nights - 1) {
            // 最終泊: 残り全額
            $alreadyStmt = $db->prepare("
                SELECT COALESCE(SUM(amount), 0) FROM reservation_charges
                WHERE reservation_id = :rid AND charge_type = 'room' AND status = 'active'
            ");
            $alreadyStmt->execute(['rid' => $resId]);
            $alreadyTotal = (int) $alreadyStmt->fetchColumn();
            $nightAmount = $totalAmount - $alreadyTotal;
        } else {
            $nightAmount = $perNight;
        }

        // 消費税（10%の内税計算）
        $taxAmount = (int) floor($nightAmount * 10 / 110);

        // 摘要
        $desc = "{$typeName}（{$planName}）";

        $db->prepare("
            INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
            VALUES (:rid, :d, 'room', :desc, :amount, :tax, 0, 'active')
        ")->execute([
            'rid'    => $resId,
            'd'      => $dateStr,
            'desc'   => $desc,
            'amount' => max(0, $nightAmount),
            'tax'    => max(0, $taxAmount),
        ]);

        $insertCount++;
        $d->modify('+1 day');
        $nightIdx++;
    }
}

echo "完了: {$insertCount}行の売上明細を生成しました\n";

// 確認
$stmt = $db->query("
    SELECT
      (SELECT COUNT(DISTINCT reservation_id) FROM reservation_charges) AS with_charges,
      (SELECT COUNT(*) FROM reservation_charges) AS total_rows
");
$result = $stmt->fetch();
echo "売上明細のある予約: {$result['with_charges']}件 / 合計行数: {$result['total_rows']}行\n";
