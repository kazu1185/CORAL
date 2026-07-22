-- ===========================================
-- PMS テストデータ (seed.sql)
-- 生成日: 2026-04-10
-- 対象DB: pms_db
-- 実行: mysql -u pms_user -p pms_db < database/seed.sql
-- ===========================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET @now = '2026-04-10 10:00:00';

-- ============================================================
-- 0. TRUNCATE（冪等性確保）
-- ============================================================
TRUNCATE TABLE reservation_passports;
TRUNCATE TABLE reservation_events;
TRUNCATE TABLE document_items;
TRUNCATE TABLE documents;
TRUNCATE TABLE revenue_postings;
TRUNCATE TABLE guest_links;
TRUNCATE TABLE reservation_charges;
TRUNCATE TABLE room_assignments;
TRUNCATE TABLE reservations;
TRUNCATE TABLE guest_aliases;
TRUNCATE TABLE guest_merge_logs;
TRUNCATE TABLE guests;
TRUNCATE TABLE housekeeping_status;
TRUNCATE TABLE tl_import_logs;
TRUNCATE TABLE staff_activity_logs;
TRUNCATE TABLE staff_sessions;
TRUNCATE TABLE device_tokens;
TRUNCATE TABLE role_permissions;
TRUNCATE TABLE permissions;
TRUNCATE TABLE staff;
TRUNCATE TABLE accommodation_tax_flat_brackets;
TRUNCATE TABLE accommodation_tax_rules;
TRUNCATE TABLE plans;
TRUNCATE TABLE rooms;
TRUNCATE TABLE room_types;
TRUNCATE TABLE corporate_clients;
TRUNCATE TABLE payment_methods;
TRUNCATE TABLE system_settings;
TRUNCATE TABLE hotel_settings;

-- ============================================================
-- 1. ALTER TABLE（不足カラム追加 — MySQL 8.4互換）
-- ============================================================

-- staff: ログインロック用
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='staff' AND COLUMN_NAME='login_fail_count');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE staff ADD COLUMN login_fail_count INT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='staff' AND COLUMN_NAME='last_login_fail_at');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE staff ADD COLUMN last_login_fail_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- rooms: 清掃ステータス
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='rooms' AND COLUMN_NAME='housekeeping_status');
SET @sql = IF(@col_exists = 0, "ALTER TABLE rooms ADD COLUMN housekeeping_status ENUM('clean','cleaning','inspecting','dirty') NOT NULL DEFAULT 'clean'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- payment_methods: カテゴリ・領収書アラート
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='payment_methods' AND COLUMN_NAME='category');
SET @sql = IF(@col_exists = 0, "ALTER TABLE payment_methods ADD COLUMN category VARCHAR(20) NOT NULL DEFAULT 'direct'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='payment_methods' AND COLUMN_NAME='receipt_alert');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE payment_methods ADD COLUMN receipt_alert TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- 2. マスタデータ
-- ============================================================

-- ホテル基本情報
INSERT INTO hotel_settings (hotel_name, hotel_name_en, postal_code, address, phone, invoice_registration_no) VALUES
('PATINA HOTEL OKINAWA', 'PATINA HOTEL OKINAWA', '900-0001', '沖縄県那覇市港町1-2-3', '098-123-4567', 'T1234567890123');

-- 部屋タイプ（料金は別途料金マスタで管理）
INSERT INTO room_types (id, type_code, type_name, max_adults, max_occupancy, sort_order, is_active) VALUES
(1, 'SW',  'セミダブル',     2, 3, 1, 1),
(2, 'STW', 'レギュラー',     2, 4, 2, 1),
(3, 'TW',  'ツイン',         2, 4, 3, 1),
(4, 'LR',  'ラージツイン',   3, 6, 4, 1);

-- 部屋（23室: 2F=5室, 3F=9室, 4F=9室）
INSERT INTO rooms (id, room_number, floor, room_type_id, status, sort_order) VALUES
-- 2F
( 1, '202', 2, 2, 'available', 1),
( 2, '205', 2, 2, 'available', 2),
( 3, '206', 2, 4, 'available', 3),
( 4, '208', 2, 2, 'available', 4),
( 5, '210', 2, 1, 'available', 5),
-- 3F
( 6, '301', 3, 2, 'available', 1),
( 7, '302', 3, 3, 'available', 2),
( 8, '303', 3, 2, 'available', 3),
( 9, '305', 3, 2, 'available', 4),
(10, '306', 3, 4, 'available', 5),
(11, '307', 3, 2, 'available', 6),
(12, '308', 3, 3, 'available', 7),
(13, '309', 3, 2, 'available', 8),
(14, '310', 3, 3, 'available', 9),
-- 4F
(15, '401', 4, 2, 'available', 1),
(16, '402', 4, 2, 'available', 2),
(17, '403', 4, 2, 'available', 3),
(18, '405', 4, 2, 'available', 4),
(19, '406', 4, 4, 'available', 5),
(20, '407', 4, 2, 'available', 6),
(21, '408', 4, 2, 'available', 7),
(22, '409', 4, 2, 'available', 8),
(23, '410', 4, 2, 'available', 9);

-- プラン
INSERT INTO plans (id, plan_name, meal_type, breakfast_price, dinner_price) VALUES
(1, '素泊まり',   'none',      0,    0),
(2, '朝食付き',   'breakfast', 1500, 0),
(3, '2食付き',    'two_meals', 1500, 3000),
(4, '夕食付き',   'dinner',    0,    3000);

-- 宿泊税ルール（沖縄県）
INSERT INTO accommodation_tax_rules (id, prefecture_code, tax_type, rate, round_unit, max_base_amount, max_tax_amount, include_consumption_tax, min_charge, child_exempt, valid_from, valid_to) VALUES
(1, '47', 'rate', 0.0200, 1000, 100000, 2000, 1, 0, 1, '2026-10-01', NULL);

-- 決済方法
INSERT INTO payment_methods (id, method_code, method_name, category, receipt_alert, sort_order) VALUES
( 1, 'cash',         '現金',                 'direct',    0, 1),
( 2, 'credit_card',  'クレジットカード',     'direct',    0, 2),
( 3, 'edy',          'Edy',                   'direct',    0, 3),
( 4, 'paypay',       'PayPay',                'direct',    0, 4),
( 5, 'ota_jalan',    'じゃらんオンライン決済','ota',       1, 5),
( 6, 'ota_rakuten',  '楽天オンライン決済',   'ota',       1, 6),
( 7, 'ota_booking',  'Booking.com',           'ota',       0, 7),
( 8, 'ota_agoda',    'Agoda',                 'ota',       1, 8),
( 9, 'rakuten_point','楽天ポイント',         'ota',       1, 9),
(10, 'coupon',       'クーポン',             'ota',       1, 10),
(11, 'corporate',    '法人売掛',             'corporate', 0, 11);

-- システム設定
INSERT INTO system_settings (setting_key, setting_value) VALUES
('session_timeout_minutes', '120'),
('pin_min_length', '4'),
('pin_max_length', '6'),
('login_fail_lock_count', '5'),
('login_fail_lock_minutes', '15');

-- ============================================================
-- 3. スタッフ・権限データ
-- ============================================================

-- PINハッシュ（全員 '1234'）
SET @pin_hash = '$2y$12$z3nOXcFisgqMiF.cLGYL9umd8jcMCNJIJEYVDF.Ucw2OSILjcRVCG';

INSERT INTO staff (id, staff_name, login_name, pin_hash, role, is_active) VALUES
(1, '鈴木 一郎',   'suzuki',      @pin_hash, 'admin',         1),
(2, '山田 太郎',   'yamada',      @pin_hash, 'front_manager', 1),
(3, '佐藤 花子',   'sato',        @pin_hash, 'front',         1),
(4, '高橋 誠',     'takahashi',   @pin_hash, 'front',         1),
(5, '田中 美咲',   'tanaka',      @pin_hash, 'front',         1),
(6, '渡辺 健二',   'watanabe_k',  @pin_hash, 'front',         0),
(7, '清掃 太郎',   'seisou_t',    @pin_hash, 'housekeeping',  1),
(8, '清掃 花子',   'seisou_h',    @pin_hash, 'housekeeping',  1),
(9, '清掃 次郎',   'seisou_j',    @pin_hash, 'housekeeping',  1);

-- 権限マスタ
INSERT INTO permissions (permission_key, permission_name, category, sort_order) VALUES
('reservation.view',       '予約一覧・検索・詳細閲覧',     '予約管理',       1),
('reservation.create',     '手動予約入力',                 '予約管理',       2),
('reservation.cancel',     '予約のキャンセル処理',         '予約管理',       3),
('assign.edit',            'アサインボード操作',           'フロント業務',   10),
('checkin.execute',        'チェックイン処理',             'フロント業務',   11),
('checkout.execute',       'チェックアウト処理',           'フロント業務',   12),
('guest.edit',             'ゲスト紐付け・新規登録・情報編集','フロント業務', 13),
('guest.merge',            'ゲストマージ',                 'フロント業務',   14),
('receipt.issue',          '領収書の発行・再発行',         '帳票',           20),
('invoice.issue',          '請求書の発行・再発行',         '帳票',           21),
('housekeeping.view',      '清掃ステータスの閲覧',         '清掃管理',       30),
('housekeeping.update',    '清掃ステータスの更新',         '清掃管理',       31),
('housekeeping.assign',    '清掃員への部屋割り当て',       '清掃管理',       32),
('report.view',            '日計・月計・OTA別集計の閲覧',   '売上・レポート', 40),
('report.export',          '売上データのCSVエクスポート',   '売上・レポート', 41),
('master.rooms',           '部屋マスタ・部屋タイプマスタの編集','設定',       50),
('master.plans',           'プランマスタの編集',           '設定',           51),
('master.tax',             '宿泊税マスタの編集',           '設定',           52),
('master.corporate',       '法人マスタの編集',             '設定',           53),
('staff.manage',           'スタッフの追加・編集・無効化', '設定',           60),
('staff.pin_reset',        '他スタッフのPINリセット',       '設定',           61),
('system.session_config',  'セッション有効期限の設定',     '設定',           70),
('system.permissions',     '権限設定の変更',               '設定',           71);

-- ロール権限マッピング（4ロール × 23権限）
-- admin: 全権限ON
INSERT INTO role_permissions (role, permission_key, is_granted)
SELECT 'admin', permission_key, 1 FROM permissions;

-- front_manager: admin以外で大半ON
INSERT INTO role_permissions (role, permission_key, is_granted) VALUES
('front_manager', 'reservation.view',      1),
('front_manager', 'reservation.create',    1),
('front_manager', 'reservation.cancel',    1),
('front_manager', 'assign.edit',           1),
('front_manager', 'checkin.execute',       1),
('front_manager', 'checkout.execute',      1),
('front_manager', 'guest.edit',            1),
('front_manager', 'guest.merge',           1),
('front_manager', 'receipt.issue',         1),
('front_manager', 'invoice.issue',         1),
('front_manager', 'housekeeping.view',     1),
('front_manager', 'housekeeping.update',   1),
('front_manager', 'housekeeping.assign',   1),
('front_manager', 'report.view',           1),
('front_manager', 'report.export',         1),
('front_manager', 'master.rooms',          0),
('front_manager', 'master.plans',          0),
('front_manager', 'master.tax',            0),
('front_manager', 'master.corporate',      1),
('front_manager', 'staff.manage',          0),
('front_manager', 'staff.pin_reset',       1),
('front_manager', 'system.session_config', 0),
('front_manager', 'system.permissions',    0);

-- front: 基本操作のみ
INSERT INTO role_permissions (role, permission_key, is_granted) VALUES
('front', 'reservation.view',      1),
('front', 'reservation.create',    1),
('front', 'reservation.cancel',    0),
('front', 'assign.edit',           1),
('front', 'checkin.execute',       1),
('front', 'checkout.execute',      1),
('front', 'guest.edit',            1),
('front', 'guest.merge',           0),
('front', 'receipt.issue',         1),
('front', 'invoice.issue',         0),
('front', 'housekeeping.view',     1),
('front', 'housekeeping.update',   1),
('front', 'housekeeping.assign',   0),
('front', 'report.view',           0),
('front', 'report.export',         0),
('front', 'master.rooms',          0),
('front', 'master.plans',          0),
('front', 'master.tax',            0),
('front', 'master.corporate',      0),
('front', 'staff.manage',          0),
('front', 'staff.pin_reset',       0),
('front', 'system.session_config', 0),
('front', 'system.permissions',    0);

-- housekeeping: 清掃のみ
INSERT INTO role_permissions (role, permission_key, is_granted) VALUES
('housekeeping', 'reservation.view',      0),
('housekeeping', 'reservation.create',    0),
('housekeeping', 'reservation.cancel',    0),
('housekeeping', 'assign.edit',           0),
('housekeeping', 'checkin.execute',       0),
('housekeeping', 'checkout.execute',      0),
('housekeeping', 'guest.edit',            0),
('housekeeping', 'guest.merge',           0),
('housekeeping', 'receipt.issue',         0),
('housekeeping', 'invoice.issue',         0),
('housekeeping', 'housekeeping.view',     1),
('housekeeping', 'housekeeping.update',   1),
('housekeeping', 'housekeeping.assign',   0),
('housekeeping', 'report.view',           0),
('housekeeping', 'report.export',         0),
('housekeeping', 'master.rooms',          0),
('housekeeping', 'master.plans',          0),
('housekeeping', 'master.tax',            0),
('housekeeping', 'master.corporate',      0),
('housekeeping', 'staff.manage',          0),
('housekeeping', 'staff.pin_reset',       0),
('housekeeping', 'system.session_config', 0),
('housekeeping', 'system.permissions',    0);

-- デバイストークン（清掃iPad）
INSERT INTO device_tokens (token, device_name, role, is_active, created_by) VALUES
('dev-housekeeping-token-001', '清掃用iPad-1', 'housekeeping', 1, 1),
('dev-housekeeping-token-002', '清掃用iPad-2', 'housekeeping', 1, 1);

-- ============================================================
-- 4. 法人データ
-- ============================================================
INSERT INTO corporate_clients (id, company_name, payment_cycle, payment_terms, is_active) VALUES
(1, '石垣観光株式会社',   'monthly',  '月末締め翌月末払い',     1),
(2, '沖縄リゾート開発',   'monthly',  '月末締め翌月末払い',     1),
(3, '南西航空サービス',   'monthly',  '月末締め翌々月10日払い', 1),
(4, 'マリンツアーズ',     'per_stay', '都度請求（CO後5営業日以内）', 1),
(5, '八重山ダイビング',   'per_stay', '都度請求（CO後10日以内）',    1);

-- ============================================================
-- 5. ゲストデータ（80名）
-- ============================================================

INSERT INTO guests (id, guest_code, name_kanji, name_kana, name_romaji, country_code, email, phone, guest_notes, visit_count, is_vip, status) VALUES
-- 日本人ゲスト（50名）
( 1, 'G00001', '渡辺 健太',   'ワタナベ ケンタ',     'Watanabe Kenta',     'JP', 'watanabe.k@example.com',  '090-1111-0001', 'VIPゲスト。高層階希望。ウェルカムフルーツ準備', 4, 1, 'active'),
( 2, 'G00002', '中村 美咲',   'ナカムラ ミサキ',     'Nakamura Misaki',    'JP', NULL,                       '090-1111-0002', 'エビアレルギーあり', 3, 0, 'active'),
( 3, 'G00003', '小林 大輔',   'コバヤシ ダイスケ',   'Kobayashi Daisuke',  'JP', 'kobayashi.d@example.com', '090-1111-0003', NULL, 2, 0, 'active'),
( 4, 'G00004', '加藤 裕子',   'カトウ ユウコ',       'Kato Yuko',          'JP', NULL,                       '090-1111-0004', NULL, 1, 0, 'active'),
( 5, 'G00005', '吉田 翔太',   'ヨシダ ショウタ',     'Yoshida Shota',      'JP', 'yoshida.s@example.com',   '090-1111-0005', 'VIPゲスト。バスローブ追加', 6, 1, 'active'),
( 6, 'G00006', '山本 直美',   'ヤマモト ナオミ',     'Yamamoto Naomi',     'JP', NULL,                       '090-1111-0006', NULL, 1, 0, 'active'),
( 7, 'G00007', '松本 健一',   'マツモト ケンイチ',   'Matsumoto Kenichi',  'JP', 'matsumoto@example.com',   '090-1111-0007', '喫煙ルーム不可。低層階希望', 5, 0, 'active'),
( 8, 'G00008', '井上 さくら', 'イノウエ サクラ',     'Inoue Sakura',       'JP', NULL,                       '090-1111-0008', NULL, 2, 0, 'active'),
( 9, 'G00009', '木村 誠',     'キムラ マコト',       'Kimura Makoto',      'JP', 'kimura.m@example.com',    '090-1111-0009', 'VIPゲスト。レイトチェックアウト可', 8, 1, 'active'),
(10, 'G00010', '林 真由美',   'ハヤシ マユミ',       'Hayashi Mayumi',     'JP', NULL,                       '090-1111-0010', NULL, 1, 0, 'active'),
(11, 'G00011', '清水 拓也',   'シミズ タクヤ',       'Shimizu Takuya',     'JP', NULL,                       '090-1111-0011', '猫アレルギー。枕元に空気清浄機', 3, 0, 'active'),
(12, 'G00012', '斎藤 恵',     'サイトウ メグミ',     'Saito Megumi',       'JP', 'saito.m@example.com',     '090-1111-0012', NULL, 2, 0, 'active'),
(13, 'G00013', '藤田 隆',     'フジタ タカシ',       'Fujita Takashi',     'JP', NULL,                       '090-1111-0013', NULL, 1, 0, 'active'),
(14, 'G00014', '岡田 陽子',   'オカダ ヨウコ',       'Okada Yoko',         'JP', NULL,                       '090-1111-0014', '記念日旅行。花のアレンジ希望', 2, 0, 'active'),
(15, 'G00015', '前田 浩二',   'マエダ コウジ',       'Maeda Koji',         'JP', 'maeda.k@example.com',     '090-1111-0015', NULL, 4, 0, 'active'),
(16, 'G00016', '石井 優',     'イシイ ユウ',         'Ishii Yu',           'JP', NULL,                       '090-1111-0016', NULL, 1, 0, 'active'),
(17, 'G00017', '太田 千尋',   'オオタ チヒロ',       'Ota Chihiro',        'JP', NULL,                       '090-1111-0017', 'VIPゲスト', 7, 1, 'active'),
(18, 'G00018', '三浦 翼',     'ミウラ ツバサ',       'Miura Tsubasa',      'JP', 'miura.t@example.com',     '090-1111-0018', NULL, 1, 0, 'active'),
(19, 'G00019', '藤井 美紀',   'フジイ ミキ',         'Fujii Miki',         'JP', NULL,                       '090-1111-0019', NULL, 2, 0, 'active'),
(20, 'G00020', '岡本 一樹',   'オカモト カズキ',     'Okamoto Kazuki',     'JP', NULL,                       '090-1111-0020', 'ダイビング旅行で定期利用', 5, 0, 'active'),
(21, 'G00021', '後藤 彩',     'ゴトウ アヤ',         'Goto Aya',           'JP', NULL,                       '090-1111-0021', NULL, 1, 0, 'active'),
(22, 'G00022', '長谷川 学',   'ハセガワ マナブ',     'Hasegawa Manabu',    'JP', 'hasegawa@example.com',    '090-1111-0022', NULL, 3, 0, 'active'),
(23, 'G00023', '村上 真理子', 'ムラカミ マリコ',     'Murakami Mariko',    'JP', NULL,                       '090-1111-0023', 'そばアレルギー', 2, 0, 'active'),
(24, 'G00024', '近藤 大地',   'コンドウ ダイチ',     'Kondo Daichi',       'JP', NULL,                       '090-1111-0024', NULL, 1, 0, 'active'),
(25, 'G00025', '石川 由美',   'イシカワ ユミ',       'Ishikawa Yumi',      'JP', 'ishikawa.y@example.com',  '090-1111-0025', 'VIPゲスト。高層階指定', 6, 1, 'active'),
(26, 'G00026', '田中 太郎',   'タナカ タロウ',       'Tanaka Taro',        'JP', 'tanaka.t1@example.com',   '090-1111-0026', NULL, 2, 0, 'active'),
(27, 'G00027', '田中 太郎',   'タナカ タロウ',       'Tanaka Taro',        'JP', 'tanaka.t2@example.com',   '090-1111-0027', NULL, 1, 0, 'active'),
(28, 'G00028', '高田 恵美',   'タカダ エミ',         'Takada Emi',         'JP', NULL,                       '090-1111-0028', NULL, 1, 0, 'active'),
(29, 'G00029', '遠藤 亮',     'エンドウ リョウ',     'Endo Ryo',           'JP', NULL,                       '090-1111-0029', NULL, 3, 0, 'active'),
(30, 'G00030', '青木 里奈',   'アオキ リナ',         'Aoki Rina',          'JP', 'aoki.r@example.com',      '090-1111-0030', NULL, 1, 0, 'active'),
(31, 'G00031', '西村 浩',     'ニシムラ ヒロシ',     'Nishimura Hiroshi',  'JP', NULL,                       '090-1111-0031', NULL, 2, 0, 'active'),
(32, 'G00032', '福田 桃子',   'フクダ モモコ',       'Fukuda Momoko',      'JP', NULL,                       '090-1111-0032', '乳製品アレルギー', 1, 0, 'active'),
(33, 'G00033', '原 和也',     'ハラ カズヤ',         'Hara Kazuya',        'JP', NULL,                       '090-1111-0033', NULL, 4, 0, 'active'),
(34, 'G00034', '小川 麻衣',   'オガワ マイ',         'Ogawa Mai',          'JP', NULL,                       '090-1111-0034', NULL, 1, 0, 'active'),
(35, 'G00035', '竹内 龍',     'タケウチ リュウ',     'Takeuchi Ryu',       'JP', 'takeuchi.r@example.com',  '090-1111-0035', NULL, 2, 0, 'active'),
(36, 'G00036', '金子 美穂',   'カネコ ミホ',         'Kaneko Miho',        'JP', NULL,                       '090-1111-0036', NULL, 1, 0, 'active'),
(37, 'G00037', '和田 秀樹',   'ワダ ヒデキ',         'Wada Hideki',        'JP', NULL,                       '090-1111-0037', NULL, 3, 0, 'active'),
(38, 'G00038', '中島 葵',     'ナカジマ アオイ',     'Nakajima Aoi',       'JP', NULL,                       '090-1111-0038', NULL, 1, 0, 'active'),
(39, 'G00039', '上田 慎太郎', 'ウエダ シンタロウ',   'Ueda Shintaro',      'JP', NULL,                       '090-1111-0039', NULL, 2, 0, 'active'),
(40, 'G00040', '丸山 沙織',   'マルヤマ サオリ',     'Maruyama Saori',     'JP', 'maruyama@example.com',    '090-1111-0040', NULL, 1, 0, 'active'),
(41, 'G00041', '横山 正樹',   'ヨコヤマ マサキ',     'Yokoyama Masaki',    'JP', NULL,                       '090-1111-0041', NULL, 1, 0, 'active'),
(42, 'G00042', '宮崎 真由',   'ミヤザキ マユ',       'Miyazaki Mayu',      'JP', NULL,                       '090-1111-0042', NULL, 2, 0, 'active'),
(43, 'G00043', '大野 哲也',   'オオノ テツヤ',       'Ono Tetsuya',        'JP', NULL,                       '090-1111-0043', NULL, 1, 0, 'active'),
(44, 'G00044', '小松 理恵',   'コマツ リエ',         'Komatsu Rie',        'JP', NULL,                       '090-1111-0044', NULL, 3, 0, 'active'),
(45, 'G00045', '久保田 正人', 'クボタ マサト',       'Kubota Masato',      'JP', NULL,                       '090-1111-0045', NULL, 1, 0, 'active'),
(46, 'G00046', '菊地 春香',   'キクチ ハルカ',       'Kikuchi Haruka',     'JP', NULL,                       '090-1111-0046', NULL, 2, 0, 'active'),
(47, 'G00047', '野口 修',     'ノグチ オサム',       'Noguchi Osamu',      'JP', NULL,                       '090-1111-0047', NULL, 1, 0, 'active'),
(48, 'G00048', '松田 亜美',   'マツダ アミ',         'Matsuda Ami',        'JP', NULL,                       '090-1111-0048', '甲殻類アレルギー', 1, 0, 'active'),
(49, 'G00049', '新井 勇気',   'アライ ユウキ',       'Arai Yuki',          'JP', NULL,                       '090-1111-0049', NULL, 4, 0, 'active'),
(50, 'G00050', '平野 結衣',   'ヒラノ ユイ',         'Hirano Yui',         'JP', NULL,                       '090-1111-0050', NULL, 1, 0, 'active'),

-- 外国人ゲスト（15名）
(51, 'G00051', NULL, NULL, 'Smith John',       'US', 'john.smith@example.com',   NULL, NULL, 2, 0, 'active'),
(52, 'G00052', NULL, NULL, 'Chen Wei',         'TW', NULL,                        NULL, NULL, 1, 0, 'active'),
(53, 'G00053', NULL, NULL, 'Kim Minjun',       'KR', NULL,                        NULL, 'VIP。韓国語対応スタッフ手配', 3, 1, 'active'),
(54, 'G00054', NULL, NULL, 'Wang Lei',         'CN', NULL,                        NULL, NULL, 1, 0, 'active'),
(55, 'G00055', NULL, NULL, 'Brown Sarah',      'AU', 'sarah.b@example.com',       NULL, NULL, 1, 0, 'active'),
(56, 'G00056', NULL, NULL, 'Taylor James',     'GB', NULL,                        NULL, NULL, 2, 0, 'active'),
(57, 'G00057', NULL, NULL, 'Srisai Napat',     'TH', NULL,                        NULL, NULL, 1, 0, 'active'),
(58, 'G00058', NULL, NULL, 'Lim Jia Wei',      'SG', 'limjw@example.com',         NULL, NULL, 1, 0, 'active'),
(59, 'G00059', NULL, NULL, 'Dupont Marie',     'FR', NULL,                        NULL, NULL, 1, 0, 'active'),
(60, 'G00060', NULL, NULL, 'Mueller Hans',     'DE', NULL,                        NULL, NULL, 2, 0, 'active'),
(61, 'G00061', NULL, NULL, 'Garcia Carlos',    'US', NULL,                        NULL, NULL, 1, 0, 'active'),
(62, 'G00062', NULL, NULL, 'Lee Soyoung',      'KR', NULL,                        NULL, NULL, 1, 0, 'active'),
(63, 'G00063', NULL, NULL, 'Nguyen Hoa',       'VN', NULL,                        NULL, NULL, 1, 0, 'active'),
(64, 'G00064', NULL, NULL, 'Patel Ravi',       'IN', NULL,                        NULL, NULL, 1, 0, 'active'),
(65, 'G00065', NULL, NULL, 'Anderson Emma',    'US', 'emma.a@example.com',        NULL, NULL, 1, 0, 'active'),

-- 日本人だが海外OTA経由（ローマ字のみ、10名）
(66, 'G00066', NULL, NULL, 'Sato Yuki',        'JP', NULL,                        NULL, NULL, 1, 0, 'active'),
(67, 'G00067', NULL, NULL, 'Tanaka Haruto',    'JP', NULL,                        NULL, NULL, 1, 0, 'active'),
(68, 'G00068', NULL, NULL, 'Suzuki Aoi',       'JP', NULL,                        NULL, NULL, 2, 0, 'active'),
(69, 'G00069', NULL, NULL, 'Yamamoto Ren',     'JP', NULL,                        NULL, NULL, 1, 0, 'active'),
(70, 'G00070', NULL, NULL, 'Ito Hana',         'JP', NULL,                        NULL, NULL, 1, 0, 'active'),
(71, 'G00071', NULL, NULL, 'Takahashi Sora',   'JP', NULL,                        NULL, NULL, 1, 0, 'active'),
(72, 'G00072', NULL, NULL, 'Nakamura Riku',    'JP', NULL,                        NULL, NULL, 1, 0, 'active'),
(73, 'G00073', NULL, NULL, 'Kobayashi Mei',    'JP', NULL,                        NULL, NULL, 1, 0, 'active'),
(74, 'G00074', NULL, NULL, 'Kato Sota',        'JP', NULL,                        NULL, NULL, 1, 0, 'active'),
(75, 'G00075', NULL, NULL, 'Yoshida Mio',      'JP', NULL,                        NULL, NULL, 1, 0, 'active'),

-- 旧姓ありゲスト（3名）
(76, 'G00076', '佐々木 恵子', 'ササキ ケイコ',   'Sasaki Keiko',     'JP', NULL, '090-1111-0076', NULL, 2, 0, 'active'),
(77, 'G00077', '中田 明美',   'ナカタ アケミ',   'Nakata Akemi',     'JP', NULL, '090-1111-0077', NULL, 3, 0, 'active'),
(78, 'G00078', '森田 由香',   'モリタ ユカ',     'Morita Yuka',      'JP', NULL, '090-1111-0078', NULL, 1, 0, 'active'),

-- マージ済みゲスト
(79, 'G00079', '伊藤 花',     'イトウ ハナ',     'Ito Hana',         'JP', NULL, NULL, NULL, 0, 0, 'merged'),

-- 追加（80名目）
(80, 'G00080', '川口 大介',   'カワグチ ダイスケ', 'Kawaguchi Daisuke', 'JP', NULL, '090-1111-0080', NULL, 1, 0, 'active');

-- マージ済みゲストの参照先設定
UPDATE guests SET merged_into_guest_id = 70 WHERE id = 79;

-- 旧姓（guest_aliases）
INSERT INTO guest_aliases (guest_id, name_kanji, name_kana, name_romaji, alias_type) VALUES
(76, '鈴木 恵子', 'スズキ ケイコ', 'Suzuki Keiko', 'maiden'),
(77, '山口 明美', 'ヤマグチ アケミ', 'Yamaguchi Akemi', 'maiden'),
(78, '田村 由香', 'タムラ ユカ', 'Tamura Yuka', 'maiden');

-- ============================================================
-- 6. 予約データ（170件）
-- ============================================================
-- ステータス分布: confirmed=85, checked_in=10, checked_out=60, cancelled=10, no_show=5

INSERT INTO reservations (id, guest_id, guest_match_status, channel, reservation_no, checkin_date, checkout_date, nights, room_type, amount, adult_count, child_count, child_amount, plan_id, status, payment_method, corporate_id, tl_last_name, tl_first_name, reservation_notes, actual_checkin_at, actual_checkout_at) VALUES

-- ============================================
-- 当日（4/10）滞在中 checked_in: 10件（予約ID 1-10）
-- ============================================
( 1,  1, 'matched', 'jalan',   'JL-00001', '2026-04-08', '2026-04-12', 4, 'STW',  80000, 2, 0, NULL, 2, 'checked_in', 'cash',        NULL, 'ワタナベ',   'ケンタ',   'VIP対応済み。フルーツ準備完了', '2026-04-08 15:10:00', NULL),
( 2,  5, 'matched', 'rakuten', 'RK-00001', '2026-04-09', '2026-04-11', 2, 'LR',   70000, 2, 0, NULL, 3, 'checked_in', 'card',        NULL, 'ヨシダ',     'ショウタ', NULL, '2026-04-09 14:30:00', NULL),
( 3,  9, 'matched', 'direct',  'DR-00001', '2026-04-07', '2026-04-11', 4, 'TW',    56000, 2, 1, 5000, 2, 'checked_in', 'cash',        NULL, 'キムラ',     'マコト',   'レイトCO12:00了承済', '2026-04-07 15:00:00', NULL),
( 4,  7, 'matched', 'booking', 'BK-00001', '2026-04-09', '2026-04-12', 3, 'SW',  24000, 1, 0, NULL, 1, 'checked_in', 'ota_prepaid', NULL, 'Matsumoto',  'Kenichi',  NULL, '2026-04-09 16:20:00', NULL),
( 5, 51, 'matched', 'booking', 'BK-00002', '2026-04-10', '2026-04-13', 3, 'TW',    48000, 2, 0, NULL, 2, 'checked_in', 'ota_prepaid', NULL, 'Smith',      'John',     NULL, '2026-04-10 08:30:00', NULL),
( 6, 15, 'matched', 'phone',   'PH-00001', '2026-04-09', '2026-04-11', 2, 'STW',  24000, 2, 0, NULL, 1, 'checked_in', 'cash',        NULL, 'マエダ',     'コウジ',   NULL, '2026-04-09 14:50:00', NULL),
( 7, 22, 'matched', 'jalan',   'JL-00002', '2026-04-08', '2026-04-11', 3, 'SW',  27000, 1, 0, NULL, 2, 'checked_in', 'card',        NULL, 'ハセガワ',   'マナブ',   NULL, '2026-04-08 15:30:00', NULL),
( 8, 53, 'matched', 'agoda',   'AG-00001', '2026-04-09', '2026-04-12', 3, 'STW',  66000, 2, 0, NULL, 1, 'checked_in', 'ota_prepaid', NULL, 'Kim',        'Minjun',   'VIP。韓国語資料準備', '2026-04-09 17:00:00', NULL),
( 9, 33, 'matched', 'corporate','CP-00001','2026-04-08', '2026-04-11', 3, 'SW',  24000, 1, 0, NULL, 1, 'checked_in', 'corporate',    1, 'ハラ',       'カズヤ',   '石垣観光出張', '2026-04-08 18:00:00', NULL),
(10, 37, 'matched', 'corporate','CP-00002','2026-04-09', '2026-04-11', 2, 'STW',  24000, 1, 0, NULL, 1, 'checked_in', 'corporate',    2, 'ワダ',       'ヒデキ',   '沖縄リゾート出張', '2026-04-09 14:00:00', NULL),

-- ============================================
-- 当日（4/10）CI予定 confirmed: 5件（予約ID 11-15）
-- ============================================
(11, 11, 'matched', 'jalan',   'JL-00003', '2026-04-10', '2026-04-12', 2, 'TW',    30000, 2, 0, NULL, 2, 'confirmed', NULL, NULL, 'シミズ', 'タクヤ', NULL, NULL, NULL),
(12, 56, 'matched', 'booking', 'BK-00003', '2026-04-10', '2026-04-14', 4, 'STW',  88000, 2, 0, NULL, 3, 'confirmed', NULL, NULL, 'Taylor', 'James',  NULL, NULL, NULL),
(13,  2, 'matched', 'rakuten', 'RK-00002', '2026-04-10', '2026-04-12', 2, 'SW',  18000, 1, 0, NULL, 2, 'confirmed', NULL, NULL, 'ナカムラ', 'ミサキ', 'エビ除去朝食対応', NULL, NULL),
(14, 66, 'pending', 'booking', 'BK-00004', '2026-04-10', '2026-04-11', 1, 'SW',   8500, 1, 0, NULL, 1, 'confirmed', NULL, NULL, 'Sato', 'Yuki', NULL, NULL, NULL),
(15, 29, 'matched', 'expedia', 'EX-00001', '2026-04-10', '2026-04-13', 3, 'TW',    45000, 2, 1, 3000, 1, 'confirmed', NULL, NULL, 'エンドウ', 'リョウ', NULL, NULL, NULL),

-- ============================================
-- 当日（4/10）CO予定: 4件（予約ID 16-19）
-- ============================================
(16, 25, 'matched', 'jalan',   'JL-00004', '2026-04-08', '2026-04-10', 2, 'LR',   70000, 2, 0, NULL, 3, 'checked_in', 'card', NULL, 'イシカワ', 'ユミ', 'VIP対応。高層階', '2026-04-08 14:00:00', NULL),
(17,  3, 'matched', 'rakuten', 'RK-00003', '2026-04-09', '2026-04-10', 1, 'STW',  13000, 2, 0, NULL, 2, 'checked_in', 'cash', NULL, 'コバヤシ', 'ダイスケ', NULL, '2026-04-09 15:00:00', NULL),
(18, 17, 'matched', 'direct',  'DR-00002', '2026-04-07', '2026-04-10', 3, 'STW',  66000, 2, 0, NULL, 1, 'checked_in', 'cash', NULL, 'オオタ', 'チヒロ', 'VIP', '2026-04-07 14:30:00', NULL),
(19, 57, 'matched', 'agoda',   'AG-00002', '2026-04-09', '2026-04-10', 1, 'SW',   9000, 1, 0, NULL, 1, 'checked_in', 'ota_prepaid', NULL, 'Srisai', 'Napat', NULL, '2026-04-09 16:00:00', NULL),

-- ============================================
-- 過去分 checked_out: 60件（予約ID 20-79）
-- ============================================
(20,  4, 'matched', 'jalan',   'JL-00005', '2026-03-01', '2026-03-03', 2, 'SW',  16000, 1, 0, NULL, 1, 'checked_out', 'cash', NULL, 'カトウ', 'ユウコ', NULL, '2026-03-01 14:00:00', '2026-03-03 10:00:00'),
(21,  6, 'matched', 'rakuten', 'RK-00004', '2026-03-02', '2026-03-04', 2, 'TW',    28000, 2, 0, NULL, 2, 'checked_out', 'card', NULL, 'ヤマモト', 'ナオミ', NULL, '2026-03-02 15:00:00', '2026-03-04 10:30:00'),
(22,  8, 'matched', 'booking', 'BK-00005', '2026-03-03', '2026-03-05', 2, 'STW',  26000, 2, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Inoue', 'Sakura', NULL, '2026-03-03 16:00:00', '2026-03-05 09:00:00'),
(23, 10, 'matched', 'jalan',   'JL-00006', '2026-03-05', '2026-03-07', 2, 'SW',  18000, 1, 0, NULL, 2, 'checked_out', 'cash', NULL, 'ハヤシ', 'マユミ', NULL, '2026-03-05 14:30:00', '2026-03-07 10:00:00'),
(24, 12, 'matched', 'rakuten', 'RK-00005', '2026-03-07', '2026-03-09', 2, 'TW',    30000, 2, 0, NULL, 2, 'checked_out', 'card', NULL, 'サイトウ', 'メグミ', NULL, '2026-03-07 15:00:00', '2026-03-09 10:00:00'),
(25, 13, 'matched', 'phone',   'PH-00002', '2026-03-08', '2026-03-10', 2, 'SW',  17000, 1, 0, NULL, 1, 'checked_out', 'cash', NULL, 'フジタ', 'タカシ', NULL, '2026-03-08 14:00:00', '2026-03-10 10:30:00'),
(26, 14, 'matched', 'jalan',   'JL-00007', '2026-03-10', '2026-03-12', 2, 'STW',  44000, 2, 0, NULL, 3, 'checked_out', 'cash', NULL, 'オカダ', 'ヨウコ', '記念日旅行', '2026-03-10 14:00:00', '2026-03-12 11:00:00'),
(27, 16, 'matched', 'booking', 'BK-00006', '2026-03-12', '2026-03-14', 2, 'SW',  17000, 1, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Ishii', 'Yu', NULL, '2026-03-12 16:00:00', '2026-03-14 09:30:00'),
(28, 18, 'matched', 'agoda',   'AG-00003', '2026-03-13', '2026-03-15', 2, 'TW',    30000, 2, 0, NULL, 2, 'checked_out', 'ota_prepaid', NULL, 'Miura', 'Tsubasa', NULL, '2026-03-13 15:00:00', '2026-03-15 10:00:00'),
(29, 19, 'matched', 'rakuten', 'RK-00006', '2026-03-14', '2026-03-16', 2, 'STW',  26000, 2, 0, NULL, 1, 'checked_out', 'card', NULL, 'フジイ', 'ミキ', NULL, '2026-03-14 14:30:00', '2026-03-16 10:00:00'),
(30, 20, 'matched', 'direct',  'DR-00003', '2026-03-15', '2026-03-18', 3, 'TW',    42000, 2, 0, NULL, 1, 'checked_out', 'cash', NULL, 'オカモト', 'カズキ', 'ダイビング旅行', '2026-03-15 15:00:00', '2026-03-18 10:00:00'),
(31, 21, 'matched', 'jalan',   'JL-00008', '2026-03-16', '2026-03-17', 1, 'SW',   9000, 1, 0, NULL, 2, 'checked_out', 'cash', NULL, 'ゴトウ', 'アヤ', NULL, '2026-03-16 14:00:00', '2026-03-17 10:00:00'),
(32, 23, 'matched', 'rakuten', 'RK-00007', '2026-03-18', '2026-03-20', 2, 'STW',  28000, 2, 0, NULL, 3, 'checked_out', 'card', NULL, 'ムラカミ', 'マリコ', 'そばアレルギー対応', '2026-03-18 14:00:00', '2026-03-20 10:30:00'),
(33, 24, 'matched', 'booking', 'BK-00007', '2026-03-19', '2026-03-21', 2, 'SW',  17500, 1, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Kondo', 'Daichi', NULL, '2026-03-19 15:30:00', '2026-03-21 10:00:00'),
(34, 26, 'matched', 'jalan',   'JL-00009', '2026-03-20', '2026-03-22', 2, 'TW',    30000, 2, 1, 3000, 2, 'checked_out', 'cash', NULL, 'タナカ', 'タロウ', NULL, '2026-03-20 14:00:00', '2026-03-22 10:00:00'),
(35, 28, 'matched', 'phone',   'PH-00003', '2026-03-21', '2026-03-23', 2, 'STW',  44000, 2, 0, NULL, 1, 'checked_out', 'cash', NULL, 'タカダ', 'エミ', NULL, '2026-03-21 15:00:00', '2026-03-23 10:00:00'),
(36, 30, 'matched', 'jalan',   'JL-00010', '2026-03-22', '2026-03-24', 2, 'SW',  18000, 1, 0, NULL, 2, 'checked_out', 'cash', NULL, 'アオキ', 'リナ', NULL, '2026-03-22 14:00:00', '2026-03-24 10:00:00'),
(37, 31, 'matched', 'rakuten', 'RK-00008', '2026-03-23', '2026-03-25', 2, 'TW',    30000, 2, 0, NULL, 2, 'checked_out', 'card', NULL, 'ニシムラ', 'ヒロシ', NULL, '2026-03-23 15:00:00', '2026-03-25 10:00:00'),
(38, 32, 'matched', 'booking', 'BK-00008', '2026-03-24', '2026-03-26', 2, 'STW',  26000, 2, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Fukuda', 'Momoko', '乳製品アレルギー', '2026-03-24 16:00:00', '2026-03-26 10:00:00'),
(39, 34, 'matched', 'agoda',   'AG-00004', '2026-03-25', '2026-03-27', 2, 'SW',  18000, 1, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Ogawa', 'Mai', NULL, '2026-03-25 15:00:00', '2026-03-27 10:00:00'),
(40, 35, 'matched', 'expedia', 'EX-00002', '2026-03-26', '2026-03-28', 2, 'TW',    30000, 2, 0, NULL, 2, 'checked_out', 'ota_prepaid', NULL, 'Takeuchi', 'Ryu', NULL, '2026-03-26 14:00:00', '2026-03-28 10:00:00'),
(41, 36, 'matched', 'jalan',   'JL-00011', '2026-03-27', '2026-03-29', 2, 'STW',  28000, 2, 0, NULL, 3, 'checked_out', 'cash', NULL, 'カネコ', 'ミホ', NULL, '2026-03-27 14:00:00', '2026-03-29 10:00:00'),
(42, 38, 'matched', 'rakuten', 'RK-00009', '2026-03-28', '2026-03-30', 2, 'SW',  18000, 1, 0, NULL, 2, 'checked_out', 'card', NULL, 'ナカジマ', 'アオイ', NULL, '2026-03-28 15:00:00', '2026-03-30 10:00:00'),
(43, 39, 'matched', 'booking', 'BK-00009', '2026-03-29', '2026-03-31', 2, 'STW',  44000, 2, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Ueda', 'Shintaro', NULL, '2026-03-29 14:30:00', '2026-03-31 10:00:00'),
(44, 40, 'matched', 'jalan',   'JL-00012', '2026-03-30', '2026-04-01', 2, 'TW',    32000, 2, 0, NULL, 2, 'checked_out', 'cash', NULL, 'マルヤマ', 'サオリ', NULL, '2026-03-30 14:00:00', '2026-04-01 10:30:00'),
(45, 41, 'matched', 'phone',   'PH-00004', '2026-03-31', '2026-04-02', 2, 'SW',  17000, 1, 0, NULL, 1, 'checked_out', 'cash', NULL, 'ヨコヤマ', 'マサキ', NULL, '2026-03-31 15:00:00', '2026-04-02 10:00:00'),
(46, 42, 'matched', 'rakuten', 'RK-00010', '2026-04-01', '2026-04-03', 2, 'STW',  28000, 2, 1, 4000, 2, 'checked_out', 'card', NULL, 'ミヤザキ', 'マユ', NULL, '2026-04-01 14:00:00', '2026-04-03 10:00:00'),
(47, 43, 'matched', 'booking', 'BK-00010', '2026-04-02', '2026-04-04', 2, 'TW',    30000, 2, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Ono', 'Tetsuya', NULL, '2026-04-02 16:00:00', '2026-04-04 09:30:00'),
(48, 44, 'matched', 'jalan',   'JL-00013', '2026-04-03', '2026-04-05', 2, 'SW',  18000, 1, 0, NULL, 2, 'checked_out', 'cash', NULL, 'コマツ', 'リエ', NULL, '2026-04-03 14:00:00', '2026-04-05 10:00:00'),
(49, 45, 'matched', 'agoda',   'AG-00005', '2026-04-03', '2026-04-06', 3, 'STW',  63000, 2, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Kubota', 'Masato', NULL, '2026-04-03 15:00:00', '2026-04-06 10:00:00'),
(50, 46, 'matched', 'rakuten', 'RK-00011', '2026-04-04', '2026-04-06', 2, 'TW',    32000, 2, 0, NULL, 3, 'checked_out', 'card', NULL, 'キクチ', 'ハルカ', NULL, '2026-04-04 14:00:00', '2026-04-06 10:30:00'),
(51, 47, 'matched', 'jalan',   'JL-00014', '2026-04-04', '2026-04-07', 3, 'STW',  39000, 2, 0, NULL, 1, 'checked_out', 'cash', NULL, 'ノグチ', 'オサム', NULL, '2026-04-04 15:00:00', '2026-04-07 10:00:00'),
(52, 48, 'matched', 'booking', 'BK-00011', '2026-04-05', '2026-04-07', 2, 'SW',  17000, 1, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Matsuda', 'Ami', '甲殻類アレルギー', '2026-04-05 16:00:00', '2026-04-07 09:00:00'),
(53, 49, 'matched', 'direct',  'DR-00004', '2026-04-05', '2026-04-08', 3, 'TW',    45000, 2, 0, NULL, 2, 'checked_out', 'cash', NULL, 'アライ', 'ユウキ', NULL, '2026-04-05 14:00:00', '2026-04-08 10:00:00'),
(54, 50, 'matched', 'jalan',   'JL-00015', '2026-04-06', '2026-04-08', 2, 'STW',  26000, 2, 0, NULL, 1, 'checked_out', 'cash', NULL, 'ヒラノ', 'ユイ', NULL, '2026-04-06 14:30:00', '2026-04-08 10:00:00'),
(55, 52, 'matched', 'booking', 'BK-00012', '2026-04-06', '2026-04-09', 3, 'STW',  66000, 2, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Chen', 'Wei', NULL, '2026-04-06 15:00:00', '2026-04-09 10:00:00'),
(56, 54, 'matched', 'agoda',   'AG-00006', '2026-04-07', '2026-04-09', 2, 'SW',  17500, 1, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Wang', 'Lei', NULL, '2026-04-07 16:00:00', '2026-04-09 10:00:00'),
(57, 55, 'matched', 'expedia', 'EX-00003', '2026-04-07', '2026-04-09', 2, 'TW',    30000, 2, 0, NULL, 2, 'checked_out', 'ota_prepaid', NULL, 'Brown', 'Sarah', NULL, '2026-04-07 14:00:00', '2026-04-09 10:30:00'),
(58, 58, 'matched', 'booking', 'BK-00013', '2026-04-08', '2026-04-10', 2, 'STW',  26000, 2, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Lim', 'Jia Wei', NULL, '2026-04-08 15:00:00', '2026-04-10 09:30:00'),
(59, 59, 'matched', 'booking', 'BK-00014', '2026-04-08', '2026-04-10', 2, 'SW',  18000, 1, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Dupont', 'Marie', NULL, '2026-04-08 16:00:00', '2026-04-10 10:00:00'),
-- 法人checked_out（12件: 月次3社分）
(60, 33, 'matched', 'corporate','CP-00003','2026-03-05', '2026-03-07', 2, 'SW',  16000, 1, 0, NULL, 1, 'checked_out', 'corporate', 1, 'ハラ', 'カズヤ', '石垣観光出張', '2026-03-05 14:00:00', '2026-03-07 10:00:00'),
(61, 37, 'matched', 'corporate','CP-00004','2026-03-10', '2026-03-12', 2, 'STW',  24000, 1, 0, NULL, 1, 'checked_out', 'corporate', 2, 'ワダ', 'ヒデキ', NULL, '2026-03-10 15:00:00', '2026-03-12 10:00:00'),
(62, 29, 'matched', 'corporate','CP-00005','2026-03-15', '2026-03-17', 2, 'SW',  16000, 1, 0, NULL, 1, 'checked_out', 'corporate', 3, 'エンドウ', 'リョウ', NULL, '2026-03-15 14:00:00', '2026-03-17 10:00:00'),
(63, 33, 'matched', 'corporate','CP-00006','2026-03-20', '2026-03-22', 2, 'SW',  16000, 1, 0, NULL, 1, 'checked_out', 'corporate', 1, 'ハラ', 'カズヤ', NULL, '2026-03-20 14:00:00', '2026-03-22 10:00:00'),
(64, 37, 'matched', 'corporate','CP-00007','2026-03-25', '2026-03-27', 2, 'STW',  24000, 1, 0, NULL, 1, 'checked_out', 'corporate', 2, 'ワダ', 'ヒデキ', NULL, '2026-03-25 14:00:00', '2026-03-27 10:00:00'),
(65, 29, 'matched', 'corporate','CP-00008','2026-03-28', '2026-03-30', 2, 'TW',    28000, 1, 0, NULL, 1, 'checked_out', 'corporate', 3, 'エンドウ', 'リョウ', NULL, '2026-03-28 14:00:00', '2026-03-30 10:00:00'),
(66, 33, 'matched', 'corporate','CP-00009','2026-04-01', '2026-04-03', 2, 'SW',  16000, 1, 0, NULL, 1, 'checked_out', 'corporate', 1, 'ハラ', 'カズヤ', NULL, '2026-04-01 14:00:00', '2026-04-03 10:00:00'),
(67, 37, 'matched', 'corporate','CP-00010','2026-04-03', '2026-04-05', 2, 'STW',  24000, 1, 0, NULL, 1, 'checked_out', 'corporate', 2, 'ワダ', 'ヒデキ', NULL, '2026-04-03 14:00:00', '2026-04-05 10:00:00'),
(68, 29, 'matched', 'corporate','CP-00011','2026-04-05', '2026-04-07', 2, 'TW',    28000, 1, 0, NULL, 1, 'checked_out', 'corporate', 3, 'エンドウ', 'リョウ', NULL, '2026-04-05 14:00:00', '2026-04-07 10:00:00'),
(69, 33, 'matched', 'corporate','CP-00012','2026-04-07', '2026-04-09', 2, 'SW',  16000, 1, 0, NULL, 1, 'checked_out', 'corporate', 1, 'ハラ', 'カズヤ', NULL, '2026-04-07 14:00:00', '2026-04-09 10:00:00'),
-- 法人checked_out（都度: 2社分 8件）
(70, 20, 'matched', 'corporate','CP-00013','2026-03-08', '2026-03-10', 2, 'TW',    28000, 2, 0, NULL, 1, 'checked_out', 'corporate', 4, 'オカモト', 'カズキ', 'マリンツアーズ', '2026-03-08 14:00:00', '2026-03-10 10:00:00'),
(71, 20, 'matched', 'corporate','CP-00014','2026-03-22', '2026-03-24', 2, 'TW',    28000, 2, 0, NULL, 1, 'checked_out', 'corporate', 4, 'オカモト', 'カズキ', NULL, '2026-03-22 14:00:00', '2026-03-24 10:00:00'),
(72, 35, 'matched', 'corporate','CP-00015','2026-03-12', '2026-03-14', 2, 'SW',  16000, 1, 0, NULL, 1, 'checked_out', 'corporate', 5, 'タケウチ', 'リュウ', '八重山ダイビング', '2026-03-12 15:00:00', '2026-03-14 10:00:00'),
(73, 35, 'matched', 'corporate','CP-00016','2026-03-26', '2026-03-28', 2, 'SW',  16000, 1, 0, NULL, 1, 'checked_out', 'corporate', 5, 'タケウチ', 'リュウ', NULL, '2026-03-26 14:00:00', '2026-03-28 10:00:00'),
(74, 20, 'matched', 'corporate','CP-00017','2026-04-01', '2026-04-03', 2, 'STW',  40000, 2, 0, NULL, 1, 'checked_out', 'corporate', 4, 'オカモト', 'カズキ', NULL, '2026-04-01 14:00:00', '2026-04-03 10:00:00'),
(75, 35, 'matched', 'corporate','CP-00018','2026-04-04', '2026-04-06', 2, 'SW',  16000, 1, 0, NULL, 1, 'checked_out', 'corporate', 5, 'タケウチ', 'リュウ', NULL, '2026-04-04 14:00:00', '2026-04-06 10:00:00'),
(76, 20, 'matched', 'corporate','CP-00019','2026-04-06', '2026-04-08', 2, 'TW',    28000, 2, 0, NULL, 1, 'checked_out', 'corporate', 4, 'オカモト', 'カズキ', NULL, '2026-04-06 14:00:00', '2026-04-08 10:00:00'),
(77, 35, 'matched', 'corporate','CP-00020','2026-04-07', '2026-04-09', 2, 'SW',  16000, 1, 0, NULL, 1, 'checked_out', 'corporate', 5, 'タケウチ', 'リュウ', NULL, '2026-04-07 14:00:00', '2026-04-09 10:00:00'),
-- 途中退室 3件（P-03）
(78, 60, 'matched', 'booking', 'BK-00015', '2026-03-15', '2026-03-19', 4, 'TW',    56000, 2, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Mueller', 'Hans', '体調不良のため2泊で退室', '2026-03-15 14:00:00', '2026-03-17 10:00:00'),
(79, 61, 'matched', 'expedia', 'EX-00004', '2026-03-20', '2026-03-24', 4, 'STW',  80000, 2, 0, NULL, 1, 'checked_out', 'ota_prepaid', NULL, 'Garcia', 'Carlos', '予定変更のため3泊で退室', '2026-03-20 15:00:00', '2026-03-23 09:00:00'),

-- ============================================
-- キャンセル: 10件（予約ID 80-89）
-- ============================================
(80, 62, 'matched', 'booking', 'BK-00016', '2026-04-15', '2026-04-17', 2, 'SW',  17000, 1, 0, NULL, 1, 'cancelled', NULL, NULL, 'Lee', 'Soyoung', NULL, NULL, NULL),
(81, 63, 'matched', 'agoda',   'AG-00007', '2026-04-18', '2026-04-20', 2, 'TW',    30000, 2, 0, NULL, 2, 'cancelled', NULL, NULL, 'Nguyen', 'Hoa', NULL, NULL, NULL),
(82,  4, 'matched', 'jalan',   'JL-00016', '2026-04-12', '2026-04-14', 2, 'SW',  18000, 1, 0, NULL, 2, 'cancelled', NULL, NULL, 'カトウ', 'ユウコ', NULL, NULL, NULL),
(83,  6, 'matched', 'rakuten', 'RK-00012', '2026-04-20', '2026-04-22', 2, 'STW',  26000, 2, 0, NULL, 1, 'cancelled', NULL, NULL, 'ヤマモト', 'ナオミ', NULL, NULL, NULL),
(84, 64, 'matched', 'booking', 'BK-00017', '2026-04-22', '2026-04-24', 2, 'TW',    30000, 2, 0, NULL, 1, 'cancelled', NULL, NULL, 'Patel', 'Ravi', NULL, NULL, NULL),
(85, 10, 'matched', 'jalan',   'JL-00017', '2026-04-25', '2026-04-27', 2, 'SW',  18000, 1, 0, NULL, 2, 'cancelled', NULL, NULL, 'ハヤシ', 'マユミ', NULL, NULL, NULL),
(86, 16, 'matched', 'agoda',   'AG-00008', '2026-04-28', '2026-04-30', 2, 'STW',  26000, 2, 0, NULL, 1, 'cancelled', NULL, NULL, 'イシイ', 'ユウ', NULL, NULL, NULL),
(87, 65, 'matched', 'expedia', 'EX-00005', '2026-05-01', '2026-05-03', 2, 'STW',  44000, 2, 0, NULL, 1, 'cancelled', NULL, NULL, 'Anderson', 'Emma', NULL, NULL, NULL),
(88, 34, 'matched', 'rakuten', 'RK-00013', '2026-05-05', '2026-05-07', 2, 'SW',  18000, 1, 0, NULL, 1, 'cancelled', NULL, NULL, 'オガワ', 'マイ', NULL, NULL, NULL),
(89, 36, 'matched', 'jalan',   'JL-00018', '2026-05-10', '2026-05-12', 2, 'TW',    30000, 2, 0, NULL, 2, 'cancelled', NULL, NULL, 'カネコ', 'ミホ', NULL, NULL, NULL),

-- ============================================
-- ノーショー: 5件（P-05, 予約ID 90-94）
-- ============================================
(90, 67, 'pending', 'booking', 'BK-00018', '2026-03-25', '2026-03-27', 2, 'SW',  17000, 1, 0, NULL, 1, 'no_show', NULL, NULL, 'Tanaka', 'Haruto', NULL, NULL, NULL),
(91, 68, 'pending', 'agoda',   'AG-00009', '2026-03-28', '2026-03-30', 2, 'TW',    30000, 2, 0, NULL, 1, 'no_show', NULL, NULL, 'Suzuki', 'Aoi', NULL, NULL, NULL),
(92, 69, 'pending', 'expedia', 'EX-00006', '2026-04-01', '2026-04-03', 2, 'STW',  24000, 1, 0, NULL, 1, 'no_show', NULL, NULL, 'Yamamoto', 'Ren', NULL, NULL, NULL),
(93, 70, 'pending', 'booking', 'BK-00019', '2026-04-05', '2026-04-07', 2, 'SW',  17000, 1, 0, NULL, 1, 'no_show', NULL, NULL, 'Ito', 'Hana', NULL, NULL, NULL),
(94, 71, 'pending', 'agoda',   'AG-00010', '2026-04-08', '2026-04-10', 2, 'TW',    30000, 2, 0, NULL, 1, 'no_show', NULL, NULL, 'Takahashi', 'Sora', NULL, NULL, NULL),

-- ============================================
-- 未来分 confirmed: 80件（予約ID 95-174）
-- ============================================
-- P-01: 分割予約セット①（渡辺健太 4連泊、各OTA別）
(95,  1, 'matched', 'jalan',   'JL-00101', '2026-04-15', '2026-04-16', 1, 'STW',  22000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'ワタナベ', 'ケンタ', NULL, NULL, NULL),
(96,  1, 'matched', 'booking', 'BK-00102', '2026-04-16', '2026-04-17', 1, 'STW',  22000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'Watanabe', 'Kenta', NULL, NULL, NULL),
(97,  1, 'matched', 'rakuten', 'RK-00103', '2026-04-17', '2026-04-18', 1, 'STW',  22000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'ワタナベ', 'ケンタ', NULL, NULL, NULL),
(98,  1, 'matched', 'agoda',   'AG-00104', '2026-04-18', '2026-04-19', 1, 'STW',  22000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'WATANABE', 'KENTA', NULL, NULL, NULL),

-- P-02: 連結予約の穴セット（10泊、3件目キャンセル → gap）
(99,  9, 'matched', 'direct',  'DR-00010', '2026-04-20', '2026-04-22', 2, 'TW',    28000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'キムラ', 'マコト', NULL, NULL, NULL),
(100, 9, 'matched', 'direct',  'DR-00011', '2026-04-22', '2026-04-24', 2, 'TW',    28000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'キムラ', 'マコト', NULL, NULL, NULL),
(101, 9, 'matched', 'direct',  'DR-00012', '2026-04-24', '2026-04-26', 2, 'TW',    28000, 2, 0, NULL, 1, 'cancelled', NULL, NULL, 'キムラ', 'マコト', NULL, NULL, NULL),
(102, 9, 'matched', 'direct',  'DR-00013', '2026-04-26', '2026-04-28', 2, 'TW',    28000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'キムラ', 'マコト', NULL, NULL, NULL),
(103, 9, 'matched', 'direct',  'DR-00014', '2026-04-28', '2026-04-30', 2, 'TW',    28000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'キムラ', 'マコト', NULL, NULL, NULL),

-- R-02: 高額予約（100,000円超/泊 — 宿泊税上限テスト）
(104, 17, 'matched', 'direct',  'DR-00015', '2026-04-20', '2026-04-22', 2, 'LR', 110000, 2, 0, NULL, 3, 'confirmed', NULL, NULL, 'オオタ', 'チヒロ', 'VIP。最上階スイート', NULL, NULL),
(105, 25, 'matched', 'phone',   'PH-00005', '2026-04-25', '2026-04-27', 2, 'LR', 120000, 2, 0, NULL, 3, 'confirmed', NULL, NULL, 'イシカワ', 'ユミ', 'VIP対応', NULL, NULL),
(106,  5, 'matched', 'direct',  'DR-00016', '2026-05-01', '2026-05-03', 2, 'LR', 130000, 2, 0, NULL, 3, 'confirmed', NULL, NULL, 'ヨシダ', 'ショウタ', NULL, NULL, NULL),

-- R-03: 低額予約（1000円未満/泊 — 宿泊税0円テスト）
(107, 72, 'pending', 'booking', 'BK-00020', '2026-04-20', '2026-04-21', 1, 'SW',    800, 1, 0, NULL, 1, 'confirmed', NULL, NULL, 'Nakamura', 'Riku', 'ポイント利用特価', NULL, NULL),
(108, 73, 'pending', 'booking', 'BK-00021', '2026-04-22', '2026-04-23', 1, 'SW',    500, 1, 0, NULL, 1, 'confirmed', NULL, NULL, 'Kobayashi', 'Mei', NULL, NULL, NULL),
(109, 74, 'pending', 'booking', 'BK-00022', '2026-04-24', '2026-04-25', 1, 'SW',    900, 1, 0, NULL, 1, 'confirmed', NULL, NULL, 'Kato', 'Sota', NULL, NULL, NULL),

-- K-01: 子供あり・child_amount入力済み（10件）
(110,  2, 'matched', 'jalan',   'JL-00019', '2026-04-14', '2026-04-16', 2, 'TW',    34000, 2, 1, 5000, 2, 'confirmed', NULL, NULL, 'ナカムラ', 'ミサキ', NULL, NULL, NULL),
(111, 23, 'matched', 'rakuten', 'RK-00014', '2026-04-16', '2026-04-18', 2, 'TW',    34000, 2, 1, 4000, 2, 'confirmed', NULL, NULL, 'ムラカミ', 'マリコ', NULL, NULL, NULL),
(112, 26, 'matched', 'jalan',   'JL-00020', '2026-04-18', '2026-04-20', 2, 'STW',  48000, 2, 2, 8000, 3, 'confirmed', NULL, NULL, 'タナカ', 'タロウ', NULL, NULL, NULL),
(113,  8, 'matched', 'booking', 'BK-00023', '2026-04-20', '2026-04-22', 2, 'TW',    32000, 2, 1, 3000, 1, 'confirmed', NULL, NULL, 'Inoue', 'Sakura', NULL, NULL, NULL),
(114, 14, 'matched', 'rakuten', 'RK-00015', '2026-04-22', '2026-04-24', 2, 'STW',  46000, 2, 1, 6000, 2, 'confirmed', NULL, NULL, 'オカダ', 'ヨウコ', NULL, NULL, NULL),
(115, 42, 'matched', 'jalan',   'JL-00021', '2026-04-24', '2026-04-26', 2, 'TW',    34000, 2, 1, 5000, 3, 'confirmed', NULL, NULL, 'ミヤザキ', 'マユ', NULL, NULL, NULL),
(116, 12, 'matched', 'direct',  'DR-00017', '2026-04-26', '2026-04-28', 2, 'TW',    32000, 2, 1, 4000, 2, 'confirmed', NULL, NULL, 'サイトウ', 'メグミ', NULL, NULL, NULL),
(117, 44, 'matched', 'phone',   'PH-00006', '2026-04-28', '2026-04-30', 2, 'STW',  46000, 2, 1, 5000, 1, 'confirmed', NULL, NULL, 'コマツ', 'リエ', NULL, NULL, NULL),
(118, 46, 'matched', 'jalan',   'JL-00022', '2026-05-01', '2026-05-03', 2, 'TW',    34000, 2, 1, 3500, 2, 'confirmed', NULL, NULL, 'キクチ', 'ハルカ', NULL, NULL, NULL),
(119, 50, 'matched', 'rakuten', 'RK-00016', '2026-05-03', '2026-05-05', 2, 'STW',  30000, 2, 1, 4500, 3, 'confirmed', NULL, NULL, 'ヒラノ', 'ユイ', NULL, NULL, NULL),

-- K-02: 子供あり・child_amount未入力（5件）
(120,  3, 'matched', 'jalan',   'JL-00023', '2026-04-15', '2026-04-17', 2, 'TW',    30000, 2, 1, NULL, 2, 'confirmed', NULL, NULL, 'コバヤシ', 'ダイスケ', NULL, NULL, NULL),
(121, 19, 'matched', 'rakuten', 'RK-00017', '2026-04-19', '2026-04-21', 2, 'STW',  26000, 2, 1, NULL, 1, 'confirmed', NULL, NULL, 'フジイ', 'ミキ', NULL, NULL, NULL),
(122, 32, 'matched', 'booking', 'BK-00024', '2026-04-23', '2026-04-25', 2, 'TW',    30000, 2, 1, NULL, 1, 'confirmed', NULL, NULL, 'Fukuda', 'Momoko', NULL, NULL, NULL),
(123, 40, 'matched', 'jalan',   'JL-00024', '2026-04-27', '2026-04-29', 2, 'STW',  44000, 2, 1, NULL, 1, 'confirmed', NULL, NULL, 'マルヤマ', 'サオリ', NULL, NULL, NULL),
(124, 48, 'matched', 'rakuten', 'RK-00018', '2026-05-02', '2026-05-04', 2, 'TW',    30000, 2, 2, NULL, 2, 'confirmed', NULL, NULL, 'マツダ', 'アミ', NULL, NULL, NULL),

-- D-02/D-03: OTA事前決済（15件じゃらん・楽天 + 10件Booking）
(125, 38, 'matched', 'jalan',   'JL-00025', '2026-04-12', '2026-04-14', 2, 'SW',  18000, 1, 0, NULL, 2, 'confirmed', 'ota_prepaid', NULL, 'ナカジマ', 'アオイ', NULL, NULL, NULL),
(126, 21, 'matched', 'jalan',   'JL-00026', '2026-04-14', '2026-04-16', 2, 'TW',    30000, 2, 0, NULL, 1, 'confirmed', 'ota_prepaid', NULL, 'ゴトウ', 'アヤ', NULL, NULL, NULL),
(127, 30, 'matched', 'jalan',   'JL-00027', '2026-04-17', '2026-04-19', 2, 'SW',  18000, 1, 0, NULL, 2, 'confirmed', 'ota_prepaid', NULL, 'アオキ', 'リナ', NULL, NULL, NULL),
(128, 41, 'matched', 'jalan',   'JL-00028', '2026-04-22', '2026-04-24', 2, 'STW',  28000, 2, 0, NULL, 1, 'confirmed', 'ota_prepaid', NULL, 'ヨコヤマ', 'マサキ', NULL, NULL, NULL),
(129, 43, 'matched', 'jalan',   'JL-00029', '2026-04-26', '2026-04-28', 2, 'TW',    30000, 2, 0, NULL, 2, 'confirmed', 'ota_prepaid', NULL, 'オオノ', 'テツヤ', NULL, NULL, NULL),
(130, 31, 'matched', 'rakuten', 'RK-00019', '2026-04-13', '2026-04-15', 2, 'STW',  28000, 2, 0, NULL, 2, 'confirmed', 'ota_prepaid', NULL, 'ニシムラ', 'ヒロシ', NULL, NULL, NULL),
(131, 39, 'matched', 'rakuten', 'RK-00020', '2026-04-16', '2026-04-18', 2, 'SW',  18000, 1, 0, NULL, 1, 'confirmed', 'ota_prepaid', NULL, 'ウエダ', 'シンタロウ', NULL, NULL, NULL),
(132, 47, 'matched', 'rakuten', 'RK-00021', '2026-04-19', '2026-04-21', 2, 'TW',    32000, 2, 0, NULL, 3, 'confirmed', 'ota_prepaid', NULL, 'ノグチ', 'オサム', NULL, NULL, NULL),
(133, 49, 'matched', 'rakuten', 'RK-00022', '2026-04-23', '2026-04-25', 2, 'STW',  26000, 1, 0, NULL, 1, 'confirmed', 'ota_prepaid', NULL, 'アライ', 'ユウキ', NULL, NULL, NULL),
(134, 76, 'matched', 'rakuten', 'RK-00023', '2026-04-28', '2026-04-30', 2, 'TW',    30000, 2, 0, NULL, 2, 'confirmed', 'ota_prepaid', NULL, 'ササキ', 'ケイコ', NULL, NULL, NULL),
(135, 51, 'matched', 'booking', 'BK-00025', '2026-04-16', '2026-04-18', 2, 'TW',    32000, 2, 0, NULL, 1, 'confirmed', 'ota_prepaid', NULL, 'Smith', 'John', NULL, NULL, NULL),
(136, 54, 'matched', 'booking', 'BK-00026', '2026-04-18', '2026-04-20', 2, 'SW',  17500, 1, 0, NULL, 1, 'confirmed', 'ota_prepaid', NULL, 'Wang', 'Lei', NULL, NULL, NULL),
(137, 55, 'matched', 'booking', 'BK-00027', '2026-04-22', '2026-04-24', 2, 'STW',  26000, 2, 0, NULL, 1, 'confirmed', 'ota_prepaid', NULL, 'Brown', 'Sarah', NULL, NULL, NULL),
(138, 58, 'matched', 'booking', 'BK-00028', '2026-04-25', '2026-04-27', 2, 'TW',    30000, 2, 0, NULL, 2, 'confirmed', 'ota_prepaid', NULL, 'Lim', 'Jia Wei', NULL, NULL, NULL),
(139, 60, 'matched', 'booking', 'BK-00029', '2026-04-28', '2026-04-30', 2, 'STW',  44000, 2, 0, NULL, 1, 'confirmed', 'ota_prepaid', NULL, 'Mueller', 'Hans', NULL, NULL, NULL),
(140, 52, 'matched', 'booking', 'BK-00030', '2026-05-01', '2026-05-03', 2, 'TW',    30000, 2, 0, NULL, 1, 'confirmed', 'ota_prepaid', NULL, 'Chen', 'Wei', NULL, NULL, NULL),
(141, 56, 'matched', 'booking', 'BK-00031', '2026-05-04', '2026-05-06', 2, 'SW',  17000, 1, 0, NULL, 1, 'confirmed', 'ota_prepaid', NULL, 'Taylor', 'James', NULL, NULL, NULL),
(142, 59, 'matched', 'booking', 'BK-00032', '2026-05-07', '2026-05-09', 2, 'STW',  26000, 2, 0, NULL, 1, 'confirmed', 'ota_prepaid', NULL, 'Dupont', 'Marie', NULL, NULL, NULL),
(143, 53, 'matched', 'booking', 'BK-00033', '2026-05-10', '2026-05-12', 2, 'STW',  44000, 2, 0, NULL, 1, 'confirmed', 'ota_prepaid', NULL, 'Kim', 'Minjun', NULL, NULL, NULL),
(144, 65, 'matched', 'booking', 'BK-00034', '2026-05-14', '2026-05-16', 2, 'TW',    30000, 2, 0, NULL, 2, 'confirmed', 'ota_prepaid', NULL, 'Anderson', 'Emma', NULL, NULL, NULL),

-- 法人未来分（月次: CP-00021〜, 都度: CP-00025〜）
(145, 33, 'matched', 'corporate','CP-00021','2026-04-14', '2026-04-16', 2, 'SW',  16000, 1, 0, NULL, 1, 'confirmed', 'corporate', 1, 'ハラ', 'カズヤ', NULL, NULL, NULL),
(146, 37, 'matched', 'corporate','CP-00022','2026-04-16', '2026-04-18', 2, 'STW',  24000, 1, 0, NULL, 1, 'confirmed', 'corporate', 2, 'ワダ', 'ヒデキ', NULL, NULL, NULL),
(147, 29, 'matched', 'corporate','CP-00023','2026-04-20', '2026-04-22', 2, 'SW',  16000, 1, 0, NULL, 1, 'confirmed', 'corporate', 3, 'エンドウ', 'リョウ', NULL, NULL, NULL),
(148, 20, 'matched', 'corporate','CP-00025','2026-04-18', '2026-04-20', 2, 'TW',    28000, 2, 0, NULL, 1, 'confirmed', 'corporate', 4, 'オカモト', 'カズキ', NULL, NULL, NULL),
(149, 35, 'matched', 'corporate','CP-00026','2026-04-22', '2026-04-24', 2, 'SW',  16000, 1, 0, NULL, 1, 'confirmed', 'corporate', 5, 'タケウチ', 'リュウ', NULL, NULL, NULL),

-- その他通常未来予約（残り26件: 150-174）一般OTA
(150,  4, 'matched', 'jalan',   'JL-00030', '2026-04-11', '2026-04-13', 2, 'SW',  18000, 1, 0, NULL, 2, 'confirmed', NULL, NULL, 'カトウ', 'ユウコ', NULL, NULL, NULL),
(151, 10, 'matched', 'rakuten', 'RK-00024', '2026-04-12', '2026-04-14', 2, 'TW',    32000, 2, 0, NULL, 3, 'confirmed', NULL, NULL, 'ハヤシ', 'マユミ', NULL, NULL, NULL),
(152, 13, 'matched', 'booking', 'BK-00035', '2026-04-13', '2026-04-15', 2, 'STW',  26000, 1, 0, NULL, 1, 'confirmed', NULL, NULL, 'Fujita', 'Takashi', NULL, NULL, NULL),
(153, 16, 'matched', 'jalan',   'JL-00031', '2026-04-14', '2026-04-16', 2, 'SW',  18000, 1, 0, NULL, 1, 'confirmed', NULL, NULL, 'イシイ', 'ユウ', NULL, NULL, NULL),
(154, 18, 'matched', 'agoda',   'AG-00011', '2026-04-16', '2026-04-18', 2, 'TW',    32000, 2, 0, NULL, 2, 'confirmed', NULL, NULL, 'Miura', 'Tsubasa', NULL, NULL, NULL),
(155, 24, 'matched', 'expedia', 'EX-00007', '2026-04-18', '2026-04-20', 2, 'STW',  44000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'Kondo', 'Daichi', NULL, NULL, NULL),
(156, 27, 'matched', 'jalan',   'JL-00032', '2026-04-20', '2026-04-22', 2, 'SW',  18000, 1, 0, NULL, 1, 'confirmed', NULL, NULL, 'タナカ', 'タロウ', NULL, NULL, NULL),
(157, 28, 'matched', 'rakuten', 'RK-00025', '2026-04-22', '2026-04-24', 2, 'STW',  28000, 2, 0, NULL, 2, 'confirmed', NULL, NULL, 'タカダ', 'エミ', NULL, NULL, NULL),
(158, 77, 'matched', 'jalan',   'JL-00033', '2026-04-24', '2026-04-26', 2, 'TW',    30000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'ナカタ', 'アケミ', NULL, NULL, NULL),
(159, 78, 'matched', 'booking', 'BK-00036', '2026-04-26', '2026-04-28', 2, 'SW',  17000, 1, 0, NULL, 1, 'confirmed', NULL, NULL, 'Morita', 'Yuka', NULL, NULL, NULL),
(160, 80, 'matched', 'phone',   'PH-00007', '2026-04-28', '2026-04-30', 2, 'STW',  44000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'カワグチ', 'ダイスケ', NULL, NULL, NULL),
(161, 45, 'matched', 'jalan',   'JL-00034', '2026-05-01', '2026-05-03', 2, 'TW',    30000, 2, 0, NULL, 2, 'confirmed', NULL, NULL, 'クボタ', 'マサト', NULL, NULL, NULL),
(162, 22, 'matched', 'rakuten', 'RK-00026', '2026-05-03', '2026-05-05', 2, 'SW',  18000, 1, 0, NULL, 1, 'confirmed', NULL, NULL, 'ハセガワ', 'マナブ', NULL, NULL, NULL),
(163, 75, 'pending', 'booking', 'BK-00037', '2026-05-05', '2026-05-07', 2, 'STW',  26000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'Yoshida', 'Mio', NULL, NULL, NULL),
(164,  7, 'matched', 'jalan',   'JL-00035', '2026-05-07', '2026-05-09', 2, 'SW',  18000, 1, 0, NULL, 2, 'confirmed', NULL, NULL, 'マツモト', 'ケンイチ', NULL, NULL, NULL),
(165, 11, 'matched', 'agoda',   'AG-00012', '2026-05-09', '2026-05-11', 2, 'TW',    32000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'Shimizu', 'Takuya', NULL, NULL, NULL),
(166, 15, 'matched', 'expedia', 'EX-00008', '2026-05-11', '2026-05-13', 2, 'STW',  44000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'Maeda', 'Koji', NULL, NULL, NULL),
(167,  6, 'matched', 'jalan',   'JL-00036', '2026-05-13', '2026-05-15', 2, 'TW',    30000, 2, 0, NULL, 2, 'confirmed', NULL, NULL, 'ヤマモト', 'ナオミ', NULL, NULL, NULL),
(168,  8, 'matched', 'rakuten', 'RK-00027', '2026-05-15', '2026-05-17', 2, 'STW',  28000, 2, 0, NULL, 3, 'confirmed', NULL, NULL, 'イノウエ', 'サクラ', NULL, NULL, NULL),
(169, 57, 'matched', 'booking', 'BK-00038', '2026-05-17', '2026-05-19', 2, 'TW',    30000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'Srisai', 'Napat', NULL, NULL, NULL),
(170, 64, 'pending', 'agoda',   'AG-00013', '2026-05-19', '2026-05-21', 2, 'SW',  17000, 1, 0, NULL, 1, 'confirmed', NULL, NULL, 'Patel', 'Ravi', NULL, NULL, NULL),
(171, 66, 'pending', 'booking', 'BK-00039', '2026-05-21', '2026-05-23', 2, 'STW',  26000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'Sato', 'Yuki', NULL, NULL, NULL),
(172, 34, 'matched', 'jalan',   'JL-00037', '2026-05-23', '2026-05-25', 2, 'TW',    30000, 2, 0, NULL, 2, 'confirmed', NULL, NULL, 'オガワ', 'マイ', NULL, NULL, NULL),
(173, 36, 'matched', 'rakuten', 'RK-00028', '2026-05-25', '2026-05-27', 2, 'SW',  18000, 1, 0, NULL, 1, 'confirmed', NULL, NULL, 'カネコ', 'ミホ', NULL, NULL, NULL),
(174, 63, 'pending', 'expedia', 'EX-00009', '2026-05-28', '2026-05-30', 2, 'STW',  44000, 2, 0, NULL, 1, 'confirmed', NULL, NULL, 'Nguyen', 'Hoa', NULL, NULL, NULL);

-- ============================================================
-- 7. 部屋アサイン
-- ============================================================
-- 新room_id: 1=202(STW), 2=205(STW), 3=206(LR), 4=208(STW), 5=210(SW)
--            6=301(STW), 7=302(TW), 8=303(STW), 9=305(STW), 10=306(LR)
--            11=307(STW), 12=308(TW), 13=309(STW), 14=310(TW)
--            15=401(STW), 16=402(STW), 17=403(STW), 18=405(STW), 19=406(LR)
--            20=407(STW), 21=408(STW), 22=409(STW), 23=410(STW)
-- ============================================================
-- 滞在中（active）
INSERT INTO room_assignments (reservation_id, room_id, check_in_date, check_out_date, status) VALUES
( 1, 18, '2026-04-08', '2026-04-12', 'active'),   -- 405 STW
( 2,  3, '2026-04-09', '2026-04-11', 'active'),   -- 206 LR
( 3,  6, '2026-04-07', '2026-04-11', 'active'),   -- 301 STW
( 4,  5, '2026-04-09', '2026-04-12', 'active'),   -- 210 SW
( 5,  8, '2026-04-10', '2026-04-13', 'active'),   -- 303 STW
( 6, 15, '2026-04-09', '2026-04-11', 'active'),   -- 401 STW
( 7,  1, '2026-04-08', '2026-04-11', 'active'),   -- 202 STW
( 8, 19, '2026-04-09', '2026-04-12', 'active'),   -- 406 LR
( 9,  2, '2026-04-08', '2026-04-11', 'active'),   -- 205 STW
(10, 16, '2026-04-09', '2026-04-11', 'active'),   -- 402 STW

-- CO予定（active → 今日COなのでまだactive）
(16, 10, '2026-04-08', '2026-04-10', 'active'),   -- 306 LR
(17, 17, '2026-04-09', '2026-04-10', 'active'),   -- 403 STW
(18, 20, '2026-04-07', '2026-04-10', 'active'),   -- 407 STW
(19,  4, '2026-04-09', '2026-04-10', 'active'),   -- 208 STW

-- CI予定のうちアサイン済み（4件、1件は未アサイン: 予約14）
(11,  7, '2026-04-10', '2026-04-12', 'active'),   -- 302 TW
(12, 21, '2026-04-10', '2026-04-14', 'active'),   -- 408 STW
(13,  4, '2026-04-10', '2026-04-12', 'active'),   -- 208 STW ※COと同日（実運用ではCO後にCI）
(15,  9, '2026-04-10', '2026-04-13', 'active'),   -- 305 STW

-- 過去分（released: 代表20件程度）
(20,  1, '2026-03-01', '2026-03-03', 'released'),  -- 202
(21,  6, '2026-03-02', '2026-03-04', 'released'),  -- 301
(22, 15, '2026-03-03', '2026-03-05', 'released'),  -- 401
(23,  2, '2026-03-05', '2026-03-07', 'released'),  -- 205
(24,  7, '2026-03-07', '2026-03-09', 'released'),  -- 302
(25,  4, '2026-03-08', '2026-03-10', 'released'),  -- 208
(26, 14, '2026-03-10', '2026-03-12', 'released'),  -- 310
(27,  1, '2026-03-12', '2026-03-14', 'released'),  -- 202
(28,  8, '2026-03-13', '2026-03-15', 'released'),  -- 303
(29, 16, '2026-03-14', '2026-03-16', 'released'),  -- 402
(30,  9, '2026-03-15', '2026-03-18', 'released'),  -- 305
(31,  2, '2026-03-16', '2026-03-17', 'released'),  -- 205
(32, 15, '2026-03-18', '2026-03-20', 'released'),  -- 401
(33,  4, '2026-03-19', '2026-03-21', 'released'),  -- 208
(34,  6, '2026-03-20', '2026-03-22', 'released'),  -- 301
(35, 19, '2026-03-21', '2026-03-23', 'released'),  -- 406

-- 部屋移動ケース
(78,  7, '2026-03-15', '2026-03-17', 'released'),  -- Mueller: 302 TW
(79, 14, '2026-03-20', '2026-03-23', 'released'),  -- Garcia: 310 TW

-- 未来分アサイン済み
(95, 11, '2026-04-15', '2026-04-16', 'active'),  -- 分割予約① 307 STW
(96, 11, '2026-04-16', '2026-04-17', 'active'),  -- 分割予約②（同じ部屋）
(97, 11, '2026-04-17', '2026-04-18', 'active'),  -- 分割予約③
(98, 11, '2026-04-18', '2026-04-19', 'active'),  -- 分割予約④
(99, 13, '2026-04-20', '2026-04-22', 'active'),  -- 連結予約① 309 STW
(100,13, '2026-04-22', '2026-04-24', 'active'),  -- 連結予約②
(102,13, '2026-04-26', '2026-04-28', 'active'),  -- 連結予約④（③はキャンセル）
(103,13, '2026-04-28', '2026-04-30', 'active'),  -- 連結予約⑤
(104, 3, '2026-04-20', '2026-04-22', 'active'),  -- 高額LR 206
(105,10, '2026-04-25', '2026-04-27', 'active'),  -- 高額LR 306
(110, 7, '2026-04-14', '2026-04-16', 'active'),  -- 302 TW
(111, 8, '2026-04-16', '2026-04-18', 'active'),  -- 303 STW
(150, 4, '2026-04-11', '2026-04-13', 'active'),  -- 208 STW
(151, 6, '2026-04-12', '2026-04-14', 'active'),  -- 301 STW
(152,15, '2026-04-13', '2026-04-15', 'active'),  -- 401 STW
(153, 1, '2026-04-14', '2026-04-16', 'active'),  -- 202 STW
(154, 9, '2026-04-16', '2026-04-18', 'active'),  -- 305 STW
(155,22, '2026-04-18', '2026-04-20', 'active');   -- 409 STW

-- ============================================================
-- 8. 連結予約
-- ============================================================

-- P-01: 分割予約セット①（渡辺健太の4連泊）
INSERT INTO guest_links (group_id, reservation_id, sequence, status) VALUES
('GRP-WATANABE-001', 95, 1, 'active'),
('GRP-WATANABE-001', 96, 2, 'active'),
('GRP-WATANABE-001', 97, 3, 'active'),
('GRP-WATANABE-001', 98, 4, 'active');

-- P-02: 連結予約の穴セット（木村誠の10泊、3件目がキャンセル→gap）
INSERT INTO guest_links (group_id, reservation_id, sequence, status, gap_handling) VALUES
('GRP-KIMURA-001',  99, 1, 'active',    NULL),
('GRP-KIMURA-001', 100, 2, 'active',    NULL),
('GRP-KIMURA-001', 101, 3, 'gap',       'room_blocked'),
('GRP-KIMURA-001', 102, 4, 'active',    NULL),
('GRP-KIMURA-001', 103, 5, 'active',    NULL);

-- ============================================================
-- 9. 売上明細（reservation_charges）代表分
-- ============================================================

-- 滞在中の予約（1泊1行）
INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status) VALUES
-- 予約1: 渡辺健太 4泊 STW
(1, '2026-04-08', 'room', 'デラックス（朝食付き）', 20000, 1818, 0, 'active'),
(1, '2026-04-09', 'room', 'デラックス（朝食付き）', 20000, 1818, 0, 'active'),
(1, '2026-04-10', 'room', 'デラックス（朝食付き）', 20000, 1818, 0, 'active'),
(1, '2026-04-11', 'room', 'デラックス（朝食付き）', 20000, 1818, 0, 'active'),
-- 予約2: 吉田翔太 2泊 LR
(2, '2026-04-09', 'room', 'スイート（2食付き）', 35000, 3182, 0, 'active'),
(2, '2026-04-10', 'room', 'スイート（2食付き）', 35000, 3182, 0, 'active'),
-- 予約3: 木村誠 4泊 twin
(3, '2026-04-07', 'room', 'ツイン（朝食付き）', 14000, 1273, 0, 'active'),
(3, '2026-04-08', 'room', 'ツイン（朝食付き）', 14000, 1273, 0, 'active'),
(3, '2026-04-09', 'room', 'ツイン（朝食付き）', 14000, 1273, 0, 'active'),
(3, '2026-04-10', 'room', 'ツイン（朝食付き）', 14000, 1273, 0, 'active'),
-- 予約4: 松本健一 3泊 SW
(4, '2026-04-09', 'room', 'シングル（素泊まり）', 8000, 727, 0, 'active'),
(4, '2026-04-10', 'room', 'シングル（素泊まり）', 8000, 727, 0, 'active'),
(4, '2026-04-11', 'room', 'シングル（素泊まり）', 8000, 727, 0, 'active');

-- ノーショー料金（P-05: 初泊分）
INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status) VALUES
(90, '2026-03-25', 'no_show_fee', 'ノーショー料金（初泊分）', 8500, 773, 0, 'active'),
(91, '2026-03-28', 'no_show_fee', 'ノーショー料金（初泊分）', 15000, 1364, 0, 'active'),
(92, '2026-04-01', 'no_show_fee', 'ノーショー料金（初泊分）', 12000, 1091, 0, 'active'),
(93, '2026-04-05', 'no_show_fee', 'ノーショー料金（初泊分）', 8500, 773, 0, 'active'),
(94, '2026-04-08', 'no_show_fee', 'ノーショー料金（初泊分）', 15000, 1364, 0, 'active');

-- 途中退室のキャンセル料（P-03）
INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status) VALUES
-- Mueller: 4泊予約で2泊で退室。3・4泊目をキャンセル料として
(78, '2026-03-15', 'room', 'ツイン（素泊まり）', 14000, 1273, 0, 'active'),
(78, '2026-03-16', 'room', 'ツイン（素泊まり）', 14000, 1273, 0, 'active'),
(78, '2026-03-17', 'cancel_fee', 'キャンセル料（3泊目）', 14000, 1273, 0, 'active'),
(78, '2026-03-18', 'cancel_fee', 'キャンセル料（4泊目）', 14000, 1273, 0, 'waived'),
-- Garcia: 4泊予約で3泊で退室。4泊目をキャンセル料
(79, '2026-03-20', 'room', 'デラックス（素泊まり）', 20000, 1818, 0, 'active'),
(79, '2026-03-21', 'room', 'デラックス（素泊まり）', 20000, 1818, 0, 'active'),
(79, '2026-03-22', 'room', 'デラックス（素泊まり）', 20000, 1818, 0, 'active'),
(79, '2026-03-23', 'cancel_fee', 'キャンセル料（4泊目）', 20000, 1818, 0, 'active');

-- ============================================================
-- 10. TL受信ログ（テスト用）
-- ============================================================
INSERT INTO tl_import_logs (received_at, reservation_no, channel, parse_status, reservation_id) VALUES
('2026-04-10 09:00:00', 'JL-00003', 'jalan',   'success', 11),
('2026-04-10 09:05:00', 'BK-00003', 'booking', 'success', 12),
('2026-04-10 09:10:00', 'RK-00002', 'rakuten', 'success', 13),
('2026-04-10 09:15:00', 'BK-00004', 'booking', 'success', 14),
('2026-04-10 09:20:00', 'EX-00001', 'expedia', 'success', 15);

-- TLエラーログ（アラートテスト用）
INSERT INTO tl_import_logs (received_at, reservation_no, channel, parse_status, error_message) VALUES
('2026-04-10 08:30:00', 'XX-00123', 'unknown', 'error', 'XML parse failed: invalid root element'),
('2026-04-10 07:45:00', 'XX-00122', 'unknown', 'error', 'channel mapping not found');

-- ============================================================
-- 完了
-- ============================================================
SET FOREIGN_KEY_CHECKS = 1;
