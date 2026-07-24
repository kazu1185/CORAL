<?php
/**
 * ダミー予約シーダー（TL連携前のテストモード用）
 *
 * 目的: 本番でTL電文取込を開始する前に、動作確認・デモ用の予約を投入する。
 * 前提: 稼働可能室に対して稼働率≈90%。直近から20泊分（既定 2026-07-24〜08-12）。
 *
 * 【完全削除の担保】投入する全レコードに DMY マーカーを付ける:
 *   - reservations.reservation_no は 'DMY' で始まる
 *   - guests.guest_code は 'DMY' で始まる
 *   - reservation_notes = '【ダミー・TL連携前に削除】'
 *   → dummy_teardown.php がこのマーカーのみを物理削除する（本物のTLデータには一切触れない）。
 *
 * 【安全策】
 *   - 既にDMY予約があれば中断（二重投入防止）。teardownを先に実行すること。
 *   - 既存の有効アサインを読み込み、部屋の重複割当を絶対にしない（本物データがあっても安全）。
 *   - 宿泊税は accommodation_tax_rules を参照し、対象期間に有効な規則が無ければ 0（規約#26 室料は消費税額を持たない運用）。
 *   - トランザクションで囲み、失敗時は全ロールバック。
 *
 * 使い方（サーバー上）: cd /var/www/pms/backend && php scripts/dummy_seed.php
 */

// config.php はローカルではデフォルトDB定義、本番では config.local.php を取り込む共通入口
require __DIR__ . '/../config/config.php';

// ---- 設定 ----
const WINDOW_START = '2026-07-24';   // 直近＝本日から
const WINDOW_NIGHTS = 20;            // 20泊分
const TARGET_OCCUPANCY = 0.90;       // 稼働率90%
const NOTE = '【ダミー・TL連携前に削除】';

// 部屋タイプ別の1泊素泊まり単価（TL金額の代替。デモ用の妥当な値）
$RATE = ['SW' => 9000, 'STW' => 12000, 'TW' => 14000, 'LR' => 18000];

$pdo = new PDO(
    'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
    DB_USER, DB_PASS,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);

// 再現性のため乱数を固定シード（毎回同じ構成が出る）
mt_srand(20260724);

// ---- 日付ユーティリティ ----
$D = [];
for ($i = 0; $i < WINDOW_NIGHTS; $i++) $D[$i] = date('Y-m-d', strtotime(WINDOW_START . " +{$i} day"));
$WINDOW_END = date('Y-m-d', strtotime(WINDOW_START . ' +' . WINDOW_NIGHTS . ' day')); // 最終チェックアウト上限日
$TODAY = date('Y-m-d');
$addDays = fn($d, $n) => date('Y-m-d', strtotime("$d +{$n} day"));
$nightsBetween = fn($ci, $co) => (int) round((strtotime($co) - strtotime($ci)) / 86400);

// ---- 二重投入ガード ----
$dup = (int) $pdo->query("SELECT COUNT(*) FROM reservations WHERE reservation_no LIKE 'DMY%'")->fetchColumn();
if ($dup > 0) {
    fwrite(STDERR, "既にダミー予約が {$dup} 件存在します。先に scripts/dummy_teardown.php を実行してください。\n");
    exit(1);
}

// ---- マスタ読込 ----
$rooms = $pdo->query("
    SELECT r.id, r.room_number, r.room_type_id, rt.type_code, rt.max_adults, rt.max_occupancy
    FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
    WHERE r.status = 'available'
    ORDER BY r.room_number
")->fetchAll();
$roomById = [];
foreach ($rooms as $rm) $roomById[$rm['id']] = $rm;
$totalRooms = count($rooms);
if ($totalRooms === 0) { fwrite(STDERR, "稼働可能な部屋がありません。\n"); exit(1); }

// タイプ別の部屋IDリスト
$roomsByType = [];
foreach ($rooms as $rm) $roomsByType[$rm['type_code']][] = $rm['id'];

$plans = $pdo->query("SELECT id, plan_name, meal_type, breakfast_price, dinner_price FROM plans WHERE is_active = 1 ORDER BY id")->fetchAll();
$planById = [];
foreach ($plans as $p) $planById[$p['id']] = $p;

// 支払方法（front可の現金/カード＋OTA前払）
$pm = [];
foreach ($pdo->query("SELECT id, method_code FROM payment_methods")->fetchAll() as $m) $pm[$m['method_code']] = (int) $m['id'];
$PM_CASH = $pm['cash'] ?? null;
$PM_CARD = $pm['credit_card'] ?? null;
$OTA_PM = [ // channel → 前払OTA支払方法
    'jalan' => $pm['ota_jalan'] ?? null,
    'rakuten' => $pm['ota_rakuten'] ?? null,
    'booking' => $pm['ota_booking'] ?? null,
    'agoda' => $pm['ota_agoda'] ?? null,
];

// 宿泊税率（対象期間に有効な沖縄県=47の規則。対象期間は未施行 → 0のはず）
$taxRule = $pdo->query("
    SELECT rate FROM accommodation_tax_rules
    WHERE prefecture_code = '47' AND tax_type = 'rate'
      AND valid_from <= '" . $WINDOW_END . "' AND (valid_to IS NULL OR valid_to >= '" . WINDOW_START . "')
    ORDER BY valid_from DESC LIMIT 1
")->fetch();
$TAX_RATE = $taxRule ? (float) $taxRule['rate'] : 0.0; // 未施行なら0

// ---- 既存の有効アサインで占有カレンダーを初期化（重複割当を防ぐ）----
$occ = []; // $occ[room_id][date] = true
$exist = $pdo->query("
    SELECT room_id, check_in_date, check_out_date FROM room_assignments
    WHERE status = 'active' AND check_out_date > '" . WINDOW_START . "' AND check_in_date < '" . $WINDOW_END . "'
")->fetchAll();
foreach ($exist as $a) {
    for ($d = $a['check_in_date']; $d < $a['check_out_date']; $d = $addDays($d, 1)) {
        if ($d >= WINDOW_START && $d < $WINDOW_END) $occ[$a['room_id']][$d] = true;
    }
}
$isFree = function ($roomId, $ci, $co) use (&$occ) {
    for ($d = $ci; $d < $co; $d = date('Y-m-d', strtotime("$d +1 day"))) {
        if (!empty($occ[$roomId][$d])) return false;
    }
    return true;
};
$markOcc = function ($roomId, $ci, $co) use (&$occ) {
    for ($d = $ci; $d < $co; $d = date('Y-m-d', strtotime("$d +1 day"))) $occ[$roomId][$d] = true;
};

// ---- 名前プール ----
$jpSurnames = [['山田','ヤマダ'],['佐藤','サトウ'],['鈴木','スズキ'],['田中','タナカ'],['高橋','タカハシ'],['伊藤','イトウ'],['渡辺','ワタナベ'],['中村','ナカムラ'],['小林','コバヤシ'],['加藤','カトウ'],['吉田','ヨシダ'],['山本','ヤマモト'],['宮里','ミヤザト'],['金城','キンジョウ'],['比嘉','ヒガ']];
$jpGiven = [['大輔','ダイスケ'],['翔太','ショウタ'],['健一','ケンイチ'],['美咲','ミサキ'],['優子','ユウコ'],['直樹','ナオキ'],['彩','アヤ'],['拓也','タクヤ'],['麻衣','マイ'],['洋一','ヨウイチ'],['里奈','リナ'],['健二','ケンジ']];
$foreign = [ // [romaji, country_code]
    ['Chen Wei','CN'],['Kim Min-jun','KR'],['Emma Johnson','US'],['Luca Rossi','IT'],['Marie Dubois','FR'],['Oliver Smith','GB'],['Ananya Sharma','IN'],['Somchai P.','TH']];

$phones = fn() => '090-' . str_pad((string) mt_rand(1000, 9999), 4, '0', STR_PAD_LEFT) . '-' . str_pad((string) mt_rand(1000, 9999), 4, '0', STR_PAD_LEFT);

// ---- インサート用プリペア ----
$insGuest = $pdo->prepare("INSERT INTO guests (guest_code,name_kanji,name_kana,name_romaji,country_code,phone,gender,is_vip,guest_notes,status,visit_count) VALUES (:code,:kanji,:kana,:romaji,:cc,:phone,:gender,:vip,:notes,'active',:vc)");
$insRes = $pdo->prepare("INSERT INTO reservations
    (parent_reservation_id,room_count,room_index,guest_id,guest_match_status,channel,reservation_no,booked_at,checkin_date,checkout_date,nights,room_type,amount,adult_count,child_count,child_amount,plan_id,status,payment_method,tl_last_name,tl_first_name,reservation_notes,actual_checkin_at,actual_checkout_at)
    VALUES (:parent,:rcount,:ridx,:guest,:gms,:channel,:rno,:booked,:ci,:co,:nights,:rtype,:amount,:ad,:ch,:chamt,:plan,:status,:pm,:tll,:tlf,:notes,:aci,:aco)");
$insAssign = $pdo->prepare("INSERT INTO room_assignments (reservation_id,room_id,check_in_date,check_out_date,status) VALUES (:res,:room,:ci,:co,:st)");
$insCharge = $pdo->prepare("INSERT INTO reservation_charges (reservation_id,date,charge_type,description,amount,tax_amount,accommodation_tax,payment_method_id,status) VALUES (:res,:date,:ctype,:desc,:amt,:tax,:acc,:pmid,'active')");
$insLink = $pdo->prepare("INSERT INTO guest_links (group_id,reservation_id,sequence,status,gap_handling) VALUES (:gid,:res,:seq,:st,:gap)");

// ---- カウンタ ----
$guestSeq = 0; $resSeq = 0; $groupSeq = 0;
$created = ['reservations' => 0, 'children' => 0, 'guests' => 0, 'assignments' => 0, 'charges' => 0, 'links' => 0, 'specials' => []];

$mkGuest = function (array $o) use ($insGuest, &$guestSeq, &$created) {
    $guestSeq++;
    $code = 'DMY' . str_pad((string) $guestSeq, 3, '0', STR_PAD_LEFT);
    $insGuest->execute([
        'code' => $code,
        'kanji' => $o['kanji'] ?? null, 'kana' => $o['kana'] ?? null, 'romaji' => $o['romaji'] ?? null,
        'cc' => $o['cc'] ?? 'JP', 'phone' => $o['phone'] ?? null,
        'gender' => $o['gender'] ?? 'unknown', 'vip' => $o['vip'] ?? 0,
        'notes' => NOTE . ($o['vip'] ?? 0 ? ' / VIP' : ''), 'vc' => $o['vc'] ?? 0,
    ]);
    $created['guests']++;
    return (int) $GLOBALS['pdo']->lastInsertId();
};

// ランダムな和名/外国名ゲストを作る
$randomGuest = function ($foreignChance = 0.2, $vip = 0) use ($mkGuest, $jpSurnames, $jpGiven, $foreign, $phones) {
    if (mt_rand(1, 100) <= $foreignChance * 100) {
        $f = $foreign[array_rand($foreign)];
        return [$mkGuest(['romaji' => $f[0], 'cc' => $f[1], 'phone' => $phones(), 'vip' => $vip]), $f[0], $f[0]];
    }
    $s = $jpSurnames[array_rand($jpSurnames)];
    $g = $jpGiven[array_rand($jpGiven)];
    $id = $mkGuest(['kanji' => $s[0] . ' ' . $g[0], 'kana' => $s[1] . ' ' . $g[1], 'phone' => $phones(), 'gender' => mt_rand(0, 1) ? 'male' : 'female', 'vip' => $vip, 'vc' => mt_rand(0, 4)]);
    return [$id, $s[0], $g[0]]; // [guest_id, tl_last(姓), tl_first(名)]
};

/**
 * 予約1件を作成（明細・アサイン・入金まで）。
 * $a: guest_id, tll, tlf, channel, plan_id, adults, children, type_code,
 *     assignments=[[room_id,ci,co], ...], ci, co, status, parent, room_index, gms, unassigned
 */
$mkReservation = function (array $a) use (
    $insRes, $insAssign, $insCharge, &$resSeq, &$created, $RATE, $planById, $roomById,
    $TAX_RATE, $PM_CASH, $PM_CARD, $OTA_PM, $markOcc, $nightsBetween, $TODAY
) {
    $resSeq++;
    $rno = $a['reservation_no'] ?? ('DMY-' . str_pad((string) $resSeq, 5, '0', STR_PAD_LEFT));
    $ci = $a['ci']; $co = $a['co'];
    $nights = $nightsBetween($ci, $co);
    $plan = $planById[$a['plan_id']];
    $pax = $a['adults'] + $a['children'];
    $type = $a['type_code'];

    // 金額計算
    $roomNightly = $RATE[$type] ?? 12000;
    $mealPPN = ($plan['meal_type'] === 'breakfast' || $plan['meal_type'] === 'two_meals' ? (int) $plan['breakfast_price'] : 0)
             + ($plan['meal_type'] === 'dinner' || $plan['meal_type'] === 'two_meals' ? (int) $plan['dinner_price'] : 0);
    $roomTotal = $roomNightly * $nights;
    $mealTotal = $mealPPN * $pax * $nights;
    $childTotal = $a['children'] > 0 ? $a['children'] * 4000 * $nights : 0;
    $amount = $roomTotal + $mealTotal + $childTotal;

    // ステータス→実CI/CO時刻・入金
    $status = $a['status'];
    $aci = null; $aco = null; $resPm = null; $paid = false; $paidPmId = null;
    if ($status === 'checked_out') { $aci = $a['ci'] . ' 15:10:00'; $aco = $co . ' 10:30:00'; $paid = true; }
    elseif ($status === 'checked_in') { $aci = $a['ci'] . ' 15:20:00'; $paid = true; }
    if ($paid) {
        // OTA前払channelは前払、それ以外は現金/カード
        $paidPmId = $OTA_PM[$a['channel']] ?? (mt_rand(0, 1) ? $PM_CARD : $PM_CASH);
        $resPm = isset($OTA_PM[$a['channel']]) ? 'ota_prepaid' : (mt_rand(0, 1) ? 'card' : 'cash');
    }

    $insRes->execute([
        'parent' => $a['parent'] ?? null, 'rcount' => 1, 'ridx' => $a['room_index'] ?? null,
        'guest' => $a['guest_id'], 'gms' => $a['gms'] ?? 'matched',
        'channel' => $a['channel'], 'rno' => $rno,
        'booked' => date('Y-m-d H:i:s', strtotime($ci . ' -' . mt_rand(10, 60) . ' day')),
        'ci' => $ci, 'co' => $co, 'nights' => $nights, 'rtype' => $type, 'amount' => $amount,
        'ad' => $a['adults'], 'ch' => $a['children'], 'chamt' => $childTotal ?: null,
        'plan' => $a['plan_id'], 'status' => $status,
        'pm' => $resPm, 'tll' => $a['tll'], 'tlf' => $a['tlf'], 'notes' => NOTE,
        'aci' => $aci, 'aco' => $aco,
    ]);
    $resId = (int) $GLOBALS['pdo']->lastInsertId();
    $created['reservations']++;
    if (!empty($a['parent'])) $created['children']++;

    // アサイン
    foreach (($a['assignments'] ?? []) as $as) {
        $insAssign->execute(['res' => $resId, 'room' => $as[0], 'ci' => $as[1], 'co' => $as[2], 'st' => $as[3] ?? 'active']);
        if (($as[3] ?? 'active') === 'active') $markOcc($as[0], $as[1], $as[2]);
        $created['assignments']++;
    }

    // 明細: 室料（1泊1行）
    $acc = (int) floor($roomNightly * $TAX_RATE); // 対象期間は0
    for ($k = 0; $k < $nights; $k++) {
        $insCharge->execute(['res' => $resId, 'date' => date('Y-m-d', strtotime("$ci +$k day")), 'ctype' => 'room',
            'desc' => $plan['plan_name'], 'amt' => $roomNightly, 'tax' => 0, 'acc' => $acc, 'pmid' => null]);
        $created['charges']++;
    }
    // 食事addon
    if ($mealTotal > 0) {
        $insCharge->execute(['res' => $resId, 'date' => $ci, 'ctype' => 'addon', 'desc' => $plan['plan_name'] . '（食事）',
            'amt' => $mealTotal, 'tax' => 0, 'acc' => 0, 'pmid' => null]);
        $created['charges']++;
    }
    // 子供料金
    if ($childTotal > 0) {
        $insCharge->execute(['res' => $resId, 'date' => $ci, 'ctype' => 'addon', 'desc' => 'お子様料金',
            'amt' => $childTotal, 'tax' => 0, 'acc' => 0, 'pmid' => null]);
        $created['charges']++;
    }
    // no_show料金
    if ($status === 'no_show') {
        $insCharge->execute(['res' => $resId, 'date' => $ci, 'ctype' => 'no_show_fee', 'desc' => 'ノーショー料金',
            'amt' => $roomNightly, 'tax' => 0, 'acc' => 0, 'pmid' => null]);
        $created['charges']++;
    }
    // 入金（CI済/CO済）
    if ($paid) {
        $insCharge->execute(['res' => $resId, 'date' => ($status === 'checked_out' ? $co : $ci), 'ctype' => 'payment',
            'desc' => '入金', 'amt' => $amount, 'tax' => 0, 'acc' => 0, 'pmid' => $paidPmId]);
        $created['charges']++;
    }

    return $resId;
};

// ステータスを日付から決める（本日基準）
$statusFor = function ($ci, $co) use ($TODAY) {
    if ($co <= $TODAY) return 'checked_out';
    if ($ci <= $TODAY && $TODAY < $co) return 'checked_in';
    return 'confirmed';
};

$CHANNELS = ['jalan', 'rakuten', 'booking', 'agoda', 'direct', 'phone'];
$randType = function () use ($roomsByType) { $t = array_keys($roomsByType); return $t[array_rand($t)]; };

// 使う部屋を予約なしで確保する（specialsが特定室を使う）ヘルパ
$pickFreeRoomOfType = function ($type, $ci, $co) use ($roomsByType, $isFree) {
    foreach ($roomsByType[$type] ?? [] as $rid) if ($isFree($rid, $ci, $co)) return $rid;
    return null;
};

$pdo->beginTransaction();
try {
    // =========================================================
    // 特殊事例（specials）を先に配置
    // =========================================================

    // (1) グループ予約A: 3室・同一代表ゲスト・直販・7/26-7/29(3泊)
    $gAci = $D[2]; $gAco = $addDays($D[2], 3);
    $gaRooms = [];
    // ピックした室は即 markOcc して次のピックが同じ室を返さないようにする（重複割当防止）
    foreach (['STW', 'STW', 'STW'] as $t) { $r = $pickFreeRoomOfType($t, $gAci, $gAco); if ($r) { $gaRooms[] = $r; $markOcc($r, $gAci, $gAco); } }
    if (count($gaRooms) === 3) {
        [$gid, $gl, $gf] = $randomGuest(0.0, 1); // VIP代表
        $groupSeq++;
        $parentRno = 'DMY-GA' . $groupSeq;
        // group_parent（管理レコード・room_type NULL・アサインなし）
        $GLOBALS['pdo']->prepare("INSERT INTO reservations (room_count,room_index,guest_id,guest_match_status,channel,reservation_no,booked_at,checkin_date,checkout_date,nights,room_type,amount,adult_count,child_count,plan_id,status,tl_last_name,tl_first_name,reservation_notes) VALUES (3,NULL,:g,'matched','direct',:rno,:bk,:ci,:co,3,NULL,0,6,0,1,'group_parent',:tll,:tlf,:notes)")
            ->execute(['g' => $gid, 'rno' => $parentRno, 'bk' => date('Y-m-d H:i:s', strtotime($gAci . ' -30 day')), 'ci' => $gAci, 'co' => $gAco, 'tll' => $gl, 'tlf' => $gf, 'notes' => NOTE]);
        $parentId = (int) $GLOBALS['pdo']->lastInsertId(); $created['reservations']++;
        $groupUuid = 'DMYG-A' . $groupSeq;
        $idx = 0;
        foreach ($gaRooms as $rid) {
            $idx++;
            $st = $statusFor($gAci, $gAco);
            $cid = $mkReservation(['guest_id' => $gid, 'tll' => $gl, 'tlf' => $gf, 'channel' => 'direct', 'plan_id' => 3,
                'adults' => 2, 'children' => 0, 'type_code' => $roomById[$rid]['type_code'], 'ci' => $gAci, 'co' => $gAco,
                'status' => $st, 'parent' => $parentId, 'room_index' => $idx, 'reservation_no' => $parentRno . '-' . $idx,
                'assignments' => [[$rid, $gAci, $gAco]]]);
            $insLink->execute(['gid' => $groupUuid, 'res' => $cid, 'seq' => $idx, 'st' => 'active', 'gap' => null]);
            $created['links']++;
        }
        $created['specials'][] = "グループA(3室) parent#$parentId {$gAci}〜{$gAco}";
    }

    // (2) グループ予約B: 2室・Booking・8/01-8/04(3泊)
    $gBci = $D[8]; $gBco = $addDays($D[8], 3);
    $gbRooms = [];
    foreach (['LR', 'STW'] as $t) { $r = $pickFreeRoomOfType($t, $gBci, $gBco); if ($r) { $gbRooms[] = $r; $markOcc($r, $gBci, $gBco); } }
    if (count($gbRooms) === 2) {
        [$gid, $gl, $gf] = $randomGuest(1.0, 0); // 外国籍代表
        $groupSeq++;
        $parentRno = 'DMY-GB' . $groupSeq;
        $GLOBALS['pdo']->prepare("INSERT INTO reservations (room_count,guest_id,guest_match_status,channel,reservation_no,booked_at,checkin_date,checkout_date,nights,room_type,amount,adult_count,child_count,plan_id,status,tl_last_name,tl_first_name,reservation_notes) VALUES (2,:g,'matched','booking',:rno,:bk,:ci,:co,3,NULL,0,4,0,2,'group_parent',:tll,:tlf,:notes)")
            ->execute(['g' => $gid, 'rno' => $parentRno, 'bk' => date('Y-m-d H:i:s', strtotime($gBci . ' -25 day')), 'ci' => $gBci, 'co' => $gBco, 'tll' => $gl, 'tlf' => $gf, 'notes' => NOTE]);
        $parentId = (int) $GLOBALS['pdo']->lastInsertId(); $created['reservations']++;
        $groupUuid = 'DMYG-B' . $groupSeq; $idx = 0;
        foreach ($gbRooms as $rid) {
            $idx++;
            $cid = $mkReservation(['guest_id' => $gid, 'tll' => $gl, 'tlf' => $gf, 'channel' => 'booking', 'plan_id' => 2,
                'adults' => 2, 'children' => $idx === 1 ? 1 : 0, 'type_code' => $roomById[$rid]['type_code'], 'ci' => $gBci, 'co' => $gBco,
                'status' => $statusFor($gBci, $gBco), 'parent' => $parentId, 'room_index' => $idx, 'reservation_no' => $parentRno . '-' . $idx,
                'assignments' => [[$rid, $gBci, $gBco]]]);
            $insLink->execute(['gid' => $groupUuid, 'res' => $cid, 'seq' => $idx, 'st' => 'active', 'gap' => null]);
            $created['links']++;
        }
        $created['specials'][] = "グループB(2室・外国籍・子供1) parent#$parentId {$gBci}〜{$gBco}";
    }

    // (3) 飛び泊（gap）: 同一ゲスト・同一室・7/25-7/27(2泊) → 中1泊あけて 7/28-7/30(2泊)。gap中も部屋hold
    $tobiRoom = $pickFreeRoomOfType('TW', $D[1], $addDays($D[1], 5)) ?? $pickFreeRoomOfType('STW', $D[1], $addDays($D[1], 5));
    if ($tobiRoom) {
        [$tgid, $tl, $tf] = $randomGuest(0.0, 0);
        $res1ci = $D[1]; $res1co = $addDays($D[1], 2);        // 7/25,7/26 泊
        $gapNight = $res1co;                                 // 7/27 = 穴（部屋hold）
        $res2ci = $addDays($D[1], 3); $res2co = $addDays($D[1], 5); // 7/28,7/29 泊
        $groupSeq++; $guuid = 'DMYG-T' . $groupSeq;
        // アサイン期間は必ず予約期間と一致させる（7/25-7/27）。
        // 実システムはアサイン期間=予約期間でしか生成せず、穴の夜まで伸ばすと
        // アサインボードの泊数表示（アサイン起点で計算）と予約詳細（2泊）が食い違い、
        // バーが見た目連続になって統合を誘発する（2026-07-25 実際に発生）。
        // 穴の夜の「部屋ブロック」(gap_handling=room_blocked) はスキーマのみの将来機能なので、
        // DBにはアサインを作らず、シーダー内の占有カレンダーだけ塞いで他予約の混入を防ぐ。
        $r1 = $mkReservation(['guest_id' => $tgid, 'tll' => $tl, 'tlf' => $tf, 'channel' => 'rakuten', 'plan_id' => 1,
            'adults' => 2, 'children' => 0, 'type_code' => $roomById[$tobiRoom]['type_code'], 'ci' => $res1ci, 'co' => $res1co,
            'status' => $statusFor($res1ci, $res1co), 'reservation_no' => 'DMY-TOBI' . $groupSeq . 'a',
            'assignments' => [[$tobiRoom, $res1ci, $res1co, 'active']]]);
        $markOcc($tobiRoom, $gapNight, $res2ci); // 穴の夜(7/27)は空室のまま一般予約を入れない
        $r2 = $mkReservation(['guest_id' => $tgid, 'tll' => $tl, 'tlf' => $tf, 'channel' => 'rakuten', 'plan_id' => 1,
            'adults' => 2, 'children' => 0, 'type_code' => $roomById[$tobiRoom]['type_code'], 'ci' => $res2ci, 'co' => $res2co,
            'status' => $statusFor($res2ci, $res2co), 'reservation_no' => 'DMY-TOBI' . $groupSeq . 'b',
            'assignments' => [[$tobiRoom, $res2ci, $res2co, 'active']]]);
        $insLink->execute(['gid' => $guuid, 'res' => $r1, 'seq' => 1, 'st' => 'active', 'gap' => null]); $created['links']++;
        // gap行: 穴の後半予約に status='gap' を付ける（room_blocked）
        $insLink->execute(['gid' => $guuid, 'res' => $r2, 'seq' => 2, 'st' => 'gap', 'gap' => 'room_blocked']); $created['links']++;
        $created['specials'][] = "飛び泊 room#{$tobiRoom} 予約#{$r1}(7/25-27)+穴7/27+予約#{$r2}(7/28-30)";
    }

    // (4) 途中部屋移動: 1予約 7/27-7/31(4泊)、roomA(2泊)→roomB(2泊)
    $mvA = $pickFreeRoomOfType('STW', $D[3], $addDays($D[3], 2));
    // mvA を移動全期間で仮占有 → mvB が必ず別室になる（同一室が両窓で空くケースの取りこぼし防止）
    if ($mvA) $markOcc($mvA, $D[3], $addDays($D[3], 4));
    $mvB = $pickFreeRoomOfType('STW', $addDays($D[3], 2), $addDays($D[3], 4));
    if ($mvA && $mvB && $mvA !== $mvB) {
        [$mgid, $ml, $mf] = $randomGuest(0.1, 0);
        $mci = $D[3]; $mmid = $addDays($D[3], 2); $mco = $addDays($D[3], 4);
        $rid = $mkReservation(['guest_id' => $mgid, 'tll' => $ml, 'tlf' => $mf, 'channel' => 'jalan', 'plan_id' => 2,
            'adults' => 2, 'children' => 0, 'type_code' => $roomById[$mvA]['type_code'], 'ci' => $mci, 'co' => $mco,
            'status' => $statusFor($mci, $mco), 'reservation_no' => 'DMY-MOVE' . $resSeq,
            'assignments' => [[$mvA, $mci, $mmid, 'active'], [$mvB, $mmid, $mco, 'active']]]);
        $created['specials'][] = "途中部屋移動 予約#{$rid} room#{$mvA}→room#{$mvB} {$mci}〜{$mco}";
    }

    // (5) ノーショー: 本日CI予定・no_show・アサイン解放（部屋は空く）
    $nsType = 'STW'; $nsci = $D[0]; $nsco = $addDays($D[0], 1);
    [$ngid, $nl, $nf] = $randomGuest(0.0, 0);
    $nsId = $mkReservation(['guest_id' => $ngid, 'tll' => $nl, 'tlf' => $nf, 'channel' => 'agoda', 'plan_id' => 1,
        'adults' => 1, 'children' => 0, 'type_code' => $nsType, 'ci' => $nsci, 'co' => $nsco,
        'status' => 'no_show', 'reservation_no' => 'DMY-NOSHOW' . $resSeq, 'assignments' => []]);
    $created['specials'][] = "ノーショー 予約#{$nsId} {$nsci}";

    // (6) 未アサイン確定（⚠表示用）: 明日CI・部屋未割当・guest_match pending
    $unci = $D[1]; $unco = $addDays($D[1], 2);
    [$ugid, $ul, $uf] = $randomGuest(0.3, 0);
    $unId = $mkReservation(['guest_id' => $ugid, 'tll' => $ul, 'tlf' => $uf, 'channel' => 'booking', 'plan_id' => 2,
        'adults' => 2, 'children' => 0, 'type_code' => 'STW', 'ci' => $unci, 'co' => $unco,
        'status' => 'confirmed', 'gms' => 'pending', 'reservation_no' => 'DMY-UNASSIGN' . $resSeq, 'assignments' => []]);
    $created['specials'][] = "未アサイン確定(pending) 予約#{$unId} {$unci}";

    // =========================================================
    // (7) 一般予約で稼働率90%まで各室を埋める
    //     各室を窓内でランダム長（1〜4泊）の滞在で敷き詰め、約10%の確率で1泊の空室を挟む。
    //     一部の室は窓開始前(7/21〜)からの持ち越し（=本日CI済/在室）にして現実味を出す。
    // =========================================================
    foreach ($rooms as $rm) {
        $rid = $rm['id']; $type = $rm['type_code'];
        // 開始カーソル: 88%の室は窓開始日以前IN（初日から在室＝持ち越し）にして初日から稼働率を出す。
        // 残り12%は1日遅れてIN。
        $carryOver = (mt_rand(1, 100) <= 88);
        $startOffset = $carryOver ? -mt_rand(0, 3) : 1;
        $cursor = $addDays(WINDOW_START, $startOffset);
        $firstStay = true;
        while ($cursor < $WINDOW_END) {
            // 約16%の確率で1〜2泊の空室を挟み、全体を稼働率≈90%に寄せる。
            // ただし持ち越し室(offset<=0)の初回滞在前には空室を入れない（初日稼働率を確保）。
            if (!($firstStay && $startOffset <= 0) && mt_rand(1, 100) <= 16) {
                $cursor = $addDays($cursor, mt_rand(1, 2)); $firstStay = false; continue;
            }
            $isFirst = $firstStay; $firstStay = false;
            $len = mt_rand(1, 4);
            // 持ち越し室の初回滞在は窓開始日を必ず跨ぐ長さにする（初日に空室を作らない）
            if ($isFirst && $startOffset < 0) {
                $minLen = -$startOffset + 1;
                if ($len < $minLen) $len = $minLen + mt_rand(0, 2);
            }
            $co = $addDays($cursor, $len);
            if ($co > $addDays($WINDOW_END, 3)) $co = $addDays($WINDOW_END, 3); // 窓を少し超える程度は許容
            // 既存/special占有と衝突する分は短縮
            while ($len > 0 && !$isFree($rid, $cursor, $co)) { $len--; $co = $addDays($cursor, $len); }
            if ($len <= 0) { $cursor = $addDays($cursor, 1); continue; }

            $ci = $cursor;
            $status = $statusFor($ci, $co);
            $channel = $CHANNELS[array_rand($CHANNELS)];
            $plan = $plans[array_rand($plans)]['id'];
            $maxAd = (int) $rm['max_adults']; $maxOcc = (int) $rm['max_occupancy'];
            $adults = mt_rand(1, max(1, $maxAd));
            $children = ($type === 'LR' && mt_rand(0, 1)) ? mt_rand(1, max(1, $maxOcc - $adults)) : 0;
            [$gid, $gl, $gf] = $randomGuest(0.2, mt_rand(1, 100) <= 5 ? 1 : 0);
            $gms = (mt_rand(1, 100) <= 8) ? 'pending' : 'matched';
            $mkReservation(['guest_id' => $gid, 'tll' => $gl, 'tlf' => $gf, 'channel' => $channel, 'plan_id' => $plan,
                'adults' => $adults, 'children' => $children, 'type_code' => $type, 'ci' => $ci, 'co' => $co,
                'status' => $status, 'gms' => $gms, 'assignments' => [[$rid, $ci, $co]]]);
            $cursor = $co;
        }
    }

    $pdo->commit();
} catch (\Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "エラーによりロールバックしました: " . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n");
    exit(1);
}

// ---- 稼働率レポート ----
$occCount = [];
foreach ($occ as $roomId => $days) {
    if (!isset($roomById[$roomId])) continue; // 窓外/対象外
    foreach ($days as $d => $v) if ($v && $d >= WINDOW_START && $d < $WINDOW_END) $occCount[$d] = ($occCount[$d] ?? 0) + 1;
}
echo "=== ダミー投入 完了 ===\n";
echo "期間: " . WINDOW_START . " 〜 {$WINDOW_END}（{$totalRooms}室・目標稼働率" . (int) (TARGET_OCCUPANCY * 100) . "%）\n";
echo "作成: 予約 {$created['reservations']}件（うち子予約 {$created['children']}）/ ゲスト {$created['guests']} / アサイン {$created['assignments']} / 明細 {$created['charges']} / 連結 {$created['links']}\n";
echo "--- 特殊事例 ---\n";
foreach ($created['specials'] as $s) echo "  ・{$s}\n";
echo "--- 夜別稼働率 ---\n";
$sum = 0; $n = 0;
foreach ($D as $d) {
    $c = $occCount[$d] ?? 0; $rate = round($c / $totalRooms * 100);
    $sum += $c; $n++;
    echo "  {$d}: {$c}/{$totalRooms} ({$rate}%)\n";
}
echo "平均稼働率: " . round($sum / $n / $totalRooms * 100, 1) . "%\n";
