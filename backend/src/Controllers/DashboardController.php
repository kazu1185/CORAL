<?php

namespace App\Controllers;

use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use PDO;

/**
 * ダッシュボードコントローラー
 */
class DashboardController
{
    /** GET /api/v1/dashboard */
    public function index(Request $request): void
    {
        $db = Database::getInstance();
        $today = date('Y-m-d');
        $tomorrow = date('Y-m-d', strtotime('+1 day'));

        Response::json([
            'summary'       => $this->getSummary($db, $today),
            'alerts'        => $this->getAlerts($db, $today, $tomorrow),
            'checkin_list'  => $this->getCheckinList($db, $today),
            'checkout_list' => $this->getCheckoutList($db, $today),
            'tomorrow'      => $this->getTomorrow($db, $tomorrow),
            'tl_logs'       => $this->getTlLogs($db),
        ]);
    }

    /** GET /api/v1/dashboard/alerts */
    public function alerts(Request $request): void
    {
        $db = Database::getInstance();
        $today = date('Y-m-d');
        $tomorrow = date('Y-m-d', strtotime('+1 day'));

        Response::json([
            'alerts' => $this->getAlerts($db, $today, $tomorrow),
        ]);
    }

    private function getSummary(PDO $db, string $today): array
    {
        // group_parentは管理用レコードなので統計から除外
        $stmt = $db->prepare("
            SELECT
                COUNT(*) AS checkin_today,
                SUM(CASE WHEN status = 'checked_in' THEN 1 ELSE 0 END) AS checkin_done
            FROM reservations
            WHERE checkin_date = :today AND status IN ('confirmed', 'checked_in')
              AND status != 'group_parent'
        ");
        $stmt->execute(['today' => $today]);
        $ci = $stmt->fetch();

        $stmt = $db->prepare("
            SELECT
                COUNT(*) AS checkout_today,
                SUM(CASE WHEN status = 'checked_out' THEN 1 ELSE 0 END) AS checkout_done
            FROM reservations
            WHERE checkout_date = :today AND status IN ('checked_in', 'checked_out')
              AND status != 'group_parent'
        ");
        $stmt->execute(['today' => $today]);
        $co = $stmt->fetch();

        $totalRooms = (int) $db->query("SELECT COUNT(*) FROM rooms WHERE status = 'available'")->fetchColumn();
        $stmt = $db->prepare("
            SELECT COUNT(DISTINCT ra.room_id) AS occupied
            FROM room_assignments ra
            WHERE ra.status = 'active'
              AND ra.check_in_date <= :ci_date
              AND ra.check_out_date > :co_date
        ");
        $stmt->execute(['ci_date' => $today, 'co_date' => $today]);
        $occupied = (int) $stmt->fetchColumn();
        $rate = $totalRooms > 0 ? round(($occupied / $totalRooms) * 100, 1) : 0;

        $stmt = $db->prepare("
            SELECT
                SUM(CASE WHEN status = 'cleaning' THEN 1 ELSE 0 END) AS cleaning,
                SUM(CASE WHEN status = 'inspection' THEN 1 ELSE 0 END) AS inspecting,
                SUM(CASE WHEN status IN ('ready', 'cleaned') THEN 1 ELSE 0 END) AS ready
            FROM housekeeping_status
            WHERE date = :hk_date
        ");
        $stmt->execute(['hk_date' => $today]);
        $hk = $stmt->fetch();

        return [
            'checkin_today'  => (int) ($ci['checkin_today'] ?? 0),
            'checkin_done'   => (int) ($ci['checkin_done'] ?? 0),
            'checkout_today' => (int) ($co['checkout_today'] ?? 0),
            'checkout_done'  => (int) ($co['checkout_done'] ?? 0),
            'occupancy' => [
                'occupied' => $occupied,
                'total'    => $totalRooms,
                'rate'     => $rate,
            ],
            'housekeeping' => [
                'cleaning'   => (int) ($hk['cleaning'] ?? 0),
                'inspecting' => (int) ($hk['inspecting'] ?? 0),
                'ready'      => (int) ($hk['ready'] ?? 0),
            ],
        ];
    }

    private function getAlerts(PDO $db, string $today, string $tomorrow): array
    {
        $alerts = [];

        // ゲスト未確定（group_parentは管理用レコードなので除外）
        $stmt = $db->prepare("
            SELECT r.id, r.tl_last_name, r.tl_first_name, r.channel, r.reservation_no
            FROM reservations r
            WHERE r.guest_match_status = 'pending'
              AND r.status = 'confirmed'
              AND r.checkin_date <= :tomorrow
              AND r.status != 'group_parent'
        ");
        $stmt->execute(['tomorrow' => $tomorrow]);
        foreach ($stmt->fetchAll() as $row) {
            $name = trim($row['tl_last_name'] . ' ' . $row['tl_first_name']);
            $alerts[] = [
                'type'           => 'guest_unconfirmed',
                'message'        => 'ゲスト未確定',
                'detail'         => "{$name} — {$row['channel']} {$row['reservation_no']}",
                'reservation_id' => (int) $row['id'],
                'severity'       => 'red',
            ];
        }

        // 未チェックイン（group_parent除外）
        $stmt = $db->prepare("
            SELECT r.id, COALESCE(g.name_kanji, g.name_kana, g.name_romaji, r.tl_last_name) AS name,
                   r.channel, r.reservation_no, r.checkin_date
            FROM reservations r
            LEFT JOIN guests g ON g.id = r.guest_id
            WHERE r.checkin_date < :today AND r.status = 'confirmed'
              AND r.status != 'group_parent'
        ");
        $stmt->execute(['today' => $today]);
        foreach ($stmt->fetchAll() as $row) {
            $alerts[] = [
                'type'           => 'overdue_checkin',
                'message'        => '未チェックイン',
                'detail'         => "{$row['name']} — CI予定日 {$row['checkin_date']}",
                'reservation_id' => (int) $row['id'],
                'severity'       => 'red',
            ];
        }

        // 連結穴
        $stmt = $db->query("
            SELECT gl.group_id, gl.reservation_id, r.tl_last_name, r.tl_first_name
            FROM guest_links gl
            JOIN reservations r ON r.id = gl.reservation_id
            WHERE gl.status = 'gap'
        ");
        foreach ($stmt->fetchAll() as $row) {
            $name = trim($row['tl_last_name'] . ' ' . $row['tl_first_name']);
            $alerts[] = [
                'type'           => 'link_gap',
                'message'        => '連結予約に穴あり',
                'detail'         => "{$name} — グループ {$row['group_id']}",
                'reservation_id' => (int) $row['reservation_id'],
                'severity'       => 'yellow',
            ];
        }

        // 未アサイン（明日CI予定でアサインなし、group_parent除外）
        $stmt = $db->prepare("
            SELECT r.id, COALESCE(g.name_kanji, g.name_kana, g.name_romaji, r.tl_last_name) AS name,
                   r.channel, r.reservation_no
            FROM reservations r
            LEFT JOIN guests g ON g.id = r.guest_id
            WHERE r.checkin_date = :tomorrow
              AND r.status = 'confirmed'
              AND r.status != 'group_parent'
              AND NOT EXISTS (
                  SELECT 1 FROM room_assignments ra
                  WHERE ra.reservation_id = r.id AND ra.status = 'active'
              )
        ");
        $stmt->execute(['tomorrow' => $tomorrow]);
        foreach ($stmt->fetchAll() as $row) {
            $alerts[] = [
                'type'           => 'unassigned',
                'message'        => '未アサイン（明日CI）',
                'detail'         => "{$row['name']} — {$row['channel']} {$row['reservation_no']}",
                'reservation_id' => (int) $row['id'],
                'severity'       => 'yellow',
            ];
        }

        // 延泊料金未設定（group_parent除外）
        $stmt = $db->query("
            SELECT rc.reservation_id, r.reservation_no,
                   COALESCE(g.name_kanji, g.name_kana, g.name_romaji, r.tl_last_name) AS name,
                   COUNT(*) AS pending_nights
            FROM reservation_charges rc
            JOIN reservations r ON r.id = rc.reservation_id
            LEFT JOIN guests g ON g.id = r.guest_id
            WHERE rc.charge_type = 'room' AND rc.amount = 0 AND rc.status = 'active'
              AND r.status IN ('confirmed', 'checked_in')
              AND r.status != 'group_parent'
            GROUP BY rc.reservation_id, r.reservation_no, name
        ");
        foreach ($stmt->fetchAll() as $row) {
            $alerts[] = [
                'type'           => 'extend_price_pending',
                'message'        => '延泊料金未設定',
                'detail'         => "{$row['name']} — {$row['reservation_no']}（{$row['pending_nights']}泊分）",
                'reservation_id' => (int) $row['reservation_id'],
                'severity'       => 'yellow',
            ];
        }

        // TL取込エラー（未解消分のみ表示）
        $stmt = $db->query("
            SELECT id, reservation_no, channel, error_message, received_at
            FROM tl_import_logs
            WHERE parse_status = 'error'
              AND resolved_at IS NULL
            ORDER BY received_at DESC
            LIMIT 10
        ");
        foreach ($stmt->fetchAll() as $row) {
            $alerts[] = [
                'type'           => 'tl_error',
                'message'        => 'TL取込エラー',
                'detail'         => "{$row['reservation_no']} — " . self::humanizeImportError($row['error_message']),
                'reservation_id' => null,
                'severity'       => 'red',
                'log_id'         => (int) $row['id'],
            ];
        }

        // 統合予約アラート（merge_alert）
        // 統合済み予約にTLから日程変更・キャンセル等の通知が来た場合、
        // 自動処理せずスタッフ判断を促すアラートとして表示する
        $stmt = $db->query("
            SELECT re.reservation_id, re.summary, re.detail, re.event_at,
                   r.tl_last_name, r.tl_first_name
            FROM reservation_events re
            JOIN reservations r ON r.id = re.reservation_id
            WHERE re.event_type = 'merge_alert'
              AND re.summary NOT LIKE '%対応済み%'
              AND re.event_at >= NOW() - INTERVAL 7 DAY
            ORDER BY re.event_at DESC
            LIMIT 10
        ");
        foreach ($stmt->fetchAll() as $row) {
            $name = trim($row['tl_last_name'] . ' ' . $row['tl_first_name']);
            $detail = json_decode($row['detail'], true);
            $alertType = $detail['alert_type'] ?? '';
            $sourceResNo = $detail['source_reservation_no'] ?? '';
            $channel = $detail['channel'] ?? '';

            // アラート種別に応じた説明文
            $desc = match ($alertType) {
                'date_change'       => "日程変更あり（{$channel} {$sourceResNo}）",
                'cancellation'      => "キャンセル通知（{$channel} {$sourceResNo}）",
                'room_count_change' => "室数変更あり（{$channel} {$sourceResNo}）",
                default             => "変更通知（{$channel} {$sourceResNo}）",
            };

            $alerts[] = [
                'type'           => 'merge_alert',
                'message'        => '統合予約に変更通知',
                'detail'         => "{$name} — {$desc}",
                'reservation_id' => (int) $row['reservation_id'],
                'severity'       => 'red',
            ];
        }

        // 未登録チャネルアラート（unknown_channel）
        // TLから未登録OTAの予約が来た場合、設定画面でチャネル登録を促す
        $unknownStmt = $db->query("
            SELECT
                JSON_UNQUOTE(JSON_EXTRACT(re.detail, '$.company_name')) AS company_name,
                COUNT(*) AS cnt,
                MAX(re.reservation_id) AS sample_reservation_id
            FROM reservation_events re
            JOIN reservations r ON r.id = re.reservation_id
            WHERE re.event_type = 'unknown_channel'
              AND r.channel = 'other'
              AND re.event_at >= NOW() - INTERVAL 30 DAY
            GROUP BY company_name
        ");
        foreach ($unknownStmt->fetchAll(\PDO::FETCH_ASSOC) as $row) {
            $alerts[] = [
                'type'           => 'unknown_channel',
                'message'        => '未登録OTAの予約',
                'detail'         => "{$row['company_name']}（{$row['cnt']}件）",
                'company_name'   => $row['company_name'],
                'count'          => (int) $row['cnt'],
                'reservation_id' => (int) $row['sample_reservation_id'],
                'link'           => '/settings/channels',
            ];
        }

        return $alerts;
    }

    private function getCheckinList(PDO $db, string $today): array
    {
        $stmt = $db->prepare("
            SELECT
                r.id AS reservation_id,
                COALESCE(g.name_kanji, g.name_kana, g.name_romaji,
                         TRIM(CONCAT(r.tl_last_name, ' ', r.tl_first_name))) AS guest_name,
                CONCAT(r.tl_last_name, ' ', r.tl_first_name) AS guest_name_romaji,
                rm.room_number,
                rt.type_name AS room_type,
                r.channel,
                r.status,
                DATE_FORMAT(r.actual_checkin_at, '%H:%i') AS checkin_at,
                COALESCE((SELECT SUM(rc.amount) FROM reservation_charges rc WHERE rc.reservation_id = r.id AND rc.status = 'active' AND rc.charge_type NOT IN ('payment','refund')), 0)
                - COALESCE((SELECT SUM(rc2.amount) FROM reservation_charges rc2 WHERE rc2.reservation_id = r.id AND rc2.status = 'active' AND rc2.charge_type = 'payment'), 0) AS unpaid_amount
            FROM reservations r
            LEFT JOIN guests g ON g.id = r.guest_id
            LEFT JOIN room_assignments ra ON ra.reservation_id = r.id AND ra.status = 'active'
            LEFT JOIN rooms rm ON rm.id = ra.room_id
            LEFT JOIN room_types rt ON rt.type_code = r.room_type
            WHERE r.checkin_date = :today
              AND r.status IN ('confirmed', 'checked_in')
              AND r.status != 'group_parent'
            ORDER BY r.status DESC, r.id
            LIMIT 5
        ");
        $stmt->execute(['today' => $today]);
        return $stmt->fetchAll();
    }

    private function getCheckoutList(PDO $db, string $today): array
    {
        $stmt = $db->prepare("
            SELECT
                r.id AS reservation_id,
                COALESCE(g.name_kanji, g.name_kana, g.name_romaji,
                         TRIM(CONCAT(r.tl_last_name, ' ', r.tl_first_name))) AS guest_name,
                CONCAT(r.tl_last_name, ' ', r.tl_first_name) AS guest_name_romaji,
                rm.room_number,
                rt.type_name AS room_type,
                r.channel,
                r.status,
                DATE_FORMAT(r.actual_checkout_at, '%H:%i') AS checkout_at,
                COALESCE((SELECT SUM(rc.amount) FROM reservation_charges rc WHERE rc.reservation_id = r.id AND rc.status = 'active' AND rc.charge_type NOT IN ('payment','refund')), 0)
                - COALESCE((SELECT SUM(rc2.amount) FROM reservation_charges rc2 WHERE rc2.reservation_id = r.id AND rc2.status = 'active' AND rc2.charge_type = 'payment'), 0) AS unpaid_amount
            FROM reservations r
            LEFT JOIN guests g ON g.id = r.guest_id
            LEFT JOIN room_assignments ra ON ra.reservation_id = r.id AND ra.status = 'active'
            LEFT JOIN rooms rm ON rm.id = ra.room_id
            LEFT JOIN room_types rt ON rt.type_code = r.room_type
            WHERE r.checkout_date = :today
              AND r.status IN ('checked_in', 'checked_out')
              AND r.status != 'group_parent'
            ORDER BY r.status ASC, r.id
            LIMIT 5
        ");
        $stmt->execute(['today' => $today]);
        return $stmt->fetchAll();
    }

    private function getTomorrow(PDO $db, string $tomorrow): array
    {
        // group_parentは管理用レコードなので明日の予測からも除外
        $stmt = $db->prepare("SELECT COUNT(*) FROM reservations WHERE checkin_date = :d AND status = 'confirmed' AND status != 'group_parent'");
        $stmt->execute(['d' => $tomorrow]);
        $ciCount = (int) $stmt->fetchColumn();

        $stmt = $db->prepare("SELECT COUNT(*) FROM reservations WHERE checkout_date = :d AND status = 'checked_in' AND status != 'group_parent'");
        $stmt->execute(['d' => $tomorrow]);
        $coCount = (int) $stmt->fetchColumn();

        $totalRooms = (int) $db->query("SELECT COUNT(*) FROM rooms WHERE status = 'available'")->fetchColumn();
        $stmt = $db->prepare("
            SELECT COUNT(DISTINCT ra.room_id) AS occupied
            FROM room_assignments ra
            WHERE ra.status = 'active'
              AND ra.check_in_date <= :d1
              AND ra.check_out_date > :d2
        ");
        $stmt->execute(['d1' => $tomorrow, 'd2' => $tomorrow]);
        $occupied = (int) $stmt->fetchColumn();
        $rate = $totalRooms > 0 ? round(($occupied / $totalRooms) * 100, 1) : 0;

        return [
            'checkin_count'  => $ciCount,
            'checkout_count' => $coCount,
            'occupancy_forecast' => [
                'occupied' => $occupied,
                'total'    => $totalRooms,
                'rate'     => $rate,
            ],
        ];
    }

    private function getTlLogs(PDO $db): array
    {
        $stmt = $db->query("
            SELECT
                DATE_FORMAT(received_at, '%H:%i') AS time,
                channel,
                reservation_no,
                parse_status AS status,
                error_message AS error
            FROM tl_import_logs
            ORDER BY received_at DESC
            LIMIT 10
        ");
        return $stmt->fetchAll();
    }

    /** POST /api/v1/dashboard/resolve-tl-error — 個別エラー解消 */
    public function resolveTlError(Request $request): void
    {
        $logId = (int) ($request->body['log_id'] ?? 0);

        if ($logId <= 0) {
            Response::json(['error' => 'log_id が必要です'], 400);
            return;
        }

        $db = Database::getInstance();
        $stmt = $db->prepare("
            UPDATE tl_import_logs SET resolved_at = NOW()
            WHERE id = :id AND parse_status = 'error' AND resolved_at IS NULL
        ");
        $stmt->execute(['id' => $logId]);

        Response::json(['message' => '対応済みにしました', 'resolved' => $stmt->rowCount()]);
    }

    /** POST /api/v1/dashboard/resolve-tl-errors — 一括エラー解消 */
    public function resolveTlErrors(Request $request): void
    {
        $db = Database::getInstance();
        $stmt = $db->query("
            UPDATE tl_import_logs SET resolved_at = NOW()
            WHERE parse_status = 'error' AND resolved_at IS NULL
        ");

        Response::json(['message' => 'すべて対応済みにしました', 'resolved' => $stmt->rowCount()]);
    }

    /**
     * 技術的なエラーメッセージを人間が読める日本語に変換する
     * 未知のエラーはそのまま短縮して返す
     */
    private static function humanizeImportError(?string $raw): string
    {
        if (!$raw) return '不明なエラー';

        // よくあるエラーパターンのマッピング
        $patterns = [
            '/foreign key constraint fails.*`guests`/i'
                => 'ゲストデータの参照エラー（関連予約あり）',
            '/foreign key constraint fails.*`reservations`/i'
                => '予約データの参照エラー（関連データあり）',
            '/Duplicate entry/i'
                => 'データの重複エラー',
            '/Column.*cannot be null/i'
                => '必須項目が未入力',
            '/Data too long for column/i'
                => 'データが長すぎます',
            '/CI済み予約.*自動反映不可/i'
                => 'CI済み予約のため自動変更不可（手動対応が必要）',
            '/ファイル読み込み失敗/i'
                => 'XMLファイルの読み込みに失敗',
            '/未知の電文種別/i'
                => '不明な電文種別',
            '/XMLパースエラー|SimpleXML/i'
                => 'XML形式エラー（電文が破損の可能性）',
        ];

        foreach ($patterns as $regex => $humanMsg) {
            if (preg_match($regex, $raw)) {
                return $humanMsg;
            }
        }

        // 未知のエラー: SQLSTATE部分を除去して80文字に短縮
        $cleaned = preg_replace('/SQLSTATE\[[A-Z0-9]+\]:\s*/', '', $raw);
        $cleaned = preg_replace('/Integrity constraint violation:\s*\d+\s*/', '', $cleaned);
        if (mb_strlen($cleaned) > 80) {
            $cleaned = mb_substr($cleaned, 0, 80) . '…';
        }
        return $cleaned;
    }
}
