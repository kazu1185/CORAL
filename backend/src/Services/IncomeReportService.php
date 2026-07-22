<?php

namespace App\Services;

use PDO;

/**
 * 収入実績・予測表 データ集計サービス
 *
 * 日別の売上・稼働率・入数を集計し、前年同月データと合わせて返す。
 * 業績日付（cutoff）以前 = 実績、以降 = 予測として区分する。
 */
class IncomeReportService
{
    private PDO $db;

    public function __construct(PDO $db)
    {
        $this->db = $db;
    }

    /**
     * 月間の日別収入データを収集
     *
     * @param string $yearMonth  対象年月 'YYYY-MM'
     * @param string $cutoffDate 業績日付 'YYYY-MM-DD'（この日以前が実績）
     * @return array ['days' => [...], 'totals' => [...], 'prev_days' => [...], 'prev_totals' => [...], 'physical_rooms' => int]
     */
    public function collectDailyData(string $yearMonth, string $cutoffDate): array
    {
        $physicalRooms = $this->getPhysicalRoomCount();

        // 当月の開始日・終了日
        $startDate = $yearMonth . '-01';
        $endDate = date('Y-m-t', strtotime($startDate));

        // 前年同月
        $prevYear = (int) substr($yearMonth, 0, 4) - 1;
        $prevMonth = substr($yearMonth, 5, 2);
        $prevStartDate = "{$prevYear}-{$prevMonth}-01";
        $prevEndDate = date('Y-m-t', strtotime($prevStartDate));

        // 当月データ集計
        $days = $this->aggregateDailyData($startDate, $endDate);

        // 前年データ集計
        $prevDays = $this->aggregateDailyData($prevStartDate, $prevEndDate);

        // 合計行
        $totals = $this->sumTotals($days);
        $prevTotals = $this->sumTotals($prevDays);

        return [
            'physical_rooms' => $physicalRooms,
            'days'           => $days,
            'totals'         => $totals,
            'prev_days'      => $prevDays,
            'prev_totals'    => $prevTotals,
            'cutoff_date'    => $cutoffDate,
        ];
    }

    /**
     * 販売可能な物理室数を取得
     * out_of_order / out_of_service を除外
     */
    private function getPhysicalRoomCount(): int
    {
        $stmt = $this->db->query("
            SELECT COUNT(*) FROM rooms WHERE status = 'available'
        ");
        return (int) $stmt->fetchColumn();
    }

    /**
     * 日別データ集計（売上・稼働・入数）
     *
     * reservation_charges を日別にGROUP BYし、
     * 販売室数はroom_assignmentsから、入数はreservationsから別途取得して結合する。
     */
    private function aggregateDailyData(string $startDate, string $endDate): array
    {
        // --- 売上集計 ---
        // charge_type: room, addon, discount を売上対象とする
        // payment, refund, cancel_fee, no_show_fee は売上金額には含めない
        $salesStmt = $this->db->prepare("
            SELECT
                rc.date,
                SUM(rc.amount) AS total_sales,
                SUM(CASE WHEN rc.charge_type = 'room' THEN rc.amount ELSE 0 END) AS room_sales,
                SUM(rc.accommodation_tax) AS accom_tax
            FROM reservation_charges rc
            JOIN reservations r ON rc.reservation_id = r.id
            WHERE rc.date BETWEEN :start_date AND :end_date
              AND rc.status = 'active'
              AND rc.charge_type IN ('room', 'addon', 'discount')
              AND r.status NOT IN ('cancelled', 'no_show', 'merged', 'group_parent')
            GROUP BY rc.date
            ORDER BY rc.date
        ");
        $salesStmt->execute(['start_date' => $startDate, 'end_date' => $endDate]);
        $salesByDate = [];
        foreach ($salesStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $salesByDate[$row['date']] = $row;
        }

        // --- 販売室数（日別） ---
        // room_assignmentsのactive行で、当日に滞在中の部屋数をカウント
        $occupancyStmt = $this->db->prepare("
            SELECT
                d.date,
                COUNT(DISTINCT ra.room_id) AS sold_rooms
            FROM (
                SELECT DATE_ADD(:occ_start, INTERVAL seq DAY) AS date
                FROM (
                    SELECT a.N + b.N * 10 AS seq
                    FROM (SELECT 0 AS N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
                          UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a
                    CROSS JOIN (SELECT 0 AS N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3) b
                ) nums
                WHERE DATE_ADD(:occ_start2, INTERVAL seq DAY) <= :occ_end
            ) d
            LEFT JOIN room_assignments ra
                ON ra.status = 'active'
                AND ra.check_in_date <= d.date
                AND ra.check_out_date > d.date
            GROUP BY d.date
            ORDER BY d.date
        ");
        $occupancyStmt->execute([
            'occ_start'  => $startDate,
            'occ_start2' => $startDate,
            'occ_end'    => $endDate,
        ]);
        $occByDate = [];
        foreach ($occupancyStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $occByDate[$row['date']] = (int) $row['sold_rooms'];
        }

        // --- 入数（日別） ---
        // 当日宿泊している予約のadult_count / child_countを集計
        // 滞在判定: checkin_date <= date AND checkout_date > date
        $guestStmt = $this->db->prepare("
            SELECT
                d.date,
                COALESCE(SUM(r.adult_count), 0) AS adults,
                COALESCE(SUM(r.child_count), 0) AS children
            FROM (
                SELECT DATE_ADD(:g_start, INTERVAL seq DAY) AS date
                FROM (
                    SELECT a.N + b.N * 10 AS seq
                    FROM (SELECT 0 AS N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
                          UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a
                    CROSS JOIN (SELECT 0 AS N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3) b
                ) nums
                WHERE DATE_ADD(:g_start2, INTERVAL seq DAY) <= :g_end
            ) d
            LEFT JOIN reservations r
                ON r.checkin_date <= d.date
                AND r.checkout_date > d.date
                AND r.status NOT IN ('cancelled', 'no_show', 'merged', 'group_parent')
            GROUP BY d.date
            ORDER BY d.date
        ");
        $guestStmt->execute([
            'g_start'  => $startDate,
            'g_start2' => $startDate,
            'g_end'    => $endDate,
        ]);
        $guestByDate = [];
        foreach ($guestStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $guestByDate[$row['date']] = $row;
        }

        // --- 日付ごとに結合 ---
        $result = [];
        $current = new \DateTime($startDate);
        $end = new \DateTime($endDate);
        while ($current <= $end) {
            $d = $current->format('Y-m-d');
            $sales = $salesByDate[$d] ?? null;
            $soldRooms = $occByDate[$d] ?? 0;
            $guests = $guestByDate[$d] ?? ['adults' => 0, 'children' => 0];

            $result[$d] = [
                'date'        => $d,
                'sold_rooms'  => $soldRooms,
                'total_sales' => (int) ($sales['total_sales'] ?? 0),
                'room_sales'  => (int) ($sales['room_sales'] ?? 0),
                'accom_tax'   => (int) ($sales['accom_tax'] ?? 0),
                'adults'      => (int) $guests['adults'],
                'children'    => (int) $guests['children'],
            ];
            $current->modify('+1 day');
        }

        return $result;
    }

    /**
     * 日別データの合計行を計算
     */
    private function sumTotals(array $days): array
    {
        $totals = [
            'sold_rooms'  => 0,
            'total_sales' => 0,
            'room_sales'  => 0,
            'accom_tax'   => 0,
            'adults'      => 0,
            'children'    => 0,
            'days_count'  => count($days),
        ];
        foreach ($days as $day) {
            $totals['sold_rooms']  += $day['sold_rooms'];
            $totals['total_sales'] += $day['total_sales'];
            $totals['room_sales']  += $day['room_sales'];
            $totals['accom_tax']   += $day['accom_tax'];
            $totals['adults']      += $day['adults'];
            $totals['children']    += $day['children'];
        }
        return $totals;
    }
}
