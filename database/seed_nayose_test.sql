-- 文字コード指定（latin1で二重エンコードされるのを防止）
SET NAMES utf8mb4;

-- =============================================================
-- 名寄せテスト用ダミーデータ
-- 過去宿泊済みリピーター（情報充実）+ 同一人物の新規予約（情報薄い）
-- 実行後、予約詳細の名寄せボタンでテスト可能
-- =============================================================

-- ============================================================
-- パターン1: 国内リピーター 山田太郎（住所・電話完備、3回宿泊済み）
-- ============================================================

-- 既存ゲスト（情報充実）
INSERT INTO guests (guest_code, name_kanji, name_kana, name_romaji,
  country_code, phone, mobile_phone, email, postal_code, prefecture, city, address_line,
  gender, birth_date, preferred_language, guest_notes, visit_count, first_stay_date, last_stay_date)
VALUES ('G90001', '山田太郎', 'ヤマダタロウ', 'YAMADA TARO',
  'JP', '03-1234-5678', '090-1111-2222', 'yamada.taro@example.com',
  '150-0001', '東京都', '渋谷区', '神宮前1-2-3',
  'male', '1985-06-15', 'ja', '毎年4月に来訪。低層階希望。禁煙。', 3, '2024-04-10', '2025-04-12');

SET @g_yamada = LAST_INSERT_ID();

-- 過去宿泊1回目（2024年4月）
INSERT INTO reservations (guest_id, guest_match_status, channel, reservation_no,
  checkin_date, checkout_date, nights, room_type, amount, adult_count, child_count,
  male_count, female_count, status, booked_at, actual_checkin_at, actual_checkout_at,
  tl_last_name, tl_first_name, tl_checkin_date, tl_checkout_date, tl_room_type, tl_data_id)
VALUES (@g_yamada, 'matched', 'jalan', 'TEST-YMD-001',
  '2024-04-10', '2024-04-13', 3, 'TW', 45000, 2, 0,
  1, 1, 'checked_out', '2024-03-20 10:00:00', '2024-04-10 15:30:00', '2024-04-13 10:00:00',
  'YAMADA TARO', '', '2024-04-10', '2024-04-13', 'TW', 'DUMMY-YMD-001');
SET @r_ymd1 = LAST_INSERT_ID();

INSERT INTO room_assignments (reservation_id, room_id, check_in_date, check_out_date, status)
VALUES (@r_ymd1, 7, '2024-04-10', '2024-04-13', 'released');

INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
VALUES (@r_ymd1, '2024-04-10', 'room', '宿泊料', 15000, 0, 0, 'active'),
       (@r_ymd1, '2024-04-11', 'room', '宿泊料', 15000, 0, 0, 'active'),
       (@r_ymd1, '2024-04-12', 'room', '宿泊料', 15000, 0, 0, 'active'),
       (@r_ymd1, '2024-04-10', 'payment', '現金', 45000, 0, 0, 'active');

INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, staff_id)
VALUES (@r_ymd1, 'checkin', '2024-04-10 15:30:00', 'チェックイン', 3),
       (@r_ymd1, 'checkout', '2024-04-13 10:00:00', 'チェックアウト', 3);

INSERT INTO revenue_postings (reservation_id, posting_date, channel, total_amount, status)
VALUES (@r_ymd1, '2024-04-13', 'jalan', 45000, 'posted');

-- 過去宿泊2回目（2024年10月）
INSERT INTO reservations (guest_id, guest_match_status, channel, reservation_no,
  checkin_date, checkout_date, nights, room_type, amount, adult_count, child_count,
  male_count, female_count, status, booked_at, actual_checkin_at, actual_checkout_at,
  tl_last_name, tl_first_name, tl_checkin_date, tl_checkout_date, tl_room_type, tl_data_id)
VALUES (@g_yamada, 'matched', 'rakuten', 'TEST-YMD-002',
  '2024-10-05', '2024-10-07', 2, 'TW', 32000, 2, 0,
  1, 1, 'checked_out', '2024-09-10 14:00:00', '2024-10-05 15:00:00', '2024-10-07 10:30:00',
  'ヤマダ タロウ', '', '2024-10-05', '2024-10-07', 'TW', 'DUMMY-YMD-002');
SET @r_ymd2 = LAST_INSERT_ID();

INSERT INTO room_assignments (reservation_id, room_id, check_in_date, check_out_date, status)
VALUES (@r_ymd2, 8, '2024-10-05', '2024-10-07', 'released');

INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
VALUES (@r_ymd2, '2024-10-05', 'room', '宿泊料', 16000, 0, 0, 'active'),
       (@r_ymd2, '2024-10-06', 'room', '宿泊料', 16000, 0, 0, 'active'),
       (@r_ymd2, '2024-10-05', 'payment', 'カード決済', 32000, 0, 0, 'active');

INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, staff_id)
VALUES (@r_ymd2, 'checkin', '2024-10-05 15:00:00', 'チェックイン', 3),
       (@r_ymd2, 'checkout', '2024-10-07 10:30:00', 'チェックアウト', 3);

INSERT INTO revenue_postings (reservation_id, posting_date, channel, total_amount, status)
VALUES (@r_ymd2, '2024-10-07', 'rakuten', 32000, 'posted');

-- 過去宿泊3回目（2025年4月）
INSERT INTO reservations (guest_id, guest_match_status, channel, reservation_no,
  checkin_date, checkout_date, nights, room_type, amount, adult_count, child_count,
  male_count, female_count, status, booked_at, actual_checkin_at, actual_checkout_at,
  tl_last_name, tl_first_name, tl_checkin_date, tl_checkout_date, tl_room_type, tl_data_id)
VALUES (@g_yamada, 'matched', 'jalan', 'TEST-YMD-003',
  '2025-04-08', '2025-04-12', 4, 'LR', 68000, 2, 1,
  1, 1, 'checked_out', '2025-03-01 09:00:00', '2025-04-08 14:45:00', '2025-04-12 11:00:00',
  'YAMADA TARO', '', '2025-04-08', '2025-04-12', 'LR', 'DUMMY-YMD-003');
SET @r_ymd3 = LAST_INSERT_ID();

INSERT INTO room_assignments (reservation_id, room_id, check_in_date, check_out_date, status)
VALUES (@r_ymd3, 3, '2025-04-08', '2025-04-12', 'released');

INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
VALUES (@r_ymd3, '2025-04-08', 'room', '宿泊料', 17000, 0, 0, 'active'),
       (@r_ymd3, '2025-04-09', 'room', '宿泊料', 17000, 0, 0, 'active'),
       (@r_ymd3, '2025-04-10', 'room', '宿泊料', 17000, 0, 0, 'active'),
       (@r_ymd3, '2025-04-11', 'room', '宿泊料', 17000, 0, 0, 'active'),
       (@r_ymd3, '2025-04-08', 'payment', '現金', 68000, 0, 0, 'active');

INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, staff_id)
VALUES (@r_ymd3, 'checkin', '2025-04-08 14:45:00', 'チェックイン', 3),
       (@r_ymd3, 'checkout', '2025-04-12 11:00:00', 'チェックアウト', 3);

INSERT INTO revenue_postings (reservation_id, posting_date, channel, total_amount, status)
VALUES (@r_ymd3, '2025-04-12', 'jalan', 68000, 'posted');

-- ★ 新規予約（今回TL取込で自動作成されたゲスト = 情報が薄い）
INSERT INTO guests (guest_code, name_romaji, country_code, preferred_language)
VALUES ('G90002', 'YAMADA TARO', 'JP', 'ja');
SET @g_yamada_new = LAST_INSERT_ID();

INSERT INTO reservations (guest_id, guest_match_status, channel, reservation_no,
  checkin_date, checkout_date, nights, room_type, amount, adult_count, child_count,
  male_count, female_count, status, booked_at,
  tl_last_name, tl_first_name, tl_checkin_date, tl_checkout_date, tl_room_type, tl_data_id)
VALUES (@g_yamada_new, 'new_guest', 'jalan', 'TEST-YMD-NEW',
  '2026-04-20', '2026-04-23', 3, 'TW', 48000, 2, 0,
  1, 1, 'confirmed', '2026-03-15 11:00:00',
  'YAMADA TARO', '', '2026-04-20', '2026-04-23', 'TW', 'DUMMY-YMD-NEW');
SET @r_ymd_new = LAST_INSERT_ID();

INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
VALUES (@r_ymd_new, '2026-04-20', 'room', '宿泊料', 16000, 0, 0, 'active'),
       (@r_ymd_new, '2026-04-21', 'room', '宿泊料', 16000, 0, 0, 'active'),
       (@r_ymd_new, '2026-04-22', 'room', '宿泊料', 16000, 0, 0, 'active');

INSERT INTO reservation_events (reservation_id, event_type, event_at, summary)
VALUES (@r_ymd_new, 'tl_new', '2026-03-15 11:00:00', 'TL新規予約');


-- ============================================================
-- パターン2: インバウンド Sophie Martin（フランス、2回宿泊済み）
-- ============================================================

INSERT INTO guests (guest_code, name_romaji, country_code, email, phone,
  preferred_language, guest_notes, visit_count, first_stay_date, last_stay_date,
  postal_code, prefecture, city)
VALUES ('G90003', 'Sophie Martin', 'FR', 'sophie.martin@gmail.com', '+33 6 12 34 56 78',
  'fr', 'Speaks English well. Prefers high floor. Allergic to shellfish.', 2, '2024-11-20', '2025-03-25',
  NULL, NULL, 'Paris');
SET @g_sophie = LAST_INSERT_ID();

-- 過去宿泊1回目
INSERT INTO reservations (guest_id, guest_match_status, channel, reservation_no,
  checkin_date, checkout_date, nights, room_type, amount, adult_count, child_count,
  male_count, female_count, status, booked_at, actual_checkin_at, actual_checkout_at,
  tl_last_name, tl_first_name, tl_checkin_date, tl_checkout_date, tl_room_type, tl_data_id)
VALUES (@g_sophie, 'matched', 'booking', 'TEST-SPH-001',
  '2024-11-20', '2024-11-25', 5, 'LR', 95000, 2, 0,
  0, 2, 'checked_out', '2024-09-15 08:30:00', '2024-11-20 16:00:00', '2024-11-25 09:30:00',
  'Sophie Martin', '', '2024-11-20', '2024-11-25', 'LR', 'DUMMY-SPH-001');
SET @r_sph1 = LAST_INSERT_ID();

INSERT INTO room_assignments (reservation_id, room_id, check_in_date, check_out_date, status)
VALUES (@r_sph1, 10, '2024-11-20', '2024-11-25', 'released');

INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
VALUES (@r_sph1, '2024-11-20', 'room', 'Standard Rate', 19000, 0, 0, 'active'),
       (@r_sph1, '2024-11-21', 'room', 'Standard Rate', 19000, 0, 0, 'active'),
       (@r_sph1, '2024-11-22', 'room', 'Standard Rate', 19000, 0, 0, 'active'),
       (@r_sph1, '2024-11-23', 'room', 'Standard Rate', 19000, 0, 0, 'active'),
       (@r_sph1, '2024-11-24', 'room', 'Standard Rate', 19000, 0, 0, 'active'),
       (@r_sph1, '2024-11-20', 'payment', 'OTA事前決済（Booking.com）', 95000, 0, 0, 'active');

INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, staff_id)
VALUES (@r_sph1, 'checkin', '2024-11-20 16:00:00', 'チェックイン', 3),
       (@r_sph1, 'checkout', '2024-11-25 09:30:00', 'チェックアウト', 3);

INSERT INTO revenue_postings (reservation_id, posting_date, channel, total_amount, status)
VALUES (@r_sph1, '2024-11-25', 'booking', 95000, 'posted');

-- 過去宿泊2回目
INSERT INTO reservations (guest_id, guest_match_status, channel, reservation_no,
  checkin_date, checkout_date, nights, room_type, amount, adult_count, child_count,
  male_count, female_count, status, booked_at, actual_checkin_at, actual_checkout_at,
  tl_last_name, tl_first_name, tl_checkin_date, tl_checkout_date, tl_room_type, tl_data_id)
VALUES (@g_sophie, 'matched', 'booking', 'TEST-SPH-002',
  '2025-03-22', '2025-03-25', 3, 'TW', 54000, 2, 0,
  1, 1, 'checked_out', '2025-01-10 12:00:00', '2025-03-22 15:30:00', '2025-03-25 10:00:00',
  'Sophie Martin', '', '2025-03-22', '2025-03-25', 'TW', 'DUMMY-SPH-002');
SET @r_sph2 = LAST_INSERT_ID();

INSERT INTO room_assignments (reservation_id, room_id, check_in_date, check_out_date, status)
VALUES (@r_sph2, 12, '2025-03-22', '2025-03-25', 'released');

INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
VALUES (@r_sph2, '2025-03-22', 'room', 'Standard Rate', 18000, 0, 0, 'active'),
       (@r_sph2, '2025-03-23', 'room', 'Standard Rate', 18000, 0, 0, 'active'),
       (@r_sph2, '2025-03-24', 'room', 'Standard Rate', 18000, 0, 0, 'active'),
       (@r_sph2, '2025-03-22', 'payment', 'OTA事前決済（Booking.com）', 54000, 0, 0, 'active');

INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, staff_id)
VALUES (@r_sph2, 'checkin', '2025-03-22 15:30:00', 'チェックイン', 3),
       (@r_sph2, 'checkout', '2025-03-25 10:00:00', 'チェックアウト', 3);

INSERT INTO revenue_postings (reservation_id, posting_date, channel, total_amount, status)
VALUES (@r_sph2, '2025-03-25', 'booking', 54000, 'posted');

-- ★ 新規予約（Booking取込で自動作成、メールが匿名化）
INSERT INTO guests (guest_code, name_romaji, country_code, email, preferred_language)
VALUES ('G90004', 'Sophie Martin', 'FR', 'smarti.924851@guest.booking.com', 'fr');
SET @g_sophie_new = LAST_INSERT_ID();

INSERT INTO reservations (guest_id, guest_match_status, channel, reservation_no,
  checkin_date, checkout_date, nights, room_type, amount, adult_count, child_count,
  male_count, female_count, status, booked_at,
  tl_last_name, tl_first_name, tl_checkin_date, tl_checkout_date, tl_room_type, tl_data_id)
VALUES (@g_sophie_new, 'new_guest', 'booking', 'TEST-SPH-NEW',
  '2026-04-25', '2026-04-30', 5, 'LR', 105000, 2, 0,
  0, 2, 'confirmed', '2026-02-20 09:00:00',
  'Sophie Martin', '', '2026-04-25', '2026-04-30', 'LR', 'DUMMY-SPH-NEW');
SET @r_sph_new = LAST_INSERT_ID();

INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
VALUES (@r_sph_new, '2026-04-25', 'room', 'Standard Rate', 21000, 0, 0, 'active'),
       (@r_sph_new, '2026-04-26', 'room', 'Standard Rate', 21000, 0, 0, 'active'),
       (@r_sph_new, '2026-04-27', 'room', 'Standard Rate', 21000, 0, 0, 'active'),
       (@r_sph_new, '2026-04-28', 'room', 'Standard Rate', 21000, 0, 0, 'active'),
       (@r_sph_new, '2026-04-29', 'room', 'Standard Rate', 21000, 0, 0, 'active'),
       (@r_sph_new, '2026-04-25', 'payment', 'OTA事前決済（Booking.com）', 105000, 0, 0, 'active');

INSERT INTO reservation_events (reservation_id, event_type, event_at, summary)
VALUES (@r_sph_new, 'tl_new', '2026-02-20 09:00:00', 'TL新規予約');


-- ============================================================
-- パターン3: VIPゲスト 佐藤健一（会社名・メモ・5回宿泊）
-- ============================================================

INSERT INTO guests (guest_code, name_kanji, name_kana, name_romaji,
  country_code, phone, mobile_phone, email, postal_code, prefecture, city, address_line,
  gender, birth_date, company_name, preferred_language, guest_notes,
  visit_count, first_stay_date, last_stay_date, is_vip)
VALUES ('G90005', '佐藤健一', 'サトウケンイチ', 'SATO KENICHI',
  'JP', '06-9876-5432', '080-3333-4444', 'k.sato@example-corp.co.jp',
  '530-0001', '大阪府', '大阪市北区', '梅田1-1-1 グランフロント20F',
  'male', '1972-03-20', '株式会社エグザンプル',
  'ja', '法人利用。朝食バイキングのアレルギー：卵・乳製品。最上階角部屋を好む。名刺交換済み。',
  5, '2023-06-10', '2025-12-20', 1);
SET @g_sato = LAST_INSERT_ID();

-- 過去宿泊（直近の1回だけ詳細に作る。残り4回はvisit_count=5で表現）
INSERT INTO reservations (guest_id, guest_match_status, channel, reservation_no,
  checkin_date, checkout_date, nights, room_type, amount, adult_count, child_count,
  male_count, female_count, status, booked_at, actual_checkin_at, actual_checkout_at,
  tl_last_name, tl_first_name, tl_checkin_date, tl_checkout_date, tl_room_type, tl_data_id)
VALUES (@g_sato, 'matched', 'jalan', 'TEST-STO-005',
  '2025-12-18', '2025-12-20', 2, 'LR', 42000, 1, 0,
  1, 0, 'checked_out', '2025-11-01 08:00:00', '2025-12-18 14:30:00', '2025-12-20 10:00:00',
  'ｻﾄｳ ｹﾝｲﾁ', '', '2025-12-18', '2025-12-20', 'LR', 'DUMMY-STO-005');
SET @r_sto5 = LAST_INSERT_ID();

INSERT INTO room_assignments (reservation_id, room_id, check_in_date, check_out_date, status)
VALUES (@r_sto5, 23, '2025-12-18', '2025-12-20', 'released');

INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
VALUES (@r_sto5, '2025-12-18', 'room', '宿泊料', 21000, 0, 0, 'active'),
       (@r_sto5, '2025-12-19', 'room', '宿泊料', 21000, 0, 0, 'active'),
       (@r_sto5, '2025-12-18', 'payment', '法人請求', 42000, 0, 0, 'active');

INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, staff_id)
VALUES (@r_sto5, 'checkin', '2025-12-18 14:30:00', 'チェックイン', 3),
       (@r_sto5, 'checkout', '2025-12-20 10:00:00', 'チェックアウト', 3);

INSERT INTO revenue_postings (reservation_id, posting_date, channel, total_amount, status)
VALUES (@r_sto5, '2025-12-20', 'jalan', 42000, 'posted');

-- ★ 新規予約（じゃらん取込、半角カナ名）
INSERT INTO guests (guest_code, name_romaji, country_code, preferred_language)
VALUES ('G90006', 'ｻﾄｳ ｹﾝｲﾁ', 'JP', 'ja');
SET @g_sato_new = LAST_INSERT_ID();

INSERT INTO reservations (guest_id, guest_match_status, channel, reservation_no,
  checkin_date, checkout_date, nights, room_type, amount, adult_count, child_count,
  male_count, female_count, status, booked_at,
  tl_last_name, tl_first_name, tl_checkin_date, tl_checkout_date, tl_room_type, tl_data_id)
VALUES (@g_sato_new, 'new_guest', 'jalan', 'TEST-STO-NEW',
  '2026-04-18', '2026-04-20', 2, 'LR', 44000, 1, 0,
  1, 0, 'confirmed', '2026-03-25 15:00:00',
  'ｻﾄｳ ｹﾝｲﾁ', '', '2026-04-18', '2026-04-20', 'LR', 'DUMMY-STO-NEW');
SET @r_sto_new = LAST_INSERT_ID();

INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
VALUES (@r_sto_new, '2026-04-18', 'room', '宿泊料', 22000, 0, 0, 'active'),
       (@r_sto_new, '2026-04-19', 'room', '宿泊料', 22000, 0, 0, 'active');

INSERT INTO reservation_events (reservation_id, event_type, event_at, summary)
VALUES (@r_sto_new, 'tl_new', '2026-03-25 15:00:00', 'TL新規予約');


-- ============================================================
-- パターン4: 鈴木美咲（Agodaリピーター、2回宿泊済み）
-- ============================================================

INSERT INTO guests (guest_code, name_kanji, name_kana, name_romaji,
  country_code, phone, email, postal_code, prefecture, city, address_line,
  gender, preferred_language, guest_notes, visit_count, first_stay_date, last_stay_date)
VALUES ('G90007', '鈴木美咲', 'スズキミサキ', 'SUZUKI MISAKI',
  'JP', '098-765-4321', 'misaki.s@example.jp',
  '900-0001', '沖縄県', '那覇市', '首里城町1-1',
  'female', 'ja', 'ダイビング目的の来訪が多い。チェックアウト時間を遅くしたい旨の要望あり。',
  2, '2025-01-10', '2025-08-15');
SET @g_suzuki = LAST_INSERT_ID();

-- 過去宿泊1回目
INSERT INTO reservations (guest_id, guest_match_status, channel, reservation_no,
  checkin_date, checkout_date, nights, room_type, amount, adult_count, child_count,
  male_count, female_count, status, booked_at, actual_checkin_at, actual_checkout_at,
  tl_last_name, tl_first_name, tl_checkin_date, tl_checkout_date, tl_room_type, tl_data_id)
VALUES (@g_suzuki, 'matched', 'agoda', 'TEST-SZK-001',
  '2025-01-10', '2025-01-13', 3, 'SW', 36000, 1, 0,
  0, 1, 'checked_out', '2024-12-01 14:00:00', '2025-01-10 15:00:00', '2025-01-13 11:30:00',
  'SUZUKI MISAKI', '', '2025-01-10', '2025-01-13', 'SW', 'DUMMY-SZK-001');
SET @r_szk1 = LAST_INSERT_ID();

INSERT INTO room_assignments (reservation_id, room_id, check_in_date, check_out_date, status)
VALUES (@r_szk1, 5, '2025-01-10', '2025-01-13', 'released');

INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
VALUES (@r_szk1, '2025-01-10', 'room', 'Breakfast', 12000, 0, 0, 'active'),
       (@r_szk1, '2025-01-11', 'room', 'Breakfast', 12000, 0, 0, 'active'),
       (@r_szk1, '2025-01-12', 'room', 'Breakfast', 12000, 0, 0, 'active'),
       (@r_szk1, '2025-01-10', 'payment', 'OTA事前決済（Agoda）', 36000, 0, 0, 'active');

INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, staff_id)
VALUES (@r_szk1, 'checkin', '2025-01-10 15:00:00', 'チェックイン', 3),
       (@r_szk1, 'checkout', '2025-01-13 11:30:00', 'チェックアウト', 3);

INSERT INTO revenue_postings (reservation_id, posting_date, channel, total_amount, status)
VALUES (@r_szk1, '2025-01-13', 'agoda', 36000, 'posted');

-- 過去宿泊2回目
INSERT INTO reservations (guest_id, guest_match_status, channel, reservation_no,
  checkin_date, checkout_date, nights, room_type, amount, adult_count, child_count,
  male_count, female_count, status, booked_at, actual_checkin_at, actual_checkout_at,
  tl_last_name, tl_first_name, tl_checkin_date, tl_checkout_date, tl_room_type, tl_data_id)
VALUES (@g_suzuki, 'matched', 'agoda', 'TEST-SZK-002',
  '2025-08-12', '2025-08-15', 3, 'TW', 51000, 2, 0,
  1, 1, 'checked_out', '2025-06-20 10:00:00', '2025-08-12 14:00:00', '2025-08-15 10:00:00',
  'SUZUKI MISAKI', '', '2025-08-12', '2025-08-15', 'TW', 'DUMMY-SZK-002');
SET @r_szk2 = LAST_INSERT_ID();

INSERT INTO room_assignments (reservation_id, room_id, check_in_date, check_out_date, status)
VALUES (@r_szk2, 14, '2025-08-12', '2025-08-15', 'released');

INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
VALUES (@r_szk2, '2025-08-12', 'room', 'Breakfast', 17000, 0, 0, 'active'),
       (@r_szk2, '2025-08-13', 'room', 'Breakfast', 17000, 0, 0, 'active'),
       (@r_szk2, '2025-08-14', 'room', 'Breakfast', 17000, 0, 0, 'active'),
       (@r_szk2, '2025-08-12', 'payment', 'OTA事前決済（Agoda）', 51000, 0, 0, 'active');

INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, staff_id)
VALUES (@r_szk2, 'checkin', '2025-08-12 14:00:00', 'チェックイン', 3),
       (@r_szk2, 'checkout', '2025-08-15 10:00:00', 'チェックアウト', 3);

INSERT INTO revenue_postings (reservation_id, posting_date, channel, total_amount, status)
VALUES (@r_szk2, '2025-08-15', 'agoda', 51000, 'posted');

-- ★ 新規予約（Agoda取込、ローマ字名のみ）
INSERT INTO guests (guest_code, name_romaji, country_code, preferred_language)
VALUES ('G90008', 'SUZUKI MISAKI', 'JP', 'ja');
SET @g_suzuki_new = LAST_INSERT_ID();

INSERT INTO reservations (guest_id, guest_match_status, channel, reservation_no,
  checkin_date, checkout_date, nights, room_type, amount, adult_count, child_count,
  male_count, female_count, status, booked_at,
  tl_last_name, tl_first_name, tl_checkin_date, tl_checkout_date, tl_room_type, tl_data_id)
VALUES (@g_suzuki_new, 'new_guest', 'agoda', 'TEST-SZK-NEW',
  '2026-04-22', '2026-04-25', 3, 'TW', 54000, 2, 0,
  1, 1, 'confirmed', '2026-03-10 16:00:00',
  'SUZUKI MISAKI', '', '2026-04-22', '2026-04-25', 'TW', 'DUMMY-SZK-NEW');
SET @r_szk_new = LAST_INSERT_ID();

INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
VALUES (@r_szk_new, '2026-04-22', 'room', 'Breakfast', 18000, 0, 0, 'active'),
       (@r_szk_new, '2026-04-23', 'room', 'Breakfast', 18000, 0, 0, 'active'),
       (@r_szk_new, '2026-04-24', 'room', 'Breakfast', 18000, 0, 0, 'active'),
       (@r_szk_new, '2026-04-22', 'payment', 'OTA事前決済（Agoda）', 54000, 0, 0, 'active');

INSERT INTO reservation_events (reservation_id, event_type, event_at, summary)
VALUES (@r_szk_new, 'tl_new', '2026-03-10 16:00:00', 'TL新規予約');


-- ============================================================
-- 確認用クエリ
-- ============================================================
SELECT '=== 名寄せテストデータ投入完了 ===' AS message;
SELECT g.guest_code, g.name_kanji, g.name_romaji, g.country_code, g.visit_count,
       g.phone, g.prefecture, g.is_vip,
       COUNT(r.id) AS reservations,
       SUM(CASE WHEN r.status = 'checked_out' THEN 1 ELSE 0 END) AS co_count
FROM guests g
LEFT JOIN reservations r ON r.guest_id = g.id
WHERE g.guest_code LIKE 'G900%'
GROUP BY g.id ORDER BY g.guest_code;
