-- Migration 005: TL取込用カラム追加
-- reservationsにTL電文の詳細情報を保存するカラムを追加
-- tl_import_logsに電文種別カラムを追加

SET @db_name = DATABASE();

-- === reservations: tl_data_id ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'tl_data_id';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE reservations ADD COLUMN tl_data_id VARCHAR(50) NULL COMMENT ''TL電文ID（重複検出用）''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === reservations: tl_plan_name ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'tl_plan_name';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE reservations ADD COLUMN tl_plan_name VARCHAR(200) NULL COMMENT ''TLプラン名''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === reservations: tl_plan_code ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'tl_plan_code';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE reservations ADD COLUMN tl_plan_code VARCHAR(50) NULL COMMENT ''TLプランコード''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === reservations: tl_settlement_type ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'tl_settlement_type';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE reservations ADD COLUMN tl_settlement_type VARCHAR(50) NULL COMMENT ''決済区分（ota_prepaid/card/on_site等）''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === reservations: tl_amount_claimed ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'tl_amount_claimed';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE reservations ADD COLUMN tl_amount_claimed INT NULL COMMENT ''宿泊者請求額（0=OTA精算済）''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === reservations: tl_commission ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'tl_commission';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE reservations ADD COLUMN tl_commission INT NULL COMMENT ''コミッション額（Booking.comのみ）''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === reservations: tl_rate_type ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'tl_rate_type';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE reservations ADD COLUMN tl_rate_type VARCHAR(20) NULL COMMENT ''料金方式（RoomRate/PersonalRate）''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === reservations: tl_other_info ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'tl_other_info';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE reservations ADD COLUMN tl_other_info TEXT NULL COMMENT ''OtherServiceInformation全文''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === reservations: INDEX on tl_data_id ===
SELECT COUNT(*) INTO @idx_exists FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND INDEX_NAME = 'idx_tl_data_id';
SET @sql = IF(@idx_exists = 0,
    'ALTER TABLE reservations ADD INDEX idx_tl_data_id (tl_data_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === reservations: INDEX on reservation_no ===
SELECT COUNT(*) INTO @idx_exists FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND INDEX_NAME = 'idx_reservation_no';
SET @sql = IF(@idx_exists = 0,
    'ALTER TABLE reservations ADD INDEX idx_reservation_no (reservation_no)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === tl_import_logs: import_type ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'tl_import_logs' AND COLUMN_NAME = 'import_type';
SET @sql = IF(@col_exists = 0,
    "ALTER TABLE tl_import_logs ADD COLUMN import_type ENUM('new','modify','cancel') NULL COMMENT '電文種別'",
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
