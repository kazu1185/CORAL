<?php

namespace App\Controllers;

use App\Controllers\Concerns\OptimisticLock;
use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use PDO;

/**
 * 予約コントローラー
 */
class ReservationController
{
    use OptimisticLock;

    /** GET /api/v1/reservations */
    public function index(Request $request): void
    {
        $db = Database::getInstance();
        $q = $request->query;

        $page    = max(1, (int) ($q['page'] ?? 1));
        $perPage = min(100, max(1, (int) ($q['per_page'] ?? 15)));
        $offset  = ($page - 1) * $perPage;

        // WHERE条件構築
        $where = [];
        $params = [];

        if (!empty($q['q'])) {
            // ゲスト名・予約番号・電話番号・統合子の予約番号で横断検索
            $search = '%' . $q['q'] . '%';
            // 電話番号検索用: ハイフン等を除去して比較（入力 09012345678 → DB 090-1234-5678 にマッチ）
            $phoneNormalized = '%' . preg_replace('/[-\s()\+]/', '', $q['q']) . '%';
            $where[] = "(
                r.tl_last_name LIKE :q1
                OR r.tl_first_name LIKE :q2
                OR g.name_kanji LIKE :q3
                OR g.name_kana LIKE :q4
                OR g.name_romaji LIKE :q5
                OR r.reservation_no LIKE :q6
                OR EXISTS (SELECT 1 FROM reservation_sources rs WHERE rs.reservation_id = r.id AND rs.reservation_no LIKE :q7)
                OR g.phone LIKE :q8
                OR g.mobile_phone LIKE :q9
                OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(g.phone, '-', ''), ' ', ''), '+', ''), '(', ''), ')', '') LIKE :q10
                OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(g.mobile_phone, '-', ''), ' ', ''), '+', ''), '(', ''), ')', '') LIKE :q11
            )";
            $params['q1'] = $search;
            $params['q2'] = $search;
            $params['q3'] = $search;
            $params['q4'] = $search;
            $params['q5'] = $search;
            $params['q6'] = $search;
            $params['q7'] = $search;
            $params['q8'] = $search;
            $params['q9'] = $search;
            $params['q10'] = $phoneNormalized;
            $params['q11'] = $phoneNormalized;
        }

        if (!empty($q['channel'])) {
            $channels = explode(',', $q['channel']);
            $placeholders = [];
            foreach ($channels as $i => $ch) {
                $key = "ch_{$i}";
                $placeholders[] = ":{$key}";
                $params[$key] = trim($ch);
            }
            $where[] = "r.channel IN (" . implode(',', $placeholders) . ")";
        }

        if (!empty($q['status'])) {
            $statuses = explode(',', $q['status']);
            $placeholders = [];
            foreach ($statuses as $i => $st) {
                $key = "st_{$i}";
                $placeholders[] = ":{$key}";
                $params[$key] = trim($st);
            }
            $where[] = "r.status IN (" . implode(',', $placeholders) . ")";
        }

        if (!empty($q['room_type'])) {
            $types = explode(',', $q['room_type']);
            $placeholders = [];
            foreach ($types as $i => $rt) {
                $key = "rt_{$i}";
                $placeholders[] = ":{$key}";
                $params[$key] = trim($rt);
            }
            $where[] = "r.room_type IN (" . implode(',', $placeholders) . ")";
        }

        // 日付フィルターの基準カラム（CI日 or CO日）
        $dateCol = ($q['date_type'] ?? 'ci') === 'co' ? 'r.checkout_date' : 'r.checkin_date';

        if (!empty($q['date_from'])) {
            $where[] = "{$dateCol} >= :date_from";
            $params['date_from'] = $q['date_from'];
        }

        if (!empty($q['date_to'])) {
            $where[] = "{$dateCol} <= :date_to";
            $params['date_to'] = $q['date_to'];
        }

        // merged（統合済み子予約）と group_parent（複数室親予約）は一覧から除外
        // 一覧に表示すべきは実際に部屋を使う予約（子予約含む）のみ
        $where[] = "r.status NOT IN ('merged', 'group_parent')";

        // キャンセル・ノーショー非表示（デフォルト）
        if (!empty($q['hide_cancelled'])) {
            $where[] = "r.status NOT IN ('cancelled', 'no_show')";
        }

        $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        // ソート
        $sortMap = [
            'checkin_date'  => 'r.checkin_date',
            'checkout_date' => 'r.checkout_date',
            'guest_name'    => 'guest_name',
            'channel'       => 'r.channel',
            'status'        => 'r.status',
            'amount'        => 'r.amount',
        ];
        $sortKey = $sortMap[$q['sort'] ?? ''] ?? 'r.checkin_date';
        $sortOrder = strtoupper($q['order'] ?? 'DESC') === 'ASC' ? 'ASC' : 'DESC';

        // 件数取得（検索条件でguestsテーブルを参照するためJOINが必要）
        $countSql = "SELECT COUNT(*) FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id {$whereClause}";
        $countStmt = $db->prepare($countSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        // データ取得
        $dataSql = "
            SELECT
                r.id,
                r.checkin_date,
                r.checkout_date,
                r.nights,
                COALESCE(g.name_kanji, g.name_kana, g.name_romaji,
                         TRIM(CONCAT(r.tl_last_name, ' ', r.tl_first_name))) AS guest_name,
                CONCAT(r.tl_last_name, ' ', r.tl_first_name) AS guest_name_romaji,
                r.guest_id,
                r.guest_match_status,
                COALESCE(g.is_vip, 0) AS is_vip,
                COALESCE(g.visit_count, 0) AS visit_count,
                CASE WHEN g.guest_notes IS NOT NULL AND g.guest_notes != '' THEN 1 ELSE 0 END AS has_guest_notes,
                r.channel,
                r.reservation_no,
                r.room_type,
                rt.type_name AS room_type_name,
                rm.room_number,
                r.status,
                r.amount,
                r.adult_count,
                r.child_count,
                r.parent_reservation_id,
                r.room_index,
                -- 楽観ロック用（規約 #16）。物販の部屋付けなど、一覧から選んだ予約を
                -- そのまま更新する画面が updated_at を送れるようにする
                r.updated_at,
                COALESCE((SELECT SUM(rc.amount) FROM reservation_charges rc
                    WHERE rc.reservation_id = r.id AND rc.status = 'active'
                    AND rc.charge_type NOT IN ('payment','refund')), 0)
                - COALESCE((SELECT SUM(rc2.amount) FROM reservation_charges rc2
                    WHERE rc2.reservation_id = r.id AND rc2.status = 'active'
                    AND rc2.charge_type = 'payment'), 0) AS unpaid_amount
            FROM reservations r
            LEFT JOIN guests g ON g.id = r.guest_id
            LEFT JOIN room_types rt ON rt.type_code = r.room_type
            LEFT JOIN room_assignments ra ON ra.reservation_id = r.id AND ra.status = 'active'
            LEFT JOIN rooms rm ON rm.id = ra.room_id
            {$whereClause}
            ORDER BY {$sortKey} {$sortOrder}, r.id DESC
            LIMIT {$perPage} OFFSET {$offset}
        ";
        $dataStmt = $db->prepare($dataSql);
        $dataStmt->execute($params);
        $items = $dataStmt->fetchAll();

        // 型変換
        foreach ($items as &$item) {
            $item['id'] = (int) $item['id'];
            $item['guest_id'] = $item['guest_id'] ? (int) $item['guest_id'] : null;
            $item['is_vip'] = (bool) $item['is_vip'];
            $item['visit_count'] = (int) $item['visit_count'];
            $item['has_guest_notes'] = (bool) $item['has_guest_notes'];
            $item['amount'] = (int) $item['amount'];
            $item['adult_count'] = (int) $item['adult_count'];
            $item['child_count'] = (int) $item['child_count'];
            $item['nights'] = (int) $item['nights'];
            $item['unpaid_amount'] = (int) ($item['unpaid_amount'] ?? 0);
        }
        unset($item);

        // ステータス別件数（日付・チャネル・検索条件に連動。ステータスフィルターのみ外す）
        // 表示中の期間内での各ステータスの件数を返す
        $scWhere = ["r.status != 'merged'"];
        $scParams = [];
        if (!empty($q['date_from'])) {
            $scWhere[] = "{$dateCol} >= :sc_df";
            $scParams['sc_df'] = $q['date_from'];
        }
        if (!empty($q['date_to'])) {
            $scWhere[] = "{$dateCol} <= :sc_dt";
            $scParams['sc_dt'] = $q['date_to'];
        }
        if (!empty($q['channel'])) {
            $chs = explode(',', $q['channel']);
            $chPh = [];
            foreach ($chs as $ci => $ch) {
                $k = "sc_ch_{$ci}";
                $chPh[] = ":{$k}";
                $scParams[$k] = trim($ch);
            }
            $scWhere[] = "r.channel IN (" . implode(',', $chPh) . ")";
        }
        if (!empty($q['q'])) {
            $scWhere[] = "(r.tl_last_name LIKE :sc_q1 OR r.reservation_no LIKE :sc_q2 OR g.phone LIKE :sc_q3)";
            $scParams['sc_q1'] = '%' . $q['q'] . '%';
            $scParams['sc_q2'] = '%' . $q['q'] . '%';
            $scParams['sc_q3'] = '%' . $q['q'] . '%';
        }
        $scWhereClause = 'WHERE ' . implode(' AND ', $scWhere);
        $scStmt = $db->prepare("
            SELECT r.status, COUNT(*) AS cnt
            FROM reservations r
            LEFT JOIN guests g ON g.id = r.guest_id
            {$scWhereClause}
            GROUP BY r.status
        ");
        $scStmt->execute($scParams);
        $statusCounts = $scStmt->fetchAll(PDO::FETCH_KEY_PAIR);

        $allCount = array_sum($statusCounts);

        Response::json([
            'data' => $items,
            'pagination' => [
                'total'       => $total,
                'page'        => $page,
                'per_page'    => $perPage,
                'total_pages' => $perPage > 0 ? (int) ceil($total / $perPage) : 0,
            ],
            'status_counts' => [
                'all'         => $allCount,
                'confirmed'   => (int) ($statusCounts['confirmed'] ?? 0),
                'checked_in'  => (int) ($statusCounts['checked_in'] ?? 0),
                'checked_out' => (int) ($statusCounts['checked_out'] ?? 0),
                'cancelled'   => (int) ($statusCounts['cancelled'] ?? 0),
                'no_show'     => (int) ($statusCounts['no_show'] ?? 0),
            ],
        ]);
    }

    /** GET /api/v1/reservations/:id */
    public function show(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];

        // ゲスト名はguestsテーブルから取得し、なければTL原本名をフォールバックとして使用
        // フロントモードCI/CO確認画面がプラン名・食事区分・ゲスト住所を表示するため、
        // plans を JOIN し住所カラムも返す（いずれもフィールド追加のみ。PC画面には無害な後方互換拡張）
        $stmt = $db->prepare("
            SELECT
                r.*,
                COALESCE(g.name_kanji, g.name_kana, g.name_romaji,
                         TRIM(CONCAT(r.tl_last_name, ' ', r.tl_first_name))) AS guest_name,
                rt.type_name AS room_type_name,
                p.plan_name, p.meal_type,
                g.name_kanji, g.name_kana, g.name_romaji,
                g.guest_code,
                g.email AS guest_email, g.phone AS guest_phone, g.mobile_phone AS guest_mobile,
                g.postal_code AS guest_postal_code, g.prefecture AS guest_prefecture,
                g.address_line AS guest_address_line,
                g.guest_notes, g.visit_count, g.is_vip, g.country_code
            FROM reservations r
            LEFT JOIN guests g ON g.id = r.guest_id
            LEFT JOIN room_types rt ON rt.type_code = r.room_type
            LEFT JOIN plans p ON p.id = r.plan_id
            WHERE r.id = :id
        ");
        $stmt->execute(['id' => $id]);
        $reservation = $stmt->fetch();

        if (!$reservation) {
            Response::error('予約が見つかりません', 404);
        }

        // is_vip はbool化する（一覧系APIと同じ規約）。intのまま返すとフロントの
        // {is_vip && <VIPバッジ>} が非VIP時に「0」を描画してしまう（2026-07-25 アサインボード詳細モーダルで発生）
        $reservation['is_vip'] = (bool) $reservation['is_vip'];

        // アサイン情報
        $stmt = $db->prepare("
            SELECT ra.id, ra.room_id, rm.room_number, ra.check_in_date, ra.check_out_date, ra.status
            FROM room_assignments ra
            JOIN rooms rm ON rm.id = ra.room_id
            WHERE ra.reservation_id = :id
            ORDER BY ra.check_in_date
        ");
        $stmt->execute(['id' => $id]);
        $assignments = $stmt->fetchAll();

        // 売上明細
        $stmt = $db->prepare("
            SELECT rc.id, rc.reservation_id, rc.date, rc.charge_type, rc.description,
                   rc.amount, rc.tax_amount, rc.accommodation_tax, rc.status
            FROM reservation_charges rc
            WHERE rc.reservation_id = :id
            ORDER BY rc.date, rc.id
        ");
        $stmt->execute(['id' => $id]);
        $charges = $stmt->fetchAll();

        // イベント履歴（タイムライン表示用）
        $eventsStmt = $db->prepare("
            SELECT re.id, re.event_type, re.event_at, re.summary, re.detail,
                   re.tl_data_id, re.staff_id, s.staff_name
            FROM reservation_events re
            LEFT JOIN staff s ON s.id = re.staff_id
            WHERE re.reservation_id = :id
            ORDER BY re.event_at ASC, re.id ASC
        ");
        $eventsStmt->execute(['id' => $id]);
        $events = $eventsStmt->fetchAll();

        // 統合元情報（reservation_sources）
        $sourcesStmt = $db->prepare("
            SELECT rs.id, rs.original_reservation_id, rs.reservation_no, rs.channel,
                   rs.checkin_date, rs.checkout_date, rs.amount, rs.nights, rs.status
            FROM reservation_sources rs
            WHERE rs.reservation_id = :id
            ORDER BY rs.checkin_date
        ");
        $sourcesStmt->execute(['id' => $id]);
        $sources = $sourcesStmt->fetchAll();

        $isMergedParent = !empty($sources);
        $canSplit = $isMergedParent && in_array($reservation['status'], ['confirmed', 'checked_in']);

        $reservation['assignments'] = $assignments;
        $reservation['charges'] = $charges;
        $reservation['events'] = $events;
        $reservation['merged_sources'] = $sources;
        $reservation['is_merged_parent'] = $isMergedParent;
        $reservation['can_split'] = $canSplit;

        // パスポート画像一覧（フロントモードCI画面の撮影パネル用にadditive追加）。
        // 一覧はこれまで GuestController@show の guest_id 経由でしか取れなかったが、
        // フロントは予約単位で表示・撮影するため、この予約に紐づく有効な画像を返す。
        $passportStmt = $db->prepare("
            SELECT rp.id, rp.is_representative, rp.image_path, rp.scanned_at, s.staff_name AS scanned_by_name
            FROM reservation_passports rp
            LEFT JOIN staff s ON s.id = rp.scanned_by
            WHERE rp.reservation_id = :id AND rp.deleted_at IS NULL
            ORDER BY rp.is_representative DESC, rp.scanned_at ASC
        ");
        $passportStmt->execute(['id' => $id]);
        $passports = $passportStmt->fetchAll();
        foreach ($passports as &$p) {
            $p['id'] = (int) $p['id'];
            $p['is_representative'] = (bool) $p['is_representative'];
        }
        unset($p);
        $reservation['passports'] = $passports;

        // 未処理の merge_alert を構造化して返す
        // 統合予約の場合のみ。処理済みは summary に「対応済み」を含むもの。
        $reservation['pending_merge_alerts'] = [];
        if ($isMergedParent) {
            $alertStmt = $db->prepare("
                SELECT id, event_at, summary, detail
                FROM reservation_events
                WHERE reservation_id = :id AND event_type = 'merge_alert'
                  AND summary NOT LIKE '%対応済み%'
                ORDER BY event_at DESC
            ");
            $alertStmt->execute(['id' => $id]);
            foreach ($alertStmt->fetchAll() as $alert) {
                $d = json_decode($alert['detail'], true);
                $reservation['pending_merge_alerts'][] = [
                    'event_id'               => (int) $alert['id'],
                    'alert_type'             => $d['alert_type'] ?? '',
                    'channel'                => $d['channel'] ?? '',
                    'source_reservation_no'  => $d['source_reservation_no'] ?? '',
                    'before_ci'              => $d['before_ci'] ?? null,
                    'before_co'              => $d['before_co'] ?? null,
                    'after_ci'               => $d['after_ci'] ?? null,
                    'after_co'               => $d['after_co'] ?? null,
                    'event_at'               => $alert['event_at'],
                ];
            }
        }

        // 複数室予約: 子予約の場合は親情報を付与、親の場合は子一覧を付与
        $reservation['parent_reservation'] = null;
        $reservation['child_reservations'] = [];
        $reservation['is_multi_room_child'] = false;

        if (!empty($reservation['parent_reservation_id'])) {
            // この予約は複数室の子 → 親情報を取得
            // updated_at は子画面からのグループ一括CI/COの楽観ロックに使用する（検証報告 #6）
            $parentStmt = $db->prepare("
                SELECT id, reservation_no, channel, room_count, amount, status, updated_at
                FROM reservations WHERE id = :pid
            ");
            $parentStmt->execute(['pid' => $reservation['parent_reservation_id']]);
            $reservation['parent_reservation'] = $parentStmt->fetch() ?: null;
            $reservation['is_multi_room_child'] = true;

            // 兄弟（同じ親の子予約）も取得
            $siblingStmt = $db->prepare("
                SELECT r.id, r.room_index, r.room_type, r.amount, r.status,
                       rm.room_number AS assigned_room
                FROM reservations r
                LEFT JOIN room_assignments ra ON ra.reservation_id = r.id AND ra.status = 'active'
                LEFT JOIN rooms rm ON rm.id = ra.room_id
                WHERE r.parent_reservation_id = :pid
                ORDER BY r.room_index
            ");
            $siblingStmt->execute(['pid' => $reservation['parent_reservation_id']]);
            $reservation['child_reservations'] = $siblingStmt->fetchAll();
        } elseif ($reservation['status'] === 'group_parent') {
            // この予約は複数室の親 → 子一覧を取得
            $childStmt = $db->prepare("
                SELECT r.id, r.room_index, r.room_type, r.amount, r.status,
                       COALESCE(rt.type_name, r.room_type) AS room_type_name,
                       rm.room_number AS assigned_room,
                       COALESCE(g.name_kanji, g.name_romaji, r.tl_last_name) AS guest_name,
                       r.guest_id
                FROM reservations r
                LEFT JOIN room_assignments ra ON ra.reservation_id = r.id AND ra.status = 'active'
                LEFT JOIN rooms rm ON rm.id = ra.room_id
                LEFT JOIN guests g ON g.id = r.guest_id
                LEFT JOIN room_types rt ON rt.type_code = r.room_type
                WHERE r.parent_reservation_id = :pid
                ORDER BY r.room_index
            ");
            $childStmt->execute(['pid' => $id]);
            $children = $childStmt->fetchAll();
            $reservation['child_reservations'] = $children;

            // グループ管理画面用: 全子予約のchargesを統合取得（room_index付き）
            $chargeStmt = $db->prepare("
                SELECT rc.id, rc.reservation_id, rc.date, rc.charge_type, rc.description,
                       rc.amount, rc.tax_amount, rc.accommodation_tax, rc.status,
                       rc.payment_method_id
                FROM reservation_charges rc
                WHERE rc.reservation_id = :rid
                ORDER BY rc.date, rc.id
            ");
            $allCharges = [];
            foreach ($children as $child) {
                $chargeStmt->execute(['rid' => $child['id']]);
                $charges = $chargeStmt->fetchAll();
                foreach ($charges as &$c) {
                    $c['room_index'] = (int) $child['room_index'];
                }
                unset($c);
                $allCharges = array_merge($allCharges, $charges);
            }
            $reservation['group_charges'] = $allCharges;
        }

        // 名寄せ候補の有無を判定（new_guestステータスの場合のみチェック）
        // ゲスト名（半角カナ変換含む）で他のゲストを検索し、候補があればフラグを立てる
        $reservation['has_match_candidates'] = false;
        if ($reservation['guest_match_status'] === 'new_guest' && $reservation['guest_id']) {
            $nameForSearch = $reservation['tl_last_name'] ?? '';
            if ($nameForSearch) {
                // 半角カナ→全角カナ変換 + スペース除去も検索対象に追加
                $names = [$nameForSearch];
                $converted = mb_convert_kana($nameForSearch, 'KV');
                if ($converted !== $nameForSearch) $names[] = $converted;
                // スペース除去版
                $noSpace = preg_replace('/[\s　]+/u', '', $nameForSearch);
                if ($noSpace !== $nameForSearch) $names[] = $noSpace;
                $noSpaceConverted = preg_replace('/[\s　]+/u', '', $converted);
                if ($noSpaceConverted !== $converted && $noSpaceConverted !== $noSpace) $names[] = $noSpaceConverted;

                $conditions = [];
                $params = ['gid' => $reservation['guest_id']];
                foreach ($names as $i => $n) {
                    $like = '%' . $n . '%';
                    // 通常マッチ + DB側スペース除去マッチ
                    $conditions[] = "name_kanji LIKE :n{$i}a OR name_kana LIKE :n{$i}b OR name_romaji LIKE :n{$i}c"
                        . " OR REPLACE(REPLACE(name_kanji, ' ', ''), '　', '') LIKE :n{$i}d"
                        . " OR REPLACE(REPLACE(name_kana, ' ', ''), '　', '') LIKE :n{$i}e"
                        . " OR REPLACE(REPLACE(name_romaji, ' ', ''), '　', '') LIKE :n{$i}f";
                    $params["n{$i}a"] = $like;
                    $params["n{$i}b"] = $like;
                    $params["n{$i}c"] = $like;
                    $params["n{$i}d"] = $like;
                    $params["n{$i}e"] = $like;
                    $params["n{$i}f"] = $like;
                }
                $orClause = implode(' OR ', $conditions);
                $matchStmt = $db->prepare("
                    SELECT COUNT(*) FROM guests
                    WHERE id != :gid AND status = 'active' AND ({$orClause})
                ");
                $matchStmt->execute($params);
                $reservation['has_match_candidates'] = (int)$matchStmt->fetchColumn() > 0;
            }
        }

        // 発行済み帳票一覧（領収書・請求書）
        $docStmt = $db->prepare("
            SELECT d.id, d.document_number, d.type, d.addressee, d.total,
                   d.issued_at, d.reissue_count, d.status,
                   d.original_document_id,
                   s.staff_name AS issued_by_name
            FROM documents d
            LEFT JOIN staff s ON s.id = d.issued_by
            WHERE d.reservation_id = :rid AND d.status = 'issued'
            ORDER BY d.issued_at DESC
        ");
        $docStmt->execute(['rid' => $id]);
        $reservation['documents'] = $docStmt->fetchAll();

        // ゲストの領収書用宛名（直接入力で保存した値）
        if ($reservation['guest_id']) {
            $addrStmt = $db->prepare("SELECT receipt_addressee FROM guests WHERE id = :gid");
            $addrStmt->execute(['gid' => $reservation['guest_id']]);
            $reservation['receipt_addressee'] = $addrStmt->fetchColumn() ?: null;
        }

        Response::json($reservation);
    }

    /**
     * POST /api/v1/reservations
     * 手動予約作成（電話・直販・法人予約）
     *
     * TLリンカーン経由以外の予約を手動で登録する。
     * 予約番号は自動生成（P=電話, D=直販, C=法人 + 日付 + 連番）。
     */
    public function store(Request $request): void
    {
        $db = Database::getInstance();
        $staffId = $request->auth['staff_id'];
        $body = $request->body;

        // === バリデーション ===
        $errors = [];

        $channel = $body['channel'] ?? '';
        // チャネルの存在をDBマスタで検証（manual型のみ許可）
        $chStmt = $db->prepare("SELECT channel_code FROM channels WHERE channel_code = :code AND channel_type = 'manual' AND is_active = 1");
        $chStmt->execute(['code' => $channel]);
        if (!$chStmt->fetch()) {
            $errors[] = '有効な手動入力チャネルを指定してください';
        }

        $checkinDate = $body['checkin_date'] ?? '';
        $checkoutDate = $body['checkout_date'] ?? '';
        if (!$checkinDate || !$checkoutDate) {
            $errors[] = 'チェックイン日・チェックアウト日は必須です';
        } elseif ($checkinDate >= $checkoutDate) {
            $errors[] = 'チェックアウト日はチェックイン日より後にしてください';
        }

        // ゲスト名: guest_id指定時はDBから取得、未指定時はlast_name必須
        $guestId = !empty($body['guest_id']) ? (int) $body['guest_id'] : null;
        $lastName = trim($body['last_name'] ?? '');
        $firstName = trim($body['first_name'] ?? '');

        if (!$guestId && $lastName === '') {
            $errors[] = 'ゲストを選択するか、姓を入力してください';
        }

        $adultCount = max(1, (int) ($body['adult_count'] ?? 1));
        $childCount = max(0, (int) ($body['child_count'] ?? 0));

        // 料金明細（泊別）
        $charges = $body['charges'] ?? [];
        if (empty($charges)) {
            $errors[] = '料金明細を1泊分以上入力してください';
        }

        if (!empty($errors)) {
            Response::json(['error' => implode('、', $errors)], 400);
            return;
        }

        // === 泊数計算 ===
        $nights = (int) ((new \DateTime($checkoutDate))->diff(new \DateTime($checkinDate))->days);

        // === ゲスト情報の解決 ===
        $guestMatchStatus = 'new_guest';
        if ($guestId) {
            // 指定ゲストの存在確認 + 名前取得
            $gStmt = $db->prepare("SELECT id, name_kanji FROM guests WHERE id = :gid");
            $gStmt->execute(['gid' => $guestId]);
            $guest = $gStmt->fetch(PDO::FETCH_ASSOC);
            if (!$guest) {
                Response::json(['error' => '指定されたゲストが見つかりません'], 404);
                return;
            }
            // ゲスト名を予約名として使用（TL原本フィールド）
            if ($lastName === '') {
                // ゲストの漢字名から姓名を分割
                $parts = preg_split('/[\s　]+/u', $guest['name_kanji'] ?? '', 2);
                $lastName = $parts[0] ?? '';
                $firstName = $parts[1] ?? '';
            }
            $guestMatchStatus = 'matched';
        }

        // === 予約番号生成 ===
        // 形式: チャネルコード先頭1文字大文字 + YYYYMMDD + '-' + 3桁連番
        $channelPrefix = strtoupper(substr($channel, 0, 1));
        $dateStr = str_replace('-', '', $checkinDate);
        $seqStmt = $db->prepare("
            SELECT COUNT(*) FROM reservations
            WHERE reservation_no LIKE :prefix
        ");
        $seqStmt->execute(['prefix' => $channelPrefix . $dateStr . '-%']);
        $seq = (int) $seqStmt->fetchColumn() + 1;
        $reservationNo = sprintf('%s%s-%03d', $channelPrefix, $dateStr, $seq);

        // === 合計金額計算 ===
        $totalAmount = 0;
        $totalAccomTax = 0;
        foreach ($charges as $c) {
            $totalAmount += (int) ($c['amount'] ?? 0);
            $totalAccomTax += (int) ($c['accom_tax'] ?? 0);
        }

        // === トランザクション開始 ===
        $db->beginTransaction();
        try {
            // --- reservations INSERT ---
            $stmt = $db->prepare("
                INSERT INTO reservations (
                    channel, reservation_no, checkin_date, checkout_date, nights,
                    room_type, plan_id, amount, adult_count, child_count, child_amount,
                    guest_id, guest_match_status, status,
                    tl_last_name, tl_first_name,
                    payment_method, corporate_id, reservation_notes,
                    booked_at, updated_by
                ) VALUES (
                    :channel, :reservation_no, :checkin_date, :checkout_date, :nights,
                    :room_type, :plan_id, :amount, :adult_count, :child_count, :child_amount,
                    :guest_id, :guest_match_status, 'confirmed',
                    :tl_last_name, :tl_first_name,
                    :payment_method, :corporate_id, :notes,
                    NOW(), :staff_id
                )
            ");
            $stmt->execute([
                'channel'            => $channel,
                'reservation_no'     => $reservationNo,
                'checkin_date'       => $checkinDate,
                'checkout_date'      => $checkoutDate,
                'nights'             => $nights,
                'room_type'          => $body['room_type'] ?? null,
                'plan_id'            => !empty($body['plan_id']) ? (int) $body['plan_id'] : null,
                'amount'             => $totalAmount + $totalAccomTax,
                'adult_count'        => $adultCount,
                'child_count'        => $childCount,
                'child_amount'       => !empty($body['child_amount']) ? (int) $body['child_amount'] : null,
                'guest_id'           => $guestId,
                'guest_match_status' => $guestMatchStatus,
                'tl_last_name'       => $lastName,
                'tl_first_name'      => $firstName,
                'payment_method'     => $body['payment_method'] ?? null,
                'corporate_id'       => !empty($body['corporate_id']) ? (int) $body['corporate_id'] : null,
                'notes'              => $body['notes'] ?? null,
                'staff_id'           => $staffId,
            ]);
            $reservationId = (int) $db->lastInsertId();

            // --- reservation_charges INSERT（泊別） ---
            // プラン名取得（description用）
            $planName = '室料';
            if (!empty($body['plan_id'])) {
                $pStmt = $db->prepare("SELECT plan_name FROM plans WHERE id = :pid");
                $pStmt->execute(['pid' => (int) $body['plan_id']]);
                $pn = $pStmt->fetchColumn();
                if ($pn) $planName = $pn;
            }

            $chargeStmt = $db->prepare("
                INSERT INTO reservation_charges
                    (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
                VALUES
                    (:rid, :date, 'room', :description, :amount, :tax_amount, :accom_tax, 'active')
            ");
            foreach ($charges as $c) {
                $chargeAmount = (int) ($c['amount'] ?? 0);
                // 消費税: 税込金額から内税計算（10%）→ amount × 10/110 四捨五入
                $taxAmount = (int) round($chargeAmount * 10 / 110);
                $accomTax = (int) ($c['accom_tax'] ?? 0);

                $chargeStmt->execute([
                    'rid'         => $reservationId,
                    'date'        => $c['date'],
                    'description' => $planName,
                    'amount'      => $chargeAmount,
                    'tax_amount'  => $taxAmount,
                    'accom_tax'   => $accomTax,
                ]);
            }

            // --- reservation_events INSERT ---
            // チャネル表示名をDBから取得
            $chNameStmt = $db->prepare("SELECT channel_name FROM channels WHERE channel_code = :code");
            $chNameStmt->execute(['code' => $channel]);
            $channelLabel = $chNameStmt->fetchColumn() ?: $channel;
            $db->prepare("
                INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, staff_id)
                VALUES (:rid, 'manual_create', NOW(), :summary, :staff_id)
            ")->execute([
                'rid'      => $reservationId,
                'summary'  => "手動予約作成（{$channelLabel}）{$reservationNo}",
                'staff_id' => $staffId,
            ]);

            // --- ゲストのvisit_count更新 ---
            if ($guestId) {
                $db->prepare("
                    UPDATE guests SET visit_count = visit_count + 1, updated_at = NOW() WHERE id = :gid
                ")->execute(['gid' => $guestId]);
            }

            $db->commit();

            Response::json([
                'id'             => $reservationId,
                'reservation_no' => $reservationNo,
                'message'        => '予約を作成しました',
            ], 201);

        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
    }

    /** PUT /api/v1/reservations/:id */
    public function update(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];
        $staffId = $request->auth['staff_id'];
        $body = $request->body;

        $stmt = $db->prepare("SELECT id, status FROM reservations WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $reservation = $stmt->fetch();

        if (!$reservation) {
            Response::error('予約が見つかりません', 404);
        }

        // 楽観ロック: 他スタッフによる同時更新を検出
        $this->checkOptimisticLock($id, $body['updated_at'] ?? null);

        // 更新可能フィールド
        $updatable = [];
        $params = ['id' => $id, 'staff_id' => $staffId];

        if (array_key_exists('adult_count', $body)) {
            $updatable[] = 'adult_count = :adult_count';
            $params['adult_count'] = (int)$body['adult_count'];
        }
        if (array_key_exists('child_count', $body)) {
            $updatable[] = 'child_count = :child_count';
            $params['child_count'] = (int)$body['child_count'];
        }
        // 人数内訳（男女別・子供区分別）の更新と集計の自動再計算
        $this->applyPaxBreakdown($db, $id, $body, $updatable, $params);

        if (array_key_exists('child_amount', $body)) {
            $updatable[] = 'child_amount = :child_amount';
            $params['child_amount'] = $body['child_amount'];
        }
        if (array_key_exists('payment_method', $body)) {
            $updatable[] = 'payment_method = :payment_method';
            $params['payment_method'] = $body['payment_method'];
        }
        if (array_key_exists('reservation_notes', $body)) {
            $updatable[] = 'reservation_notes = :reservation_notes';
            $params['reservation_notes'] = $body['reservation_notes'];
        }
        // ゲスト名の編集はguestsテーブル側で行う（予約テーブルのtl_*は原本のため変更不可）
        if (array_key_exists('room_type', $body)) {
            $updatable[] = 'room_type = :room_type';
            $params['room_type'] = $body['room_type'];
        }
        // CI日・CO日の変更（nights 再計算 + アサイン解除）
        $this->applyDateChange($db, $id, $body, $updatable, $params);

        // 明細編集の権限チェック用（自予約のみ許可）
        $allowedResIds = [$id];
        // 編集と追加の両方がある場合、追加後の再計算が編集分も上書きする既存挙動を
        // 維持するため、affectedResIds は参照渡しで2メソッド間で共有する
        $affectedResIds = [];

        // 売上明細の更新（全項目編集対応）
        if (!empty($body['charges'])) {
            $this->applyChargeEdits($db, $allowedResIds, $body['charges'], $affectedResIds);
        }

        // 明細行の追加
        if (!empty($body['add_charges'])) {
            $this->applyChargeAdds($db, $id, $body['add_charges'], $affectedResIds);
        }

        // 明細行の削除（論理削除: status→cancelled）
        if (!empty($body['delete_charge_ids'])) {
            $this->applyChargeDeletes($db, $allowedResIds, $body['delete_charge_ids']);
        }

        $hasChanges = !empty($updatable) || !empty($body['charges']) || !empty($body['add_charges']) || !empty($body['delete_charge_ids']);
        if (!$hasChanges) {
            Response::error('更新するフィールドがありません', 400);
        }

        if (!empty($updatable)) {
            $updatable[] = 'updated_at = NOW()';
            $updatable[] = 'updated_by = :staff_id';
            $sql = "UPDATE reservations SET " . implode(', ', $updatable) . " WHERE id = :id";
            $db->prepare($sql)->execute($params);
        }

        Response::json(['message' => '予約を更新しました', 'reservation_id' => $id]);
    }

    // ================================================================
    // update() の分割メソッド群
    // update() が242行・ネスト5段まで肥大化していたため責務単位で分割（2026-06-11）
    // ================================================================

    /**
     * 人数内訳（男女別・子供区分別）の更新フィールドを組み立てる
     * 内訳が1つでも変更されたら adult_count / child_count を自動再計算する
     */
    private function applyPaxBreakdown(\PDO $db, int $id, array $body, array &$updatable, array &$params): void
    {
        $paxBreakdownChanged = false;
        foreach (['male_count', 'female_count', 'child_a_count', 'child_b_count', 'child_c_count', 'child_d_count'] as $paxField) {
            if (array_key_exists($paxField, $body)) {
                $updatable[] = "{$paxField} = :{$paxField}";
                $params[$paxField] = (int)$body[$paxField];
                $paxBreakdownChanged = true;
            }
        }
        if (!$paxBreakdownChanged) return;

        // 現在のDB値を取得して、送られてきた値で上書きしつつ集計を再計算
        $currentStmt = $db->prepare("
            SELECT male_count, female_count, child_a_count, child_b_count, child_c_count, child_d_count
            FROM reservations WHERE id = :cid
        ");
        $currentStmt->execute(['cid' => $id]);
        $current = $currentStmt->fetch(\PDO::FETCH_ASSOC);

        // 送信された値で上書き、送信されていないものは現在値を使う
        $val = fn(string $field) => array_key_exists($field, $body) ? (int)$body[$field] : (int)$current[$field];

        // adult_count = 男 + 女、child_count = A + B + C + D
        // 明示的に送られていなければ自動計算値で上書きする
        if (!array_key_exists('adult_count', $body)) {
            $updatable[] = 'adult_count = :adult_count';
            $params['adult_count'] = $val('male_count') + $val('female_count');
        }
        if (!array_key_exists('child_count', $body)) {
            $updatable[] = 'child_count = :child_count';
            $params['child_count'] = $val('child_a_count') + $val('child_b_count') + $val('child_c_count') + $val('child_d_count');
        }
    }

    /**
     * CI日・CO日の変更フィールドを組み立てる（nights 自動再計算）
     * 日程変更時はアサインを外す（CI前なので物理削除。再アサインが必要）
     */
    private function applyDateChange(\PDO $db, int $id, array $body, array &$updatable, array &$params): void
    {
        if (!array_key_exists('checkin_date', $body) && !array_key_exists('checkout_date', $body)) return;

        $stmt = $db->prepare("SELECT checkin_date, checkout_date FROM reservations WHERE id = :rid");
        $stmt->execute(['rid' => $id]);
        $current = $stmt->fetch();
        $newCI = $body['checkin_date'] ?? $current['checkin_date'];
        $newCO = $body['checkout_date'] ?? $current['checkout_date'];
        $newNights = $newCO > $newCI ? (new \DateTime($newCI))->diff(new \DateTime($newCO))->days : 0;
        if ($newNights < 1) {
            Response::error('CO日はCI日より後である必要があります', 400);
        }
        $updatable[] = 'checkin_date = :checkin_date';
        $params['checkin_date'] = $newCI;
        $updatable[] = 'checkout_date = :checkout_date';
        $params['checkout_date'] = $newCO;
        $updatable[] = 'nights = :nights';
        $params['nights'] = $newNights;

        $db->prepare("DELETE FROM room_assignments WHERE reservation_id = :rid AND status = 'active'")
           ->execute(['rid' => $id]);
    }

    /**
     * 売上明細の編集（全項目編集対応）と合計金額の再計算
     * $affectedResIds は applyChargeAdds と共有する（参照渡し）
     */
    private function applyChargeEdits(\PDO $db, array $allowedResIds, array $charges, array &$affectedResIds): void
    {
        foreach ($charges as $charge) {
            if (empty($charge['id'])) continue;
            $cid = (int) $charge['id'];

            // charge の reservation_id を取得して権限チェック（自予約のみ許可）
            $stmt = $db->prepare("SELECT reservation_id, charge_type FROM reservation_charges WHERE id = :cid");
            $stmt->execute(['cid' => $cid]);
            $chargeRow = $stmt->fetch();
            if (!$chargeRow) continue;
            $chargeResId = (int) $chargeRow['reservation_id'];
            if (!in_array($chargeResId, $allowedResIds)) continue;

            // goods（物販）行は product_sales と1対1で対応するため明細側から編集させない。
            // 逆方向（他種別 → goods への変更）も、対になる product_sales の無い goods 行が
            // 生まれて売上集計が食い違うため拒否する。UI側でも制御しているが、
            // API直叩きで整合が壊れるのを防ぐためサーバー側でも弾く
            if ($chargeRow['charge_type'] === 'goods') continue;
            if (isset($charge['charge_type']) && $charge['charge_type'] === 'goods') {
                unset($charge['charge_type']);
            }

            // 更新フィールドを動的に構築
            $sets = ['updated_at = NOW()'];
            $p = ['cid' => $cid];
            if (isset($charge['amount'])) {
                $sets[] = 'amount = :amount';
                $p['amount'] = (int) $charge['amount'];
            }
            if (isset($charge['description'])) {
                $sets[] = 'description = :desc';
                $p['desc'] = $charge['description'];
            }
            if (isset($charge['date'])) {
                $sets[] = 'date = :date';
                $p['date'] = $charge['date'];
            }
            if (isset($charge['charge_type'])) {
                $sets[] = 'charge_type = :ctype';
                $p['ctype'] = $charge['charge_type'];
            }
            if (isset($charge['status'])) {
                $sets[] = 'status = :status';
                $p['status'] = $charge['status'];
            }

            $db->prepare("UPDATE reservation_charges SET " . implode(', ', $sets) . " WHERE id = :cid")
               ->execute($p);

            $affectedResIds[$chargeResId] = true;
        }

        // 影響を受けた各予約の合計金額を再計算
        foreach (array_keys($affectedResIds) as $resId) {
            $stmt = $db->prepare("
                SELECT COALESCE(SUM(amount), 0) FROM reservation_charges
                WHERE reservation_id = :rid AND status = 'active'
            ");
            $stmt->execute(['rid' => $resId]);
            $total = (int) $stmt->fetchColumn();
            $db->prepare("UPDATE reservations SET amount = :total, updated_at = NOW() WHERE id = :rid")
               ->execute(['total' => $total, 'rid' => $resId]);
        }
    }

    /**
     * 明細行の追加と合計金額の再計算
     * 再計算は applyChargeEdits で影響を受けた予約も含めて行う（既存挙動の維持）
     */
    private function applyChargeAdds(\PDO $db, int $reservationId, array $newCharges, array &$affectedResIds): void
    {
        foreach ($newCharges as $newCharge) {
            // goods（物販）行の追加は ProductSaleController 経由のみ。
            // ここから作ると product_sales と対にならない goods 行が生まれるため弾く
            if (($newCharge['charge_type'] ?? '') === 'goods') continue;

            $db->prepare("
                INSERT INTO reservation_charges
                (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, payment_method_id, status)
                VALUES (:rid, :d, :ctype, :desc, :amount, :tax, 0, :pmid, 'active')
            ")->execute([
                'rid'    => $reservationId,
                'd'      => $newCharge['date'] ?? date('Y-m-d'),
                'ctype'  => $newCharge['charge_type'] ?? 'room',
                'desc'   => $newCharge['description'] ?? '',
                'amount' => (int) ($newCharge['amount'] ?? 0),
                'tax'    => (int) ($newCharge['tax_amount'] ?? 0),
                'pmid'   => !empty($newCharge['payment_method_id']) ? (int) $newCharge['payment_method_id'] : null,
            ]);

            $affectedResIds[$reservationId] = true;
        }

        // 追加後も合計再計算（入金行は売上に含めない）
        foreach (array_keys($affectedResIds) as $resId) {
            $stmt = $db->prepare("
                SELECT COALESCE(SUM(amount), 0) FROM reservation_charges
                WHERE reservation_id = :rid AND status = 'active' AND charge_type != 'payment'
            ");
            $stmt->execute(['rid' => $resId]);
            $total = (int) $stmt->fetchColumn();
            $db->prepare("UPDATE reservations SET amount = :total, updated_at = NOW() WHERE id = :rid")
               ->execute(['total' => $total, 'rid' => $resId]);
        }
    }

    /**
     * 明細行の削除（論理削除: status→cancelled。規約 #13: 物理DELETE禁止）と合計再計算
     */
    private function applyChargeDeletes(\PDO $db, array $allowedResIds, array $deleteIds): void
    {
        foreach ($deleteIds as $delId) {
            $delId = (int) $delId;
            // 権限チェック（自予約のみ許可）
            $stmt = $db->prepare("SELECT reservation_id FROM reservation_charges WHERE id = :cid");
            $stmt->execute(['cid' => $delId]);
            $delResId = (int) $stmt->fetchColumn();
            if (!in_array($delResId, $allowedResIds)) continue;

            $db->prepare("UPDATE reservation_charges SET status = 'cancelled', updated_at = NOW() WHERE id = :cid")
               ->execute(['cid' => $delId]);

            // 合計再計算（入金行は売上に含めない）
            $stmt = $db->prepare("
                SELECT COALESCE(SUM(amount), 0) FROM reservation_charges
                WHERE reservation_id = :rid AND status = 'active' AND charge_type != 'payment'
            ");
            $stmt->execute(['rid' => $delResId]);
            $total = (int) $stmt->fetchColumn();
            $db->prepare("UPDATE reservations SET amount = :total, updated_at = NOW() WHERE id = :rid")
               ->execute(['total' => $total, 'rid' => $delResId]);
        }
    }

    /** POST /api/v1/reservations/:id/cancel */
    public function cancel(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];
        $staffId = $request->auth['staff_id'];

        // 楽観ロック
        $this->checkOptimisticLock($id, $request->body['updated_at'] ?? null);

        $stmt = $db->prepare("SELECT id, status FROM reservations WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $reservation = $stmt->fetch();

        if (!$reservation) {
            Response::error('予約が見つかりません', 404);
        }

        // キャンセル可能: confirmed のみ（CI済み・CO済みはキャンセル不可）
        if ($reservation['status'] !== 'confirmed') {
            Response::error('この予約はキャンセルできません（ステータス: ' . $reservation['status'] . '）', 422);
        }

        $db->prepare("
            UPDATE reservations SET status = 'cancelled', updated_at = NOW(), updated_by = :staff_id WHERE id = :id
        ")->execute(['staff_id' => $staffId, 'id' => $id]);

        // 統合予約の場合、吸収されている merged 子予約も連動してキャンセルする（検証報告 #15）
        // 親が消えると子は merged のまま永久に残り、解除も削除もできなくなるため
        $db->prepare("
            UPDATE reservations SET status = 'cancelled', updated_at = NOW(), updated_by = :staff_id
            WHERE status = 'merged'
              AND id IN (SELECT original_reservation_id FROM reservation_sources
                         WHERE reservation_id = :pid AND original_reservation_id != :pid2)
        ")->execute(['staff_id' => $staffId, 'pid' => $id, 'pid2' => $id]);

        // アサインがあれば物理削除（CI前なので履歴不要）
        $db->prepare("DELETE FROM room_assignments WHERE reservation_id = :id AND status = 'active'")
           ->execute(['id' => $id]);

        // 操作ログ
        $db->prepare("
            INSERT INTO staff_activity_logs (staff_id, action, target_type, target_id)
            VALUES (:staff_id, 'cancel', 'reservation', :target_id)
        ")->execute(['staff_id' => $staffId, 'target_id' => $id]);

        Response::json(['message' => '予約をキャンセルしました', 'reservation_id' => $id]);
    }

    /** POST /api/v1/reservations/:id/restore — キャンセル・ノーショーの復元 */
    public function restore(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];
        $staffId = $request->auth['staff_id'];

        // 楽観ロック
        $this->checkOptimisticLock($id, $request->body['updated_at'] ?? null);

        $stmt = $db->prepare("SELECT id, status FROM reservations WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $reservation = $stmt->fetch();

        if (!$reservation) {
            Response::error('予約が見つかりません', 404);
        }

        // 復元可能: cancelled / no_show のみ
        if (!in_array($reservation['status'], ['cancelled', 'no_show'])) {
            Response::error('この予約は復元できません（ステータス: ' . $reservation['status'] . '）', 422);
        }

        // confirmed に戻す
        $db->prepare("
            UPDATE reservations SET status = 'confirmed', updated_at = NOW(), updated_by = :staff_id WHERE id = :id
        ")->execute(['staff_id' => $staffId, 'id' => $id]);

        // 統合予約の復元時は、キャンセル時に連動して落とした merged 子も戻す（cancel() と対称）
        $db->prepare("
            UPDATE reservations SET status = 'merged', updated_at = NOW(), updated_by = :staff_id
            WHERE status = 'cancelled'
              AND id IN (SELECT original_reservation_id FROM reservation_sources
                         WHERE reservation_id = :pid AND original_reservation_id != :pid2)
        ")->execute(['staff_id' => $staffId, 'pid' => $id, 'pid2' => $id]);

        // 操作ログ
        $db->prepare("
            INSERT INTO staff_activity_logs (staff_id, action, target_type, target_id)
            VALUES (:staff_id, 'restore', 'reservation', :target_id)
        ")->execute(['staff_id' => $staffId, 'target_id' => $id]);

        Response::json(['message' => '予約を復元しました', 'reservation_id' => $id]);
    }

    // ================================================================
    // 予約統合・分割
    // ================================================================

    /**
     * POST /api/v1/reservations/merge — 予約統合
     *
     * OTAが連泊を1泊ずつ別予約で通知した場合に、
     * スタッフが手動で複数予約を1つの予約（親）に統合する。
     * 子予約は status='merged' で無効化され、元のOTA予約番号は
     * reservation_sources に保持される。
     */
    public function merge(Request $request): void
    {
        $db = Database::getInstance();
        $staffId = $request->auth['staff_id'];
        $body = $request->body;
        $reservationIds = $body['reservation_ids'] ?? [];

        // --- バリデーション ---

        if (count($reservationIds) < 2) {
            Response::error('統合には2件以上の予約が必要です', 400);
        }

        // 楽観ロック: 全対象予約が選択後に変更されていないか確認
        $expectedUpdatedAts = $body['updated_ats'] ?? [];
        foreach ($expectedUpdatedAts as $rid => $expectedAt) {
            $this->checkOptimisticLock((int) $rid, $expectedAt);
        }

        // 各予約の取得 + ステータス確認
        $reservations = [];
        foreach ($reservationIds as $rid) {
            $stmt = $db->prepare("
                SELECT id, guest_id, channel, reservation_no, checkin_date, checkout_date,
                       nights, amount, room_type, adult_count, child_count, status,
                       parent_reservation_id, room_count,
                       tl_last_name, tl_first_name
                FROM reservations WHERE id = :id
            ");
            $stmt->execute(['id' => (int) $rid]);
            $r = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$r) {
                Response::error("予約 ID={$rid} が見つかりません", 404);
            }
            if ($r['status'] !== 'confirmed') {
                Response::error("予約 ID={$rid} は統合できません（ステータス: {$r['status']}）。統合できるのは「予約確定」のみです", 422);
            }
            // 複数室グループの子・親は統合不可（検証報告 #4）
            // 子は reservation_no=NULL のため source 照合が壊れ、親の room_count との整合も崩れるため
            if (!empty($r['parent_reservation_id'])) {
                Response::error("予約 ID={$rid} は複数室グループの一室のため統合できません", 422);
            }
            if ((int) ($r['room_count'] ?? 1) > 1) {
                Response::error("予約 ID={$rid} は複数室グループの親予約のため統合できません", 422);
            }
            $reservations[] = $r;
        }

        // チャネル混在OK: 同一ゲストが異なるOTAから1泊ずつ予約するケースがあるため
        // チャネル一致チェックは行わない

        // 二重統合防止は status チェック（confirmed のみ許可）で十分。
        // merged ステータスの予約は上の status チェックで既にブロックされる。
        // 分割等で confirmed に戻った予約は再統合可能とする。

        // CI日でソート
        usort($reservations, function ($a, $b) {
            return strcmp($a['checkin_date'], $b['checkin_date']);
        });

        // 日程連続性チェック（予約Aの checkout_date == 予約Bの checkin_date）
        for ($i = 0; $i < count($reservations) - 1; $i++) {
            if ($reservations[$i]['checkout_date'] !== $reservations[$i + 1]['checkin_date']) {
                Response::error(
                    "日程が連続していません: ID={$reservations[$i]['id']}のCO日({$reservations[$i]['checkout_date']}) と "
                    . "ID={$reservations[$i + 1]['id']}のCI日({$reservations[$i + 1]['checkin_date']})が一致しません",
                    422
                );
            }
        }

        // --- 統合処理（トランザクション） ---

        $parent = $reservations[0];
        $children = array_slice($reservations, 1);
        $lastChild = end($reservations);

        // 統合後の値
        // 泊数は DateTime::diff で算出（strtotime秒差/86400 はDSTのある地域で1日ずれるため。検証報告 #16）
        $newCheckout = $lastChild['checkout_date'];
        $newNights = (new \DateTime($parent['checkin_date']))->diff(new \DateTime($newCheckout))->days;

        // 統合前の情報（ログ用）
        $beforeInfo = [
            'parent_id'       => (int) $parent['id'],
            'parent_dates'    => $parent['checkin_date'] . '〜' . $parent['checkout_date'],
            'parent_amount'   => (int) $parent['amount'],
            'child_ids'       => array_map(fn($c) => (int) $c['id'], $children),
            'child_res_nos'   => array_map(fn($c) => $c['reservation_no'], $children),
        ];

        $db->beginTransaction();
        try {
            // 1. 親の guest_id が NULL なら子から引き継ぐ
            $parentGuestId = $parent['guest_id'];
            if (!$parentGuestId) {
                foreach ($children as $child) {
                    if ($child['guest_id']) {
                        $parentGuestId = $child['guest_id'];
                        break;
                    }
                }
            }

            // 2. 全予約の情報を reservation_sources に記録
            // 統合後の予約は特定OTAに属さない1つの滞在レコードになる。
            // 元の全OTA予約番号は reservation_sources で管理する。
            // original_guest_id: 統合時の各予約のguest_idを記録し、解除時に元のゲスト紐付けを復元する（検証報告 #10）
            $sourceStmt = $db->prepare("
                INSERT INTO reservation_sources
                (reservation_id, original_reservation_id, reservation_no, channel,
                 checkin_date, checkout_date, amount, nights, original_guest_id, status)
                VALUES (:parent_id, :orig_id, :resno, :channel,
                        :ci, :co, :amount, :nights, :orig_guest, 'active')
            ");

            // 親が既にsourcesを持っているか確認（再統合のケース）
            $existCheck = $db->prepare("
                SELECT COUNT(*) FROM reservation_sources WHERE reservation_id = :pid
            ");
            $existCheck->execute(['pid' => (int) $parent['id']]);
            $parentAlreadyHasSources = (int) $existCheck->fetchColumn() > 0;

            // 親自身のOTA情報をsourcesに追加（まだ無い場合のみ）
            // 既に統合済み（分割→再統合）の親は既存sourcesをそのまま活用する。
            // channel が NULL の場合もスキップ（既に統合でNULL化された親）。
            if (!$parentAlreadyHasSources && $parent['channel'] !== null && $parent['reservation_no'] !== null) {
                $sourceStmt->execute([
                    'parent_id'  => (int) $parent['id'],
                    'orig_id'    => (int) $parent['id'],
                    'resno'      => $parent['reservation_no'],
                    'channel'    => $parent['channel'],
                    'ci'         => $parent['checkin_date'],
                    'co'         => $parent['checkout_date'],
                    'amount'     => (int) $parent['amount'],
                    'nights'     => (int) $parent['nights'],
                    'orig_guest' => $parent['guest_id'] ? (int) $parent['guest_id'] : null,
                ]);
            }

            // 子予約のOTA情報をsourcesに追加
            // 子が既にsourcesを持っている場合（子自身も過去の統合親だった）は、
            // 子のsourcesを親に付替える。付替えたsourcesに子自身の予約番号が
            // 含まれている場合はINSERTをスキップ（重複防止）。
            $dupCheck = $db->prepare("
                SELECT COUNT(*) FROM reservation_sources
                WHERE reservation_id = :pid AND channel = :ch AND reservation_no = :rno
            ");
            foreach ($children as $child) {
                // 子が持つ既存sourcesを親に付替え
                $db->prepare("
                    UPDATE reservation_sources SET reservation_id = :parent_id
                    WHERE reservation_id = :child_id
                ")->execute([
                    'parent_id' => (int) $parent['id'],
                    'child_id'  => (int) $child['id'],
                ]);

                // 付替えで親に同じ(channel, reservation_no)が重複した場合、古い方を削除
                // 過去の統合テスト等で残ったゴミsourceが混入するのを防ぐ
                $db->prepare("
                    DELETE s1 FROM reservation_sources s1
                    INNER JOIN reservation_sources s2
                    ON s1.reservation_id = s2.reservation_id
                       AND s1.channel = s2.channel
                       AND s1.reservation_no = s2.reservation_no
                       AND s1.id < s2.id
                    WHERE s1.reservation_id = :pid
                ")->execute(['pid' => (int) $parent['id']]);

                // 子自身のOTA情報を追加
                // - channelがNULL → 既に統合でNULL化された予約なのでスキップ
                // - 付替えたsourcesに同じ予約番号が既にある → 重複するのでスキップ
                if ($child['channel'] !== null) {
                    $dupCheck->execute([
                        'pid' => (int) $parent['id'],
                        'ch'  => $child['channel'],
                        'rno' => $child['reservation_no'],
                    ]);
                    if ((int) $dupCheck->fetchColumn() === 0) {
                        $sourceStmt->execute([
                            'parent_id'  => (int) $parent['id'],
                            'orig_id'    => (int) $child['id'],
                            'resno'      => $child['reservation_no'],
                            'channel'    => $child['channel'],
                            'ci'         => $child['checkin_date'],
                            'co'         => $child['checkout_date'],
                            'amount'     => (int) $child['amount'],
                            'nights'     => (int) $child['nights'],
                            'orig_guest' => $child['guest_id'] ? (int) $child['guest_id'] : null,
                        ]);
                    }
                }
            }

            // 3. 子予約の reservation_charges を親に付替え
            // merged_from_reservation_id に元予約IDを記録する。
            // 解除時はこのカラムで正確に戻す（日付範囲方式だとCO日当日の入金等が親に取り残されるため。検証報告 #1）
            foreach ($children as $child) {
                $db->prepare("
                    UPDATE reservation_charges
                    SET reservation_id = :parent_id,
                        merged_from_reservation_id = :from_id
                    WHERE reservation_id = :child_id
                ")->execute([
                    'parent_id' => (int) $parent['id'],
                    'from_id'   => (int) $child['id'],
                    'child_id'  => (int) $child['id'],
                ]);
            }

            // 4. 親予約の金額を charges から再計算
            $stmt = $db->prepare("
                SELECT COALESCE(SUM(amount), 0) FROM reservation_charges
                WHERE reservation_id = :id AND status = 'active' AND charge_type NOT IN ('payment','refund')
            ");
            $stmt->execute(['id' => (int) $parent['id']]);
            $newAmount = (int) $stmt->fetchColumn();

            // 5. 親予約を「統合予約」に変換
            // reservation_no/channel を NULL にして特定OTAに属さない1滞在レコードにする。
            // PMS内部の予約番号は reservations.id（主キー）で識別する。
            $db->prepare("
                UPDATE reservations SET
                    reservation_no = NULL,
                    channel = NULL,
                    checkout_date = :co,
                    nights = :nights,
                    amount = :amount,
                    guest_id = :guest_id,
                    updated_at = NOW(),
                    updated_by = :staff_id
                WHERE id = :id
            ")->execute([
                'co'       => $newCheckout,
                'nights'   => $newNights,
                'amount'   => $newAmount,
                'guest_id' => $parentGuestId,
                'staff_id' => $staffId,
                'id'       => (int) $parent['id'],
            ]);

            // 6. 親予約のアサインのCO日を統合後の日程に拡張
            // 予約の checkout_date が延びたので、アサインも合わせる必要がある。
            // CI前のアサインのみ更新（CI済みの場合はアサインに触らない）。
            $db->prepare("
                UPDATE room_assignments
                SET check_out_date = :new_co
                WHERE reservation_id = :rid AND status = 'active'
                  AND check_out_date < :new_co2
            ")->execute([
                'new_co'  => $newCheckout,
                'rid'     => (int) $parent['id'],
                'new_co2' => $newCheckout,
            ]);

            // 7. 子予約を merged 化
            $childIds = array_map(fn($c) => (int) $c['id'], $children);
            $inPlaceholders = implode(',', array_fill(0, count($childIds), '?'));
            $db->prepare("
                UPDATE reservations SET status = 'merged', guest_id = NULL,
                       updated_at = NOW(), updated_by = {$staffId}
                WHERE id IN ({$inPlaceholders})
            ")->execute($childIds);

            // 7. 子予約のアサインを物理削除（CI前のアサイン操作 — CLAUDE.md準拠）
            // 削除前に情報をイベントに記録
            foreach ($children as $child) {
                $assignStmt = $db->prepare("
                    SELECT ra.id, rm.room_number, ra.check_in_date, ra.check_out_date
                    FROM room_assignments ra
                    JOIN rooms rm ON rm.id = ra.room_id
                    WHERE ra.reservation_id = :rid AND ra.status = 'active'
                ");
                $assignStmt->execute(['rid' => (int) $child['id']]);
                $assigns = $assignStmt->fetchAll(PDO::FETCH_ASSOC);

                if (!empty($assigns)) {
                    // アサイン削除をイベントに記録
                    $db->prepare("
                        INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, detail, staff_id)
                        VALUES (:rid, 'merge', NOW(), :summary, :detail, :staff_id)
                    ")->execute([
                        'rid'     => (int) $child['id'],
                        'summary' => '予約統合によりアサイン解除',
                        'detail'  => json_encode($assigns, JSON_UNESCAPED_UNICODE),
                        'staff_id' => $staffId,
                    ]);

                    // 物理削除
                    $db->prepare("DELETE FROM room_assignments WHERE reservation_id = :rid")
                       ->execute(['rid' => (int) $child['id']]);
                }
            }

            // 9. 親予約に統合イベントを記録
            $afterInfo = [
                'checkin_date'  => $parent['checkin_date'],
                'checkout_date' => $newCheckout,
                'nights'        => $newNights,
                'amount'        => $newAmount,
                'merged_ids'    => $childIds,
                'merged_res_nos' => array_column($children, 'reservation_no'),
            ];
            $db->prepare("
                INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, detail, staff_id)
                VALUES (:rid, 'merge', NOW(), :summary, :detail, :staff_id)
            ")->execute([
                'rid'      => (int) $parent['id'],
                'summary'  => count($children) . '件の予約を統合',
                'detail'   => json_encode([
                    'before' => $beforeInfo,
                    'after'  => $afterInfo,
                ], JSON_UNESCAPED_UNICODE),
                'staff_id' => $staffId,
            ]);

            // 10. 操作ログ
            $db->prepare("
                INSERT INTO staff_activity_logs (staff_id, action, target_type, target_id, detail)
                VALUES (:staff_id, 'merge', 'reservation', :target_id, :detail)
            ")->execute([
                'staff_id'  => $staffId,
                'target_id' => (int) $parent['id'],
                'detail'    => json_encode([
                    'parent_id' => (int) $parent['id'],
                    'child_ids' => $childIds,
                    'before'    => $beforeInfo,
                    'after'     => $afterInfo,
                ], JSON_UNESCAPED_UNICODE),
            ]);

            $db->commit();

        } catch (\Throwable $e) {
            $db->rollBack();
            Response::error('統合処理に失敗しました: ' . $e->getMessage(), 500);
        }

        Response::json([
            'message'                => '予約を統合しました',
            'parent_reservation_id'  => (int) $parent['id'],
            'merged_reservation_ids' => $childIds,
            'checkin_date'           => $parent['checkin_date'],
            'checkout_date'          => $newCheckout,
            'nights'                 => $newNights,
            'amount'                 => $newAmount,
        ]);
    }

    /**
     * POST /api/v1/reservations/:id/split — 予約分割
     *
     * 統合予約を指定日で前半・後半の2つに分割する。
     * 注意: これは「元の予約に戻す（unmerge）」ではなく、
     * 「統合予約を任意の日付で2つに分割する」機能。
     */
    public function split(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];
        $staffId = $request->auth['staff_id'];
        $body = $request->body;
        $splitDate = $body['split_date'] ?? null;

        if (!$splitDate) {
            Response::error('split_date は必須です', 400);
        }

        // 楽観ロック
        $this->checkOptimisticLock($id, $body['updated_at'] ?? null);

        // 対象予約の取得
        $stmt = $db->prepare("SELECT * FROM reservations WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $reservation = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$reservation) {
            Response::error('予約が見つかりません', 404);
        }

        // 統合予約であることの確認（reservation_sources を持つか）
        $stmt = $db->prepare("SELECT COUNT(*) FROM reservation_sources WHERE reservation_id = :id");
        $stmt->execute(['id' => $id]);
        if ((int) $stmt->fetchColumn() === 0) {
            Response::error('この予約は統合予約ではないため分割できません', 422);
        }

        // split_date のバリデーション
        // CI日の翌日以降 かつ CO日の前日以前。
        // CO日ちょうどを許すと後半が0泊・0円の予約として生成されてしまう（検証報告 #2 で実証）
        $ciNext = date('Y-m-d', strtotime($reservation['checkin_date'] . ' +1 day'));
        $coPrev = date('Y-m-d', strtotime($reservation['checkout_date'] . ' -1 day'));
        if ($splitDate < $ciNext || $splitDate > $coPrev) {
            Response::error(
                "split_date は {$ciNext} 〜 {$coPrev} の範囲で指定してください（前半・後半とも1泊以上必要です）",
                422
            );
        }

        // ステータスチェック
        // CI済みの分割は禁止: アサイン削除で在室中の部屋情報・移動履歴が失われるため（検証報告 #3）
        if ($reservation['status'] !== 'confirmed') {
            Response::error("この予約は分割できません（ステータス: {$reservation['status']}）。分割できるのは「予約確定」のみです", 422);
        }

        // 分割日をまたぐ統合元（source）があれば拒否
        // またいだまま分割すると source の日程と予約の日程が矛盾し、後の統合解除が壊れるため（検証報告 #14）
        $spanStmt = $db->prepare("
            SELECT channel, reservation_no FROM reservation_sources
            WHERE reservation_id = :rid AND status = 'active'
              AND checkin_date < :sp1 AND checkout_date > :sp2
        ");
        $spanStmt->execute(['rid' => $id, 'sp1' => $splitDate, 'sp2' => $splitDate]);
        if ($span = $spanStmt->fetch(PDO::FETCH_ASSOC)) {
            Response::error(
                "分割日が統合元予約（{$span['channel']} {$span['reservation_no']}）の滞在期間の途中です。統合元の境界日で分割してください",
                422
            );
        }

        // 分割前の情報（ログ用）
        $beforeInfo = [
            'checkin_date'  => $reservation['checkin_date'],
            'checkout_date' => $reservation['checkout_date'],
            'nights'        => (int) $reservation['nights'],
            'amount'        => (int) $reservation['amount'],
        ];

        $db->beginTransaction();
        try {
            // 前半・後半の泊数（DateTime::diff — DST影響回避。検証報告 #16）
            $frontNights = (new \DateTime($reservation['checkin_date']))->diff(new \DateTime($splitDate))->days;
            $backNights = (new \DateTime($splitDate))->diff(new \DateTime($reservation['checkout_date']))->days;

            // 1. 後半用の新規予約レコードを作成
            // 統合予約は reservation_no=NULL なので、予約IDベースで識別子を生成
            $newResNo = ($reservation['reservation_no'] ?? $reservation['id']) . '-S';
            $db->prepare("
                INSERT INTO reservations (
                    guest_id, guest_match_status, channel, reservation_no, booked_at,
                    checkin_date, checkout_date, nights, room_type, amount,
                    adult_count, child_count, status,
                    tl_last_name, tl_first_name,
                    reservation_notes, updated_by
                ) VALUES (
                    :guest_id, :gms, :channel, :resno, :booked_at,
                    :ci, :co, :nights, :room_type, 0,
                    :adults, :children, :status,
                    :tl_ln, :tl_fn,
                    :notes, :staff_id
                )
            ")->execute([
                'guest_id'   => $reservation['guest_id'],
                'gms'        => $reservation['guest_match_status'],
                'channel'    => $reservation['channel'],
                'resno'      => $newResNo,
                'booked_at'  => $reservation['booked_at'],
                'ci'         => $splitDate,
                'co'         => $reservation['checkout_date'],
                'nights'     => $backNights,
                'room_type'  => $reservation['room_type'],
                'adults'     => (int) $reservation['adult_count'],
                'children'   => (int) $reservation['child_count'],
                'status'     => $reservation['status'],
                'tl_ln'      => $reservation['tl_last_name'],
                'tl_fn'      => $reservation['tl_first_name'],
                'notes'      => $reservation['reservation_notes'],
                'staff_id'   => $staffId,
            ]);
            $newReservationId = (int) $db->lastInsertId();

            // 2. 元予約を前半に短縮
            $db->prepare("
                UPDATE reservations SET
                    checkout_date = :co, nights = :nights,
                    updated_at = NOW(), updated_by = :staff_id
                WHERE id = :id
            ")->execute([
                'co'       => $splitDate,
                'nights'   => $frontNights,
                'staff_id' => $staffId,
                'id'       => $id,
            ]);

            // 3. charges を split_date で振り分け
            // split_date 以降の charges を後半予約に移す
            $db->prepare("
                UPDATE reservation_charges SET reservation_id = :new_id
                WHERE reservation_id = :old_id AND date >= :split_date
            ")->execute([
                'new_id'     => $newReservationId,
                'old_id'     => $id,
                'split_date' => $splitDate,
            ]);

            // 4. reservation_sources を振り分け
            // source の checkin_date >= split_date → 後半に移す
            $db->prepare("
                UPDATE reservation_sources SET reservation_id = :new_id
                WHERE reservation_id = :old_id AND checkin_date >= :split_date
            ")->execute([
                'new_id'     => $newReservationId,
                'old_id'     => $id,
                'split_date' => $splitDate,
            ]);

            // 5. 前半・後半の amount を再計算
            foreach ([$id, $newReservationId] as $resId) {
                $this->recalcAmountFromCharges($db, (int) $resId);
            }

            // 6. アサインがあれば解除（日程が変わるため。CI前限定なので物理削除可 — 規約 #13）
            // status='active' のみ削除し、released等の履歴レコードは残す
            $db->prepare("DELETE FROM room_assignments WHERE reservation_id = :id AND status = 'active'")
               ->execute(['id' => $id]);

            // 7. イベント記録
            $afterInfo = [
                'front' => [
                    'reservation_id' => $id,
                    'checkin_date'   => $reservation['checkin_date'],
                    'checkout_date'  => $splitDate,
                    'nights'         => $frontNights,
                ],
                'back' => [
                    'reservation_id' => $newReservationId,
                    'checkin_date'   => $splitDate,
                    'checkout_date'  => $reservation['checkout_date'],
                    'nights'         => $backNights,
                ],
            ];
            $db->prepare("
                INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, detail, staff_id)
                VALUES (:rid, 'split', NOW(), :summary, :detail, :staff_id)
            ")->execute([
                'rid'      => $id,
                'summary'  => "予約を {$splitDate} で分割",
                'detail'   => json_encode(['before' => $beforeInfo, 'after' => $afterInfo], JSON_UNESCAPED_UNICODE),
                'staff_id' => $staffId,
            ]);

            // 後半予約にもイベント記録
            $db->prepare("
                INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, detail, staff_id)
                VALUES (:rid, 'split', NOW(), :summary, :detail, :staff_id)
            ")->execute([
                'rid'      => $newReservationId,
                'summary'  => "予約ID={$id} からの分割により作成",
                'detail'   => json_encode(['split_from' => $id, 'split_date' => $splitDate], JSON_UNESCAPED_UNICODE),
                'staff_id' => $staffId,
            ]);

            // 8. 操作ログ
            $db->prepare("
                INSERT INTO staff_activity_logs (staff_id, action, target_type, target_id, detail)
                VALUES (:staff_id, 'split', 'reservation', :target_id, :detail)
            ")->execute([
                'staff_id'  => $staffId,
                'target_id' => $id,
                'detail'    => json_encode([
                    'split_date'          => $splitDate,
                    'new_reservation_id'  => $newReservationId,
                    'before'              => $beforeInfo,
                    'after'               => $afterInfo,
                ], JSON_UNESCAPED_UNICODE),
            ]);

            $db->commit();

        } catch (\Throwable $e) {
            $db->rollBack();
            Response::error('分割処理に失敗しました: ' . $e->getMessage(), 500);
        }

        Response::json([
            'message'              => '予約を分割しました',
            'front_reservation_id' => $id,
            'back_reservation_id'  => $newReservationId,
            'split_date'           => $splitDate,
        ]);
    }

    // ================================================================
    // 統合解除（特定のsourceを統合から外して独立予約に戻す）
    // ================================================================

    /**
     * 統合予約から指定した source を解除し、元の独立予約に復元する。
     * source が最後の1件（残り2件→1件になる場合）は統合自体を完全解除して
     * 親を通常予約に戻す。
     */
    public function unmergeSource(Request $request): void
    {
        $db = Database::getInstance();
        $parentId = (int) $request->params['id'];
        $staffId = $request->auth['staff_id'];
        $body = $request->body;
        $sourceId = (int) ($body['source_id'] ?? 0);

        if (!$sourceId) {
            Response::error('source_id は必須です', 400);
        }

        // 楽観ロック
        $this->checkOptimisticLock($parentId, $body['updated_at'] ?? null);

        // 親予約の取得
        $stmt = $db->prepare("SELECT * FROM reservations WHERE id = :id");
        $stmt->execute(['id' => $parentId]);
        $parent = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$parent) {
            Response::error('予約が見つかりません', 404);
        }

        // CI済み・CO済みの統合予約は解除不可（検証報告 #9）
        // 子を confirmed で復元すると消化済みの滞在と矛盾するため。必要な場合は明細を手動調整する運用とする
        if ($parent['status'] !== 'confirmed') {
            Response::error("この統合予約は解除できません（ステータス: {$parent['status']}）。解除できるのは「予約確定」のみです", 422);
        }

        // 対象 source の取得
        $stmt = $db->prepare("
            SELECT * FROM reservation_sources WHERE id = :sid AND reservation_id = :pid
        ");
        $stmt->execute(['sid' => $sourceId, 'pid' => $parentId]);
        $source = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$source) {
            Response::error('指定された統合元予約が見つかりません', 404);
        }

        // 全 sources を取得して残り件数を計算
        $stmt = $db->prepare("
            SELECT * FROM reservation_sources
            WHERE reservation_id = :pid AND status = 'active'
            ORDER BY checkin_date
        ");
        $stmt->execute(['pid' => $parentId]);
        $allSources = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        if (count($allSources) < 2) {
            Response::error('統合元予約が2件未満のため解除できません', 422);
        }

        $remainingSources = array_values(array_filter($allSources, fn($s) => (int) $s['id'] !== $sourceId));

        $db->beginTransaction();
        try {
            // 元の予約レコード（merged化された子）を復元
            $origId = $source['original_reservation_id'];
            if ($origId && $origId != $parentId) {
                $this->restoreChildFromSource($db, $source, $parentId, $parent['guest_id'], $staffId);
            }

            // source レコードを削除
            $db->prepare("DELETE FROM reservation_sources WHERE id = :sid")
               ->execute(['sid' => $sourceId]);

            // 残りsourcesの日程連続性をチェック
            // 中日を抜いて穴が開く場合は統合を維持できないので完全解除する
            $shouldFullUnmerge = false;
            if (count($remainingSources) >= 2) {
                for ($i = 0; $i < count($remainingSources) - 1; $i++) {
                    if ($remainingSources[$i]['checkout_date'] !== $remainingSources[$i + 1]['checkin_date']) {
                        $shouldFullUnmerge = true;
                        break;
                    }
                }
            }

            // 残り1件 or 日程が連続しなくなる → 統合を完全解除（全sourceを独立予約に戻す）
            if (count($remainingSources) === 1 || $shouldFullUnmerge) {
                // 残りの全sourceについて子予約を復元
                $parentSourceData = null; // 親自身のsource情報を記憶
                foreach ($remainingSources as $rs) {
                    $rsOrigId = $rs['original_reservation_id'];
                    if ($rsOrigId && $rsOrigId != $parentId) {
                        $this->restoreChildFromSource($db, $rs, $parentId, $parent['guest_id'], $staffId);
                    } else {
                        // 親自身のsource → 後で親の復元に使う
                        $parentSourceData = $rs;
                    }

                    // sourceレコードを削除
                    $db->prepare("DELETE FROM reservation_sources WHERE id = :sid")
                       ->execute(['sid' => (int) $rs['id']]);
                }

                // 親を通常予約に戻す（親自身のsource情報でOTA復元）
                if ($parentSourceData) {
                    $this->restoreParentFromSource($db, $parentSourceData, $parentId, $staffId);
                }

                // 親のアサインを削除（日程が変わるため再アサインが必要）
                // CI前のアサイン操作 — CLAUDE.md準拠: 物理削除
                $db->prepare("DELETE FROM room_assignments WHERE reservation_id = :rid AND status = 'active'")
                   ->execute(['rid' => $parentId]);
            } else {
                // まだ2件以上残る場合: 親の日程・金額を再計算
                $firstRemaining = $remainingSources[0];
                $lastRemaining = end($remainingSources);
                $newCi = $firstRemaining['checkin_date'];
                $newCo = $lastRemaining['checkout_date'];
                $newNights = (new \DateTime($newCi))->diff(new \DateTime($newCo))->days;

                // amount はこの後の共通再計算（recalcAmountFromCharges）で確定するためここでは触らない
                $db->prepare("
                    UPDATE reservations SET
                        checkin_date = :ci,
                        checkout_date = :co,
                        nights = :nights,
                        updated_at = NOW(),
                        updated_by = :staff_id
                    WHERE id = :id
                ")->execute([
                    'ci'       => $newCi,
                    'co'       => $newCo,
                    'nights'   => $newNights,
                    'staff_id' => $staffId,
                    'id'       => $parentId,
                ]);

                // 親のアサインも日程更新
                $db->prepare("
                    UPDATE room_assignments SET
                        check_in_date = :ci, check_out_date = :co
                    WHERE reservation_id = :rid AND status = 'active'
                ")->execute([
                    'ci'  => $newCi,
                    'co'  => $newCo,
                    'rid' => $parentId,
                ]);
            }

            // 親の amount を再計算（完全解除・部分解除どちらもここで確定する）
            $this->recalcAmountFromCharges($db, $parentId);

            // イベント記録
            $db->prepare("
                INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, detail, staff_id)
                VALUES (:rid, 'unmerge', NOW(), :summary, :detail, :staff_id)
            ")->execute([
                'rid'      => $parentId,
                'summary'  => "統合解除: {$source['reservation_no']}（{$source['channel']}）",
                'detail'   => json_encode([
                    'removed_source' => $source,
                    'remaining_count' => count($remainingSources),
                ], JSON_UNESCAPED_UNICODE),
                'staff_id' => $staffId,
            ]);

            // 操作ログ
            $db->prepare("
                INSERT INTO staff_activity_logs (staff_id, action, target_type, target_id, detail)
                VALUES (:staff_id, 'unmerge', 'reservation', :target_id, :detail)
            ")->execute([
                'staff_id'  => $staffId,
                'target_id' => $parentId,
                'detail'    => json_encode([
                    'source_id'       => $sourceId,
                    'reservation_no'  => $source['reservation_no'],
                    'channel'         => $source['channel'],
                ], JSON_UNESCAPED_UNICODE),
            ]);

            $db->commit();

        } catch (\Throwable $e) {
            $db->rollBack();
            Response::error('統合解除に失敗しました: ' . $e->getMessage(), 500);
        }

        Response::json([
            'message'          => '統合を解除しました',
            'remaining_sources' => count($remainingSources) <= 1 ? 0 : count($remainingSources),
        ]);
    }

    // ================================================================
    // merge_alert 承認（統合全解除 + 変更反映）
    // ================================================================

    /**
     * POST /api/v1/reservations/:id/resolve-merge-alert
     *
     * 統合予約に対するTL変更通知（merge_alert）を承認し、
     * 統合を全解除して各予約を独立に戻す。
     * 日程変更の場合は該当予約の日程・chargesも変更後の値に更新する。
     * 取消の場合は該当予約をcancelledにする。
     */
    public function resolveMergeAlert(Request $request): void
    {
        $db = Database::getInstance();
        $parentId = (int) $request->params['id'];
        $staffId = $request->auth['staff_id'];
        $body = $request->body;
        $eventId = (int) ($body['event_id'] ?? 0);

        if (!$eventId) {
            Response::error('event_id は必須です', 400);
        }

        // 楽観ロック
        $this->checkOptimisticLock($parentId, $body['updated_at'] ?? null);

        // 親予約の取得
        $stmt = $db->prepare("SELECT * FROM reservations WHERE id = :id");
        $stmt->execute(['id' => $parentId]);
        $parent = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$parent) {
            Response::error('予約が見つかりません', 404);
        }

        // CI済み・CO済みの統合予約は分解不可（検証報告 #9。unmergeSourceと同じガード）
        if ($parent['status'] !== 'confirmed') {
            Response::error("この統合予約は分解できません（ステータス: {$parent['status']}）。明細の調整は手動で行ってください", 422);
        }

        // 指定された merge_alert イベントの存在確認（操作の起点として必須）
        $stmt = $db->prepare("
            SELECT * FROM reservation_events
            WHERE id = :eid AND reservation_id = :rid AND event_type = 'merge_alert'
        ");
        $stmt->execute(['eid' => $eventId, 'rid' => $parentId]);
        $alertEvent = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$alertEvent) {
            Response::error('指定されたアラートが見つかりません', 404);
        }

        // 未処理アラートを全件取得して全て反映する（検証報告 #5）
        // 1件だけ反映すると、残りのアラート（別OTAのキャンセル等）が分解後に
        // pending表示の対象外となり、変更が静かに失われるため
        $stmt = $db->prepare("
            SELECT * FROM reservation_events
            WHERE reservation_id = :rid AND event_type = 'merge_alert'
              AND summary NOT LIKE '%対応済み%'
        ");
        $stmt->execute(['rid' => $parentId]);
        $pendingAlerts = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        // 全 sources を取得
        $stmt = $db->prepare("
            SELECT * FROM reservation_sources
            WHERE reservation_id = :pid AND status = 'active'
            ORDER BY checkin_date
        ");
        $stmt->execute(['pid' => $parentId]);
        $allSources = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        if (count($allSources) < 2) {
            Response::error('統合元予約が2件未満のため解除できません', 422);
        }

        $db->beginTransaction();
        try {
            // === 全解除処理（unmergeSourceの完全解除ロジックと同じ流れ）===

            $parentSourceData = null;
            $restoredReservations = []; // 復元された予約IDと対応するsource情報

            foreach ($allSources as $rs) {
                $rsOrigId = $rs['original_reservation_id'];

                if ($rsOrigId && $rsOrigId != $parentId) {
                    $this->restoreChildFromSource($db, $rs, $parentId, $parent['guest_id'], $staffId);
                    $restoredReservations[(int) $rsOrigId] = $rs;
                } else {
                    // 親自身のsource
                    $parentSourceData = $rs;
                }

                // sourceレコードを削除
                $db->prepare("DELETE FROM reservation_sources WHERE id = :sid")
                   ->execute(['sid' => (int) $rs['id']]);
            }

            // 親を通常予約に戻す
            if ($parentSourceData) {
                $this->restoreParentFromSource($db, $parentSourceData, $parentId, $staffId);
                $restoredReservations[$parentId] = $parentSourceData;
            }

            // 各予約のamountをchargesから再計算
            $allRestoredIds = array_keys($restoredReservations);
            if (!in_array($parentId, $allRestoredIds)) {
                $allRestoredIds[] = $parentId;
            }
            foreach ($allRestoredIds as $resId) {
                $this->recalcAmountFromCharges($db, (int) $resId);
            }

            // 親のアサインを物理削除（CI前のアサイン操作 — CLAUDE.md準拠）
            $db->prepare("DELETE FROM room_assignments WHERE reservation_id = :rid AND status = 'active'")
               ->execute(['rid' => $parentId]);

            // === 変更通知の反映（未処理アラート全件。検証報告 #5）===

            $appliedAlerts = [];
            foreach ($pendingAlerts as $pa) {
                $d = json_decode($pa['detail'], true) ?: [];
                $paType = $d['alert_type'] ?? '';
                $paChannel = $d['channel'] ?? '';
                $paResNo = $d['source_reservation_no'] ?? '';

                // 変更対象の予約を特定（channel + reservation_no でマッチ）
                $targetResId = null;
                foreach ($restoredReservations as $resId => $rs) {
                    if ($rs['channel'] === $paChannel && $rs['reservation_no'] === $paResNo) {
                        $targetResId = $resId;
                        break;
                    }
                }

                if ($targetResId && $paType === 'date_change') {
                    $afterCi = $d['after_ci'];
                    $afterCo = $d['after_co'];
                    $afterNights = (new \DateTime($afterCi))->diff(new \DateTime($afterCo))->days;

                    // 日程を変更後の値に更新
                    $db->prepare("
                        UPDATE reservations SET
                            checkin_date = :ci, checkout_date = :co, nights = :nights,
                            updated_at = NOW(), updated_by = :staff_id
                        WHERE id = :id
                    ")->execute([
                        'ci'       => $afterCi,
                        'co'       => $afterCo,
                        'nights'   => $afterNights,
                        'staff_id' => $staffId,
                        'id'       => $targetResId,
                    ]);

                    // 短縮された日のchargesを論理削除
                    // room以外（addon/discount等）も対象にする。入金・返金は実際のお金の記録なので触らない（検証報告 #8）
                    $db->prepare("
                        UPDATE reservation_charges SET status = 'cancelled'
                        WHERE reservation_id = :rid AND status = 'active'
                          AND charge_type NOT IN ('payment','refund')
                          AND date >= :after_co
                    ")->execute([
                        'rid'      => $targetResId,
                        'after_co' => $afterCo,
                    ]);

                    // amountを再計算
                    $this->recalcAmountFromCharges($db, (int) $targetResId);

                } elseif ($targetResId && $paType === 'cancellation') {
                    // 取消の場合
                    $db->prepare("
                        UPDATE reservations SET status = 'cancelled', updated_at = NOW(), updated_by = :staff_id
                        WHERE id = :id
                    ")->execute(['staff_id' => $staffId, 'id' => $targetResId]);

                    // アサインを物理削除（CI前のため）
                    $db->prepare("DELETE FROM room_assignments WHERE reservation_id = :rid")
                       ->execute(['rid' => $targetResId]);
                }

                // 処理済みマーク（pending_merge_alerts の算出が summary LIKE '%対応済み%' を除外するため）
                $db->prepare("
                    UPDATE reservation_events SET summary = CONCAT(summary, ' → 統合解除で対応済み')
                    WHERE id = :eid
                ")->execute(['eid' => (int) $pa['id']]);

                $appliedAlerts[] = ['event_id' => (int) $pa['id'], 'alert_type' => $paType, 'channel' => $paChannel, 'reservation_no' => $paResNo, 'applied_to' => $targetResId];
            }

            // === イベント記録 ===

            // 全解除イベント
            $db->prepare("
                INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, detail, staff_id)
                VALUES (:rid, 'merge_alert_resolved', NOW(), :summary, :detail, :staff_id)
            ")->execute([
                'rid'      => $parentId,
                'summary'  => 'TL変更通知により統合を全解除',
                'detail'   => json_encode([
                    'trigger_event_id' => $eventId,
                    'applied_alerts'   => $appliedAlerts,
                    'restored_ids'     => $allRestoredIds,
                ], JSON_UNESCAPED_UNICODE),
                'staff_id' => $staffId,
            ]);

            // 操作ログ
            $db->prepare("
                INSERT INTO staff_activity_logs (staff_id, action, target_type, target_id, detail)
                VALUES (:staff_id, 'resolve_merge_alert', 'reservation', :target_id, :detail)
            ")->execute([
                'staff_id'  => $staffId,
                'target_id' => $parentId,
                'detail'    => json_encode([
                    'trigger_event_id' => $eventId,
                    'applied_alerts'   => $appliedAlerts,
                    'restored_ids'     => $allRestoredIds,
                ], JSON_UNESCAPED_UNICODE),
            ]);

            $db->commit();

        } catch (\Throwable $e) {
            $db->rollBack();
            Response::error('統合解除に失敗しました: ' . $e->getMessage(), 500);
        }

        Response::json([
            'message'                => '統合を解除しました。変更内容を反映しました。',
            'resolved_reservations'  => $allRestoredIds,
        ]);
    }

    // ================================================================
    // 統合解除の共通処理
    // unmergeSource（単独解除・完全解除）と resolveMergeAlert で
    // 同じ「子予約復元・親予約復元・amount再計算」がコピペされていたため集約
    // ================================================================

    /**
     * 統合元(source)の情報から子予約を confirmed に復元し、
     * 統合時に親へ付け替えていた該当日程の売上明細を子に戻す
     */
    private function restoreChildFromSource(\PDO $db, array $source, int $parentId, ?int $guestId, int $staffId): void
    {
        $origId = (int) $source['original_reservation_id'];

        // 統合時に記録した元のguest_idを優先して復元（検証報告 #10）
        // original_guest_id が無い（カラム導入前の統合データ）場合は親のguest_idで復元する
        $restoreGuestId = !empty($source['original_guest_id']) ? (int) $source['original_guest_id'] : $guestId;

        // 子予約を confirmed に戻し、OTA情報を復元
        $db->prepare("
            UPDATE reservations SET
                status = 'confirmed',
                channel = :channel,
                reservation_no = :resno,
                checkin_date = :ci,
                checkout_date = :co,
                nights = :nights,
                amount = :amount,
                guest_id = :guest_id,
                updated_at = NOW(),
                updated_by = :staff_id
            WHERE id = :id
        ")->execute([
            'channel'  => $source['channel'],
            'resno'    => $source['reservation_no'],
            'ci'       => $source['checkin_date'],
            'co'       => $source['checkout_date'],
            'nights'   => (int) $source['nights'],
            'amount'   => (int) $source['amount'],
            'guest_id' => $restoreGuestId,
            'staff_id' => $staffId,
            'id'       => $origId,
        ]);

        // charges を子に戻す（検証報告 #1）
        // 統合時に記録した merged_from_reservation_id で正確に戻す（CO日当日の入金等も漏れなく戻る）。
        // カラム導入前の統合データには記録が無いため、従来の日付範囲でフォールバックする。
        // 戻した明細の merged_from はクリアし、再統合時に正しく上書きされるようにする
        $db->prepare("
            UPDATE reservation_charges
            SET reservation_id = :child_id, merged_from_reservation_id = NULL
            WHERE reservation_id = :parent_id
              AND (
                  merged_from_reservation_id = :from_id
                  OR (merged_from_reservation_id IS NULL AND date >= :ci AND date < :co)
              )
        ")->execute([
            'child_id'  => $origId,
            'from_id'   => $origId,
            'parent_id' => $parentId,
            'ci'        => $source['checkin_date'],
            'co'        => $source['checkout_date'],
        ]);
    }

    /**
     * 親予約を自身のsource情報（統合前のOTA情報）で通常予約に戻す
     * amount はここでは触らない（呼出側が recalcAmountFromCharges で確定する）
     */
    private function restoreParentFromSource(\PDO $db, array $source, int $parentId, int $staffId): void
    {
        $db->prepare("
            UPDATE reservations SET
                channel = :channel,
                reservation_no = :resno,
                checkin_date = :ci,
                checkout_date = :co,
                nights = :nights,
                updated_at = NOW(),
                updated_by = :staff_id
            WHERE id = :id
        ")->execute([
            'channel'  => $source['channel'],
            'resno'    => $source['reservation_no'],
            'ci'       => $source['checkin_date'],
            'co'       => $source['checkout_date'],
            'nights'   => (int) $source['nights'],
            'staff_id' => $staffId,
            'id'       => $parentId,
        ]);
    }

    /**
     * 予約の amount を active な売上明細（入金・返金は除く）の合計で再計算して保存する
     */
    private function recalcAmountFromCharges(\PDO $db, int $reservationId): int
    {
        $stmt = $db->prepare("
            SELECT COALESCE(SUM(amount), 0) FROM reservation_charges
            WHERE reservation_id = :rid AND status = 'active' AND charge_type NOT IN ('payment','refund')
        ");
        $stmt->execute(['rid' => $reservationId]);
        $total = (int) $stmt->fetchColumn();

        $db->prepare("UPDATE reservations SET amount = :amount WHERE id = :id")
           ->execute(['amount' => $total, 'id' => $reservationId]);

        return $total;
    }
}
