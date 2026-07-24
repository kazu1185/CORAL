-- PMS Database Schema
-- Based on: PMS設計ドキュメント v1.4 + 各引き継ぎ書
-- Database: pms_db (utf8mb4_unicode_ci)

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- マスタテーブル
-- ============================================================

-- 部屋タイプマスタ
CREATE TABLE room_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type_code VARCHAR(20) NOT NULL UNIQUE COMMENT 'single/double/twin/deluxe/suite',
    type_name VARCHAR(50) NOT NULL COMMENT '表示名',
    max_adults INT NOT NULL DEFAULT 2 COMMENT '大人最大人数',
    max_occupancy INT NOT NULL DEFAULT 3 COMMENT '最大定員（大人+子供）',
    description TEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '有効フラグ（0=論理削除）',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 部屋マスタ
CREATE TABLE rooms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_number VARCHAR(10) NOT NULL UNIQUE COMMENT '部屋番号（例: 301）',
    floor INT NOT NULL COMMENT '階数',
    room_type_id INT NOT NULL,
    status ENUM('available','out_of_order','out_of_service') NOT NULL DEFAULT 'available',
    sort_order INT NOT NULL DEFAULT 0 COMMENT 'フロア内表示順',
    grid_row INT NULL COMMENT 'グリッド行位置（1-based）',
    grid_col INT NULL COMMENT 'グリッド列位置（1-based）',
    notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (room_type_id) REFERENCES room_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- プランマスタ
CREATE TABLE plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plan_name VARCHAR(100) NOT NULL,
    meal_type ENUM('none','breakfast','dinner','two_meals') NOT NULL DEFAULT 'none',
    breakfast_price INT NOT NULL DEFAULT 0 COMMENT '朝食単価',
    dinner_price INT NOT NULL DEFAULT 0 COMMENT '夕食単価',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 宿泊税ルールマスタ
CREATE TABLE accommodation_tax_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    prefecture_code VARCHAR(2) NOT NULL COMMENT '都道府県コード',
    municipality_code VARCHAR(5) NULL COMMENT '市区町村コード',
    tax_type ENUM('rate','flat') NOT NULL COMMENT 'rate=定率, flat=定額',
    rate DECIMAL(5,4) NULL COMMENT '税率（定率の場合。例: 0.0200 = 2%）',
    round_unit INT NOT NULL DEFAULT 1000 COMMENT '切り捨て単位',
    max_base_amount INT NULL COMMENT '課税標準上限（例: 100000）',
    max_tax_amount INT NULL COMMENT '税額上限（例: 2000）',
    include_consumption_tax TINYINT(1) NOT NULL DEFAULT 1 COMMENT '消費税込みの金額に対して課税するか',
    min_charge INT NOT NULL DEFAULT 0 COMMENT '課税下限額',
    child_exempt TINYINT(1) NOT NULL DEFAULT 1 COMMENT '子供免税フラグ',
    valid_from DATE NOT NULL,
    valid_to DATE NULL COMMENT 'NULLは無期限',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 宿泊税定額制の料金帯（定額制の場合のみ使用）
CREATE TABLE accommodation_tax_flat_brackets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rule_id INT NOT NULL,
    min_amount INT NOT NULL,
    max_amount INT NULL COMMENT 'NULLは上限なし',
    tax_amount INT NOT NULL,
    FOREIGN KEY (rule_id) REFERENCES accommodation_tax_rules(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 法人マスタ
CREATE TABLE corporate_clients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_name VARCHAR(100) NOT NULL,
    billing_address TEXT NULL,
    contact_person VARCHAR(50) NULL,
    contact_email VARCHAR(100) NULL,
    payment_cycle ENUM('monthly','per_stay') NOT NULL DEFAULT 'monthly',
    payment_terms VARCHAR(100) NULL COMMENT '例: 月末締め翌月末払い',
    notes TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 決済方法マスタ
CREATE TABLE payment_methods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    method_name VARCHAR(50) NOT NULL COMMENT '例: 現金, クレジットカード, 電子マネー',
    method_code VARCHAR(20) NOT NULL UNIQUE,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    front_visible TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'フロントモード(iPad)精算パネルに表示するか',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ホテル基本情報
CREATE TABLE hotel_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hotel_name VARCHAR(100) NOT NULL,
    hotel_name_en VARCHAR(100) NULL,
    postal_code VARCHAR(10) NULL,
    address TEXT NULL,
    phone VARCHAR(20) NULL,
    invoice_registration_no VARCHAR(20) NULL COMMENT '適格請求書発行事業者登録番号 T+13桁',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ゲスト管理
-- ============================================================

-- ゲストマスタ
CREATE TABLE guests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guest_code VARCHAR(6) NOT NULL COMMENT '表示用顧客コード（G00001形式）',
    name_kanji VARCHAR(100) NULL COMMENT '氏名（漢字）',
    name_kana VARCHAR(100) NULL COMMENT '氏名（カタカナ）',
    name_romaji VARCHAR(100) NULL COMMENT '氏名（ローマ字）',
    country_code CHAR(2) NOT NULL DEFAULT 'JP' COMMENT 'ISO 3166-1',
    email VARCHAR(100) NULL,
    phone VARCHAR(20) NULL,
    mobile_phone VARCHAR(20) NULL COMMENT '携帯電話番号',
    postal_code VARCHAR(10) NULL COMMENT '郵便番号',
    prefecture VARCHAR(20) NULL COMMENT '都道府県',
    city VARCHAR(50) NULL COMMENT '市区町村',
    address_line VARCHAR(100) NULL COMMENT '番地・建物名',
    gender ENUM('male','female','other','unknown') NULL COMMENT '性別',
    birth_date DATE NULL COMMENT '生年月日',
    company_name VARCHAR(100) NULL COMMENT '会社名（領収書印字用）',
    preferred_language VARCHAR(5) NULL DEFAULT 'ja' COMMENT '優先言語（ja/en/zh/ko等）',
    guest_notes TEXT NULL COMMENT '永続メモ（アレルギー・VIP等）',
    visit_count INT NOT NULL DEFAULT 0 COMMENT 'CO時にインクリメント',
    first_stay_date DATE NULL,
    last_stay_date DATE NULL,
    is_vip TINYINT(1) NOT NULL DEFAULT 0,
    merged_into_guest_id INT NULL COMMENT 'マージ先ゲストID',
    status ENUM('active','merged') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,
    UNIQUE KEY uk_guest_code (guest_code),
    INDEX idx_name_kana (name_kana),
    INDEX idx_name_romaji (name_romaji),
    INDEX idx_phone (phone),
    INDEX idx_mobile_phone (mobile_phone),
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 旧姓管理
CREATE TABLE guest_aliases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guest_id INT NOT NULL,
    name_kanji VARCHAR(100) NULL,
    name_kana VARCHAR(100) NULL,
    name_romaji VARCHAR(100) NULL,
    alias_type ENUM('maiden') NOT NULL DEFAULT 'maiden',
    source VARCHAR(20) NOT NULL DEFAULT 'manual',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guest_id) REFERENCES guests(id),
    INDEX idx_alias_kana (name_kana),
    INDEX idx_alias_romaji (name_romaji)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- マージ履歴
CREATE TABLE guest_merge_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    merged_from_guest_id INT NOT NULL,
    merged_into_guest_id INT NOT NULL,
    merged_by INT NOT NULL,
    merged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- パスポート画像（予約に紐づけて保存）
-- インバウンドは代表者・同行者含め全員分が必要（法的義務）
-- 同行者は画像のみ保存（名前の手入力は不要）
CREATE TABLE reservation_passports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reservation_id INT NOT NULL COMMENT '予約ID',
    is_representative TINYINT(1) NOT NULL DEFAULT 0 COMMENT '代表者フラグ',
    image_path VARCHAR(255) NOT NULL COMMENT '画像ファイルパス（storage/passports/からの相対パス）',
    scanned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'スキャン日時',
    scanned_by INT NULL COMMENT 'スキャンしたスタッフID',
    deleted_at DATETIME NULL COMMENT '論理削除日時',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    FOREIGN KEY (scanned_by) REFERENCES staff(id),
    INDEX idx_reservation_id (reservation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 予約イベント履歴（予約のライフサイクルを記録）
CREATE TABLE reservation_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reservation_id INT NOT NULL COMMENT '予約ID',
    event_type VARCHAR(30) NOT NULL COMMENT 'tl_new/tl_modify/tl_cancel/guest_link/checkin/checkout/room_move',
    event_at DATETIME NOT NULL COMMENT 'イベント発生日時',
    summary VARCHAR(100) NOT NULL COMMENT '表示用テキスト',
    detail TEXT NULL COMMENT 'ホバーカード内容',
    tl_data_id VARCHAR(50) NULL COMMENT 'TL電文のDataID',
    staff_id INT NULL COMMENT '操作したスタッフID',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    INDEX idx_reservation_id (reservation_id),
    INDEX idx_event_at (event_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 予約統合元テーブル（統合された予約の元OTA予約番号を保持）
-- TL通知が統合子の予約番号で来た場合、ここから親予約を辿る
CREATE TABLE reservation_sources (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reservation_id INT NOT NULL COMMENT '統合先の親予約ID（reservations.id）',
    original_reservation_id INT NULL COMMENT '元の予約レコードID（merged化されたreservations.id）',
    reservation_no VARCHAR(50) NOT NULL COMMENT '元のOTA予約番号',
    channel VARCHAR(30) NOT NULL COMMENT '元のチャネル',
    checkin_date DATE NOT NULL COMMENT '元のCI日',
    checkout_date DATE NOT NULL COMMENT '元のCO日',
    amount INT NOT NULL COMMENT '元の予約金額',
    nights INT NOT NULL COMMENT '元の泊数',
    status ENUM('active','cancelled') NOT NULL DEFAULT 'active' COMMENT 'active=有効, cancelled=中日キャンセル等',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    INDEX idx_reservation_no (reservation_no, channel),
    INDEX idx_reservation_id (reservation_id),
    UNIQUE KEY uk_channel_resno (reservation_id, channel, reservation_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- コアテーブル（予約・アサイン・売上）
-- ============================================================

-- 予約マスタ
CREATE TABLE reservations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parent_reservation_id INT NULL COMMENT '複数室予約の親ID（子予約のみセット）',
    room_count INT NOT NULL DEFAULT 1 COMMENT '複数室予約の室数（親予約で使用）',
    room_index INT NULL COMMENT '親内の室番号（1-based、子予約のみセット）',
    guest_id INT NULL COMMENT 'ゲスト紐付け（未紐付けはNULL）',
    guest_match_status ENUM('matched','pending','new_guest') NOT NULL DEFAULT 'pending',
    channel VARCHAR(30) NULL COMMENT 'OTA名（jalan/rakuten/booking等）。統合予約はNULL',
    reservation_no VARCHAR(50) NULL COMMENT 'OTA予約番号',
    booked_at DATETIME NULL COMMENT 'OTA予約日時',
    checkin_date DATE NOT NULL,
    checkout_date DATE NOT NULL,
    nights INT NOT NULL,
    room_type VARCHAR(20) NULL COMMENT '予約時の部屋タイプ（group_parentはNULL）',
    amount INT NOT NULL COMMENT '予約合計額（税込）',
    adult_count INT NOT NULL DEFAULT 1,
    child_count INT NOT NULL DEFAULT 0,
    child_amount INT NULL COMMENT '子供料金合計（フロント手入力）',
    plan_id INT NULL,
    status ENUM('confirmed','checked_in','checked_out','cancelled','no_show','merged','group_parent') NOT NULL DEFAULT 'confirmed',
    payment_method ENUM('cash','card','ota_prepaid','corporate') NULL COMMENT 'CI時にデフォルト設定',
    corporate_id INT NULL,
    tl_last_name VARCHAR(50) NOT NULL COMMENT 'TL原本姓（書き換え不可）',
    tl_first_name VARCHAR(50) NOT NULL COMMENT 'TL原本名（書き換え不可）',
    reservation_notes TEXT NULL COMMENT '今回の滞在メモ',
    actual_checkin_at DATETIME NULL COMMENT '実際のCI日時',
    actual_checkout_at DATETIME NULL COMMENT '実際のCO日時',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,
    FOREIGN KEY (parent_reservation_id) REFERENCES reservations(id),
    FOREIGN KEY (guest_id) REFERENCES guests(id),
    FOREIGN KEY (corporate_id) REFERENCES corporate_clients(id),
    INDEX idx_parent (parent_reservation_id),
    INDEX idx_checkin (checkin_date),
    INDEX idx_checkout (checkout_date),
    INDEX idx_channel (channel),
    INDEX idx_status (status),
    INDEX idx_guest_match (guest_match_status),
    INDEX idx_reservation_channel (reservation_no, channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 売上明細・入金明細（1テーブル統合）
CREATE TABLE reservation_charges (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reservation_id INT NOT NULL,
    date DATE NOT NULL COMMENT '売上行:宿泊日, 入金行:支払日',
    charge_type ENUM('room','cancel_fee','no_show_fee','addon','payment','refund','discount') NOT NULL,
    description VARCHAR(200) NULL COMMENT '摘要（プラン名 or 決済方法名）',
    amount INT NOT NULL COMMENT '金額',
    tax_amount INT NOT NULL DEFAULT 0 COMMENT '消費税額',
    accommodation_tax INT NOT NULL DEFAULT 0 COMMENT '宿泊税額',
    payment_method_id INT NULL COMMENT '入金行の場合のみ',
    status ENUM('active','cancelled','waived') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id),
    INDEX idx_reservation (reservation_id),
    INDEX idx_date (date),
    INDEX idx_type (charge_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- アサイン（部屋割り）
CREATE TABLE room_assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reservation_id INT NOT NULL,
    room_id INT NOT NULL,
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    status ENUM('active','released') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    INDEX idx_room_date (room_id, check_in_date, check_out_date),
    INDEX idx_reservation (reservation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 連結予約グループ
CREATE TABLE guest_links (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id VARCHAR(36) NOT NULL COMMENT 'UUID',
    reservation_id INT NOT NULL,
    sequence INT NOT NULL COMMENT 'グループ内の順番',
    status ENUM('active','cancelled','gap') NOT NULL DEFAULT 'active',
    gap_handling ENUM('room_blocked','checkout_temp') NULL COMMENT '穴の場合の対応方針',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    INDEX idx_group (group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 売上計上
CREATE TABLE revenue_postings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reservation_id INT NOT NULL,
    corporate_id INT NULL,
    posting_date DATE NOT NULL COMMENT '計上日（= CO日）',
    channel VARCHAR(30) NOT NULL,
    total_amount INT NOT NULL,
    status ENUM('posted','cancelled') NOT NULL DEFAULT 'posted',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    FOREIGN KEY (corporate_id) REFERENCES corporate_clients(id),
    INDEX idx_posting_date (posting_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 帳票（領収書・請求書）
-- ============================================================

CREATE TABLE documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    document_number VARCHAR(20) NOT NULL UNIQUE COMMENT '自動採番',
    type ENUM('receipt','invoice') NOT NULL,
    reservation_id INT NULL COMMENT '領収書・都度請求書',
    corporate_id INT NULL COMMENT '月次請求書',
    billing_period_from DATE NULL,
    billing_period_to DATE NULL,
    addressee VARCHAR(100) NOT NULL COMMENT '宛名',
    description VARCHAR(100) NULL COMMENT '但し書き',
    subtotal INT NOT NULL DEFAULT 0,
    tax_amount INT NOT NULL DEFAULT 0,
    accommodation_tax INT NOT NULL DEFAULT 0,
    total INT NOT NULL DEFAULT 0,
    payment_method_id INT NULL,
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    issued_by INT NOT NULL,
    reissue_count INT NOT NULL DEFAULT 0,
    status ENUM('issued','cancelled') NOT NULL DEFAULT 'issued',
    original_document_id INT NULL COMMENT '再発行時の元帳票ID',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    FOREIGN KEY (corporate_id) REFERENCES corporate_clients(id),
    FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE document_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    document_id INT NOT NULL,
    charge_id INT NULL COMMENT 'reservation_charges.id参照',
    date DATE NULL,
    description VARCHAR(200) NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price INT NOT NULL DEFAULT 0,
    tax_amount INT NOT NULL DEFAULT 0,
    accommodation_tax INT NOT NULL DEFAULT 0,
    amount INT NOT NULL DEFAULT 0,
    FOREIGN KEY (document_id) REFERENCES documents(id),
    FOREIGN KEY (charge_id) REFERENCES reservation_charges(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TL受信ログ
-- ============================================================

CREATE TABLE tl_import_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reservation_no VARCHAR(50) NULL,
    channel VARCHAR(30) NULL,
    file_path VARCHAR(255) NULL COMMENT 'XMLアーカイブのパス',
    parse_status ENUM('success','error','duplicate') NOT NULL,
    reservation_id INT NULL COMMENT 'パース成功時に紐付け',
    error_message TEXT NULL,
    INDEX idx_received (received_at),
    INDEX idx_status (parse_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- スタッフ・認証・権限
-- ============================================================

CREATE TABLE staff (
    id INT AUTO_INCREMENT PRIMARY KEY,
    staff_name VARCHAR(50) NOT NULL COMMENT '表示名',
    login_name VARCHAR(50) NOT NULL UNIQUE COMMENT 'ログイン名',
    pin_hash VARCHAR(255) NOT NULL COMMENT 'bcryptハッシュ',
    role ENUM('admin','front_manager','front','housekeeping') NOT NULL,
    must_change_pin TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE permissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    permission_key VARCHAR(50) NOT NULL UNIQUE,
    permission_name VARCHAR(100) NOT NULL COMMENT '表示名',
    category VARCHAR(50) NOT NULL COMMENT 'カテゴリ',
    sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_permissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    role ENUM('admin','front_manager','front','housekeeping') NOT NULL,
    permission_key VARCHAR(50) NOT NULL,
    is_granted TINYINT(1) NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,
    UNIQUE KEY uk_role_perm (role, permission_key),
    FOREIGN KEY (permission_key) REFERENCES permissions(permission_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE staff_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    staff_id INT NOT NULL,
    session_token VARCHAR(255) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (staff_id) REFERENCES staff(id),
    INDEX idx_token (session_token),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE device_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(255) NOT NULL UNIQUE,
    device_name VARCHAR(50) NOT NULL COMMENT '例: 清掃用iPad-1',
    role ENUM('housekeeping') NOT NULL DEFAULT 'housekeeping',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by INT NOT NULL,
    FOREIGN KEY (created_by) REFERENCES staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE system_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(50) NOT NULL UNIQUE,
    setting_value VARCHAR(255) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 操作ログ
CREATE TABLE staff_activity_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    staff_id INT NOT NULL,
    action VARCHAR(50) NOT NULL COMMENT '操作種別',
    target_type VARCHAR(50) NULL COMMENT '対象の種別',
    target_id INT NULL COMMENT '対象のID',
    detail JSON NULL COMMENT '補足情報',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (staff_id) REFERENCES staff(id),
    INDEX idx_staff (staff_id),
    INDEX idx_action (action),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 清掃管理
-- ============================================================

CREATE TABLE housekeeping_status (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id INT NOT NULL,
    date DATE NOT NULL,
    status ENUM('needs_cleaning','cleaning','cleaned','inspection','ready') NOT NULL DEFAULT 'needs_cleaning',
    assigned_staff_id INT NULL,
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    inspected_by INT NULL,
    inspected_at DATETIME NULL,
    notes TEXT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    UNIQUE KEY uk_room_date (room_id, date),
    INDEX idx_date_status (date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 初期データ
-- ============================================================

-- システム設定の初期値
INSERT INTO system_settings (setting_key, setting_value) VALUES
('session_timeout_minutes', '120'),
('pin_min_length', '4'),
('pin_max_length', '6'),
('login_fail_lock_count', '5'),
('login_fail_lock_minutes', '15');

-- 決済方法の初期値（front_visible: カウンターで受ける決済のみフロント表示。OTA事前決済/法人売掛は非表示）
INSERT INTO payment_methods (method_code, method_name, sort_order, front_visible) VALUES
('cash', '現金', 1, 1),
('credit_card', 'クレジットカード', 2, 1),
('e_money', '電子マネー', 3, 1),
('qr_pay', 'QRコード決済', 4, 1),
('ota_prepaid', 'OTA事前決済', 5, 0),
('corporate', '法人売掛', 6, 0);

-- 権限マスタの初期値
INSERT INTO permissions (permission_key, permission_name, category, sort_order) VALUES
('reservation.view', '予約一覧・検索・詳細閲覧', '予約管理', 1),
('reservation.create', '手動予約入力', '予約管理', 2),
('reservation.cancel', '予約のキャンセル処理', '予約管理', 3),
('assign.edit', 'アサインボード操作', 'フロント業務', 10),
('checkin.execute', 'チェックイン処理', 'フロント業務', 11),
('checkout.execute', 'チェックアウト処理', 'フロント業務', 12),
('guest.edit', 'ゲスト紐付け・新規登録・情報編集', 'フロント業務', 13),
('guest.merge', 'ゲストマージ', 'フロント業務', 14),
('receipt.issue', '領収書の発行・再発行', '帳票', 20),
('invoice.issue', '請求書の発行・再発行', '帳票', 21),
('housekeeping.view', '清掃ステータスの閲覧', '清掃管理', 30),
('housekeeping.update', '清掃ステータスの更新', '清掃管理', 31),
('housekeeping.assign', '清掃員への部屋割り当て', '清掃管理', 32),
('report.view', '日計・月計・OTA別集計の閲覧', '売上・レポート', 40),
('report.export', '売上データのCSVエクスポート', '売上・レポート', 41),
('master.rooms', '部屋マスタ・部屋タイプマスタの編集', '設定', 50),
('master.plans', 'プランマスタの編集', '設定', 51),
('master.tax', '宿泊税マスタの編集', '設定', 52),
('master.corporate', '法人マスタの編集', '設定', 53),
('staff.manage', 'スタッフの追加・編集・無効化', '設定', 60),
('staff.pin_reset', '他スタッフのPINリセット', '設定', 61),
('system.session_config', 'セッション有効期限の設定', '設定', 70),
('system.permissions', '権限設定の変更', '設定', 71);

SET FOREIGN_KEY_CHECKS = 1;
