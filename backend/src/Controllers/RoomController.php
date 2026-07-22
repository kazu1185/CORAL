<?php

namespace App\Controllers;

use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use PDO;

/**
 * 部屋・清掃コントローラー
 */
class RoomController
{
    /** GET /api/v1/rooms */
    public function index(Request $request): void
    {
        $db = Database::getInstance();
        $stmt = $db->query("
            SELECT r.id, r.room_number, r.floor, r.room_type_id, r.status, r.sort_order,
                   rt.type_code, rt.type_name
            FROM rooms r
            JOIN room_types rt ON rt.id = r.room_type_id
            ORDER BY r.sort_order
        ");
        Response::json(['rooms' => $stmt->fetchAll()]);
    }

    /** GET /api/v1/rooms/indicator */
    public function indicator(Request $request): void
    {
        $db = Database::getInstance();
        $today = date('Y-m-d');

        // 全部屋（利用可能 + 故障中含む全件）
        $rooms = $db->query("
            SELECT r.id, r.room_number, r.floor, r.status AS room_status, r.sort_order,
                   r.grid_row, r.grid_col,
                   rt.type_name, rt.type_code
            FROM rooms r
            JOIN room_types rt ON rt.id = r.room_type_id
            ORDER BY r.floor, r.sort_order
        ")->fetchAll();

        // 当日のアクティブアサインを一括取得
        $stmt = $db->prepare("
            SELECT ra.room_id, ra.reservation_id, ra.check_in_date, ra.check_out_date,
                   r.checkin_date AS res_checkin, r.checkout_date AS res_checkout,
                   r.status AS res_status, r.nights, r.channel, r.payment_method,
                   r.adult_count, r.child_count,
                   COALESCE(g.name_kanji, g.name_kana, g.name_romaji,
                            TRIM(CONCAT(r.tl_last_name, ' ', r.tl_first_name))) AS guest_name,
                   COALESCE(g.is_vip, 0) AS is_vip,
                   COALESCE(g.visit_count, 0) AS visit_count,
                   CASE WHEN g.guest_notes IS NOT NULL AND g.guest_notes != '' THEN 1 ELSE 0 END AS has_guest_notes,
                   CASE WHEN gl.id IS NOT NULL THEN 1 ELSE 0 END AS has_link,
                   CASE WHEN r.reservation_notes IS NOT NULL AND r.reservation_notes != '' THEN 1 ELSE 0 END AS has_request,
                   r.estimated_arrival,
                   -- 未精算金額: 売上合計 - 入金合計（未精算があれば正の値）
                   COALESCE((SELECT SUM(rc.amount) FROM reservation_charges rc
                       WHERE rc.reservation_id = r.id AND rc.status = 'active'
                       AND rc.charge_type NOT IN ('payment','refund')), 0)
                   - COALESCE((SELECT SUM(rc2.amount) FROM reservation_charges rc2
                       WHERE rc2.reservation_id = r.id AND rc2.status = 'active'
                       AND rc2.charge_type = 'payment'), 0) AS unpaid_amount
            FROM room_assignments ra
            JOIN reservations r ON r.id = ra.reservation_id
            LEFT JOIN guests g ON g.id = r.guest_id
            LEFT JOIN guest_links gl ON gl.reservation_id = r.id AND gl.status = 'active'
            WHERE ra.status = 'active'
              AND ra.check_in_date <= :d1
              AND ra.check_out_date > :d2
        ");
        $stmt->execute(['d1' => $today, 'd2' => $today]);
        $assignMap = [];
        foreach ($stmt->fetchAll() as $row) {
            $assignMap[$row['room_id']] = $row;
        }

        // CI予定（当日CIで未アサインも拾うため、アサイン済みのCI予定も）
        $stmt = $db->prepare("
            SELECT ra.room_id, ra.reservation_id
            FROM room_assignments ra
            JOIN reservations r ON r.id = ra.reservation_id
            WHERE ra.status = 'active'
              AND r.checkin_date = :today
              AND r.status = 'confirmed'
        ");
        $stmt->execute(['today' => $today]);
        $ciDueMap = [];
        foreach ($stmt->fetchAll() as $row) {
            $ciDueMap[$row['room_id']] = (int) $row['reservation_id'];
        }

        // 清掃ステータス
        $stmt = $db->prepare("
            SELECT room_id, status FROM housekeeping_status WHERE date = :today
        ");
        $stmt->execute(['today' => $today]);
        $hkMap = [];
        foreach ($stmt->fetchAll() as $row) {
            $hkMap[$row['room_id']] = $row['status'];
        }

        // フロア別にグループ化
        $floors = [];
        $summary = ['occupied' => 0, 'checkout_due' => 0, 'checkin_due' => 0, 'overdue_checkin' => 0, 'vacant' => 0];

        foreach ($rooms as $room) {
            $rid = (int) $room['id'];
            $assign = $assignMap[$rid] ?? null;
            $hkStatus = $hkMap[$rid] ?? 'clean';

            // 状態判定
            if ($room['room_status'] === 'out_of_order') {
                $state = 'out_of_order';
            } elseif ($assign) {
                if ($assign['res_status'] === 'checked_in' && $assign['res_checkout'] === $today) {
                    $state = 'checkout_due';
                } elseif ($assign['res_status'] === 'confirmed' && $assign['res_checkin'] === $today) {
                    $state = 'checkin_due';
                } elseif ($assign['res_status'] === 'confirmed' && $assign['res_checkin'] < $today) {
                    $state = 'overdue_checkin';
                } else {
                    $state = 'occupied';
                }
            } elseif (isset($ciDueMap[$rid])) {
                $state = 'checkin_due';
            } else {
                $state = 'vacant';
            }

            if (isset($summary[$state])) {
                $summary[$state]++;
            }

            // 部屋データ組み立て
            $roomData = [
                'room_id'              => $rid,
                'room_number'          => $room['room_number'],
                'room_type'            => $room['type_name'],
                'room_type_code'       => $room['type_code'],
                'state'                => $state,
                'housekeeping_status'  => $hkStatus,
                'grid_row'             => $room['grid_row'] ? (int) $room['grid_row'] : null,
                'grid_col'             => $room['grid_col'] ? (int) $room['grid_col'] : null,
                'reservation'          => null,
            ];

            if ($assign && $state !== 'vacant') {
                $ciDate = $assign['res_checkin'];
                $currentNight = max(1, (int) ((strtotime($today) - strtotime($ciDate)) / 86400) + 1);

                $roomData['reservation'] = [
                    'id'              => (int) $assign['reservation_id'],
                    'guest_name'      => $assign['guest_name'],
                    'channel'         => $assign['channel'],
                    'current_night'   => $currentNight,
                    'total_nights'    => (int) $assign['nights'],
                    'adult_count'     => (int) $assign['adult_count'],
                    'child_count'     => (int) $assign['child_count'],
                    'payment_method'  => $assign['payment_method'],
                    'is_vip'          => (bool) $assign['is_vip'],
                    'visit_count'     => (int) $assign['visit_count'],
                    'has_guest_notes' => (bool) $assign['has_guest_notes'],
                    'has_link'        => (bool) $assign['has_link'],
                    'has_request'     => (bool) $assign['has_request'],
                    'estimated_arrival' => $assign['estimated_arrival'] ? substr($assign['estimated_arrival'], 0, 5) : null,
                    'unpaid_amount'   => (int) $assign['unpaid_amount'],
                ];
            }

            $floor = (int) $room['floor'];
            if (!isset($floors[$floor])) {
                $floors[$floor] = [
                    'floor' => $floor,
                    'label' => $room['type_name'],
                    'rooms' => [],
                ];
            }
            $floors[$floor]['rooms'][] = $roomData;
        }

        // フロアラベルを最多のタイプに修正
        foreach ($floors as &$f) {
            $typeCounts = [];
            foreach ($f['rooms'] as $r) {
                $t = $r['room_type'];
                $typeCounts[$t] = ($typeCounts[$t] ?? 0) + 1;
            }
            arsort($typeCounts);
            $f['label'] = array_key_first($typeCounts);
        }
        unset($f);

        // グリッド設定を各フロアに付与
        $gridStmt = $db->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'floor_grid_config'");
        $gridStmt->execute();
        $gridRow = $gridStmt->fetch(\PDO::FETCH_ASSOC);
        $gridConfig = $gridRow ? json_decode($gridRow['setting_value'], true) : [];

        foreach ($floors as &$f) {
            $floorKey = (string) $f['floor'];
            $f['grid_cols'] = $gridConfig[$floorKey]['cols'] ?? null;
            $f['grid_rows'] = $gridConfig[$floorKey]['rows'] ?? null;
        }
        unset($f);

        // フロア表示順: デフォルトは上の階から（降順）
        // floor_grid_config._meta.floor_order で 'asc'/'desc' を指定可能
        $floorOrder = $gridConfig['_meta']['floor_order'] ?? 'desc';
        $floorsArray = array_values($floors);
        usort($floorsArray, function ($a, $b) use ($floorOrder) {
            return $floorOrder === 'asc'
                ? $a['floor'] - $b['floor']
                : $b['floor'] - $a['floor'];
        });

        // 配置編集ボタンの表示設定
        $showEditorStmt = $db->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'show_layout_editor'");
        $showEditorStmt->execute();
        $showEditor = $showEditorStmt->fetchColumn();
        // 未設定（NULL）はデフォルト表示（初期設定時はボタンが見える必要がある）
        $showLayoutEditor = $showEditor === null || $showEditor === '1';

        Response::json([
            'summary'            => $summary,
            'floors'             => $floorsArray,
            'floor_order'        => $floorOrder,
            'show_layout_editor' => $showLayoutEditor,
        ]);
    }

    /** PUT /api/v1/rooms/:id/housekeeping */
    public function updateHousekeeping(Request $request): void
    {
        // TODO: 清掃ステータス更新（スタッフ認証）
        Response::error('未実装です', 501);
    }

    /** GET /api/v1/housekeeping */
    public function housekeepingBoard(Request $request): void
    {
        // TODO: 清掃ボード（デバイストークン認証）
        Response::error('未実装です', 501);
    }

    /**
     * GET /api/v1/rooms/inventory?from=YYYY-MM-DD&to=YYYY-MM-DD
     * 部屋在庫カレンダー用: 日付×部屋タイプの残室数マトリクス
     *
     * レスポンス:
     *   room_types: マスタ順の部屋タイプ配列（total_rooms=利用可能な部屋数）
     *   dates: 日付文字列配列
     *   inventory[date][room_type_id]: 残室数
     *   summary[date]: { available, ci, co }
     */
    public function inventory(Request $request): void
    {
        $from = $request->query['from'] ?? date('Y-m-d');
        $to   = $request->query['to']   ?? date('Y-m-d', strtotime('+13 days'));

        $db = Database::getInstance();

        // 部屋タイプ + タイプ別の利用可能部屋数
        $typeStmt = $db->query("
            SELECT rt.id, rt.type_code, rt.type_name,
                   COUNT(r.id) AS total_rooms
            FROM room_types rt
            LEFT JOIN rooms r ON r.room_type_id = rt.id AND r.status = 'available'
            WHERE rt.is_active = 1
            GROUP BY rt.id, rt.type_code, rt.type_name, rt.sort_order
            ORDER BY rt.sort_order
        ");
        $roomTypes = $typeStmt->fetchAll(PDO::FETCH_ASSOC);

        // タイプID → 総室数のマップ
        $totalMap = [];
        foreach ($roomTypes as $rt) {
            $totalMap[(int)$rt['id']] = (int)$rt['total_rooms'];
        }

        // 日付範囲の予約状況を一括取得（アサイン有無を問わず、予約自体で在庫を減らす）
        // confirmed/checked_inの予約 = 部屋を占有する予約
        // room_typeからroom_type_idに変換してカウント
        $resvStmt = $db->prepare("
            SELECT r.checkin_date, r.checkout_date, rt.id AS room_type_id
            FROM reservations r
            JOIN room_types rt ON rt.type_code = r.room_type
            WHERE r.status IN ('confirmed', 'checked_in')
              AND r.status != 'group_parent'
              AND r.checkin_date < :to_date
              AND r.checkout_date > :from_date
        ");
        $resvStmt->execute(['from_date' => $from, 'to_date' => $to]);
        $reservations = $resvStmt->fetchAll(PDO::FETCH_ASSOC);

        // CI/CO件数を一括取得
        $ciStmt = $db->prepare("
            SELECT checkin_date AS d, COUNT(*) AS cnt
            FROM reservations
            WHERE checkin_date >= :from_d AND checkin_date <= :to_d
              AND status IN ('confirmed', 'checked_in')
              AND status != 'group_parent'
            GROUP BY checkin_date
        ");
        $ciStmt->execute(['from_d' => $from, 'to_d' => $to]);
        $ciMap = [];
        foreach ($ciStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $ciMap[$row['d']] = (int)$row['cnt'];
        }

        $coStmt = $db->prepare("
            SELECT checkout_date AS d, COUNT(*) AS cnt
            FROM reservations
            WHERE checkout_date >= :from_d AND checkout_date <= :to_d
              AND status IN ('checked_in', 'checked_out')
              AND status != 'group_parent'
            GROUP BY checkout_date
        ");
        $coStmt->execute(['from_d' => $from, 'to_d' => $to]);
        $coMap = [];
        foreach ($coStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $coMap[$row['d']] = (int)$row['cnt'];
        }

        // 日付ごと×タイプごとの占有数を計算
        $dates = [];
        $inventory = [];
        $summary = [];

        $current = new \DateTime($from);
        $end = new \DateTime($to);
        while ($current <= $end) {
            $dateStr = $current->format('Y-m-d');
            $dates[] = $dateStr;

            // この日の占有数をタイプ別に計算（予約ベース: アサイン有無を問わない）
            $occupied = [];
            foreach ($reservations as $r) {
                // この日が宿泊期間内か（CI日 <= 当日 < CO日）
                if ($r['checkin_date'] <= $dateStr && $r['checkout_date'] > $dateStr) {
                    $typeId = (int)$r['room_type_id'];
                    $occupied[$typeId] = ($occupied[$typeId] ?? 0) + 1;
                }
            }

            // 残室数 = 総室数 - 占有数
            $dayInventory = [];
            $dayTotal = 0;
            foreach ($roomTypes as $rt) {
                $typeId = (int)$rt['id'];
                $total = $totalMap[$typeId];
                $occ = $occupied[$typeId] ?? 0;
                // マイナス値も返す（オーバーブッキング検知用）
                $avail = $total - $occ;
                $dayInventory[(string)$typeId] = $avail;
                $dayTotal += $avail;
            }

            $inventory[$dateStr] = $dayInventory;
            $summary[$dateStr] = [
                'available' => $dayTotal,
                'ci' => $ciMap[$dateStr] ?? 0,
                'co' => $coMap[$dateStr] ?? 0,
            ];

            $current->modify('+1 day');
        }

        Response::json([
            'room_types' => $roomTypes,
            'dates'      => $dates,
            'inventory'  => $inventory,
            'summary'    => $summary,
        ]);
    }

    /** PUT /api/v1/housekeeping/:id */
    public function housekeepingUpdate(Request $request): void
    {
        // TODO: 清掃ステータス更新（デバイストークン認証）
        Response::error('未実装です', 501);
    }

    // ================================================================
    // グリッド配置
    // ================================================================

    /** GET /api/v1/rooms/grid-config — フロアごとのグリッドサイズ設定を取得 */
    public function gridConfig(Request $request): void
    {
        $db = Database::getInstance();

        // system_settings から取得
        $stmt = $db->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'floor_grid_config'");
        $stmt->execute();
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);

        if ($row) {
            Response::json(['config' => json_decode($row['setting_value'], true)]);
            return;
        }

        // 未設定: 各フロアの部屋数からデフォルト値を計算
        $stmt = $db->query("
            SELECT floor, COUNT(*) as room_count
            FROM rooms WHERE status != 'out_of_service'
            GROUP BY floor ORDER BY floor
        ");
        $config = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $row) {
            $count = (int) $row['room_count'];
            // 6列を基本とし、行数は部屋数から計算
            $cols = min($count, 6);
            $rows = (int) ceil($count / $cols);
            $config[$row['floor']] = ['cols' => $cols, 'rows' => $rows];
        }
        Response::json(['config' => $config]);
    }

    /** POST /api/v1/rooms/grid-config — フロアごとのグリッドサイズ設定を保存 */
    public function updateGridConfig(Request $request): void
    {
        $db = Database::getInstance();
        $config = $request->body['config'] ?? null;
        if (!$config || !is_array($config)) {
            Response::error('config は必須です', 400);
        }

        $value = json_encode($config, JSON_UNESCAPED_UNICODE);
        $staffId = $request->auth['staff_id'];

        // UPSERT
        $db->prepare("
            INSERT INTO system_settings (setting_key, setting_value, updated_by)
            VALUES ('floor_grid_config', :val, :staff)
            ON DUPLICATE KEY UPDATE setting_value = :val2, updated_by = :staff2
        ")->execute([
            'val'    => $value,
            'staff'  => $staffId,
            'val2'   => $value,
            'staff2' => $staffId,
        ]);

        Response::json(['message' => 'グリッド設定を保存しました']);
    }

    /** POST /api/v1/rooms/grid-layout — 部屋のグリッド座標を一括更新 */
    public function updateGridLayout(Request $request): void
    {
        $db = Database::getInstance();
        $layout = $request->body['layout'] ?? [];
        if (empty($layout)) {
            Response::error('layout は必須です', 400);
        }

        $stmt = $db->prepare("
            UPDATE rooms SET grid_row = :row, grid_col = :col WHERE id = :id
        ");
        foreach ($layout as $item) {
            $stmt->execute([
                'row' => $item['grid_row'] ?? null,
                'col' => $item['grid_col'] ?? null,
                'id'  => (int) $item['room_id'],
            ]);
        }

        Response::json(['message' => '配置を保存しました']);
    }
}
