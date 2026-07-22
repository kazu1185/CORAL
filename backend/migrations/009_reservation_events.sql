-- Migration 009: 予約イベント履歴テーブル + reservations改善
--
-- 目的:
-- 1. 予約に対する全イベント（TL通知・CI/CO・名寄せ等）を履歴として記録
-- 2. TL電文の予約日時（booked_at）をDBに保存し、取込順ではなくこの日時で新旧を判断
-- 3. display_last_name/first_name を削除（guests テーブルから取得に一本化）
-- 4. reservation_no + channel の複合インデックス追加（TL取込時の同一予約検索高速化）

SET @db_name = DATABASE();

-- ============================================================
-- reservation_events テーブル新規作成
-- 予約の全ライフサイクルを記録するイベントログ
-- ============================================================

SELECT COUNT(*) INTO @tbl_exists FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservation_events';
SET @sql = IF(@tbl_exists = 0,
    'CREATE TABLE reservation_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reservation_id INT NOT NULL COMMENT ''予約ID'',
        event_type VARCHAR(30) NOT NULL COMMENT ''tl_new/tl_modify/tl_cancel/guest_link/checkin/checkout/room_move/note_update'',
        event_at DATETIME NOT NULL COMMENT ''イベント発生日時（TL電文はBookingDate+Time、操作はその時刻）'',
        summary VARCHAR(100) NOT NULL COMMENT ''表示用テキスト（例: TL新規予約、名寄せ、CI）'',
        detail TEXT NULL COMMENT ''ホバーカード内容（例: G49203 斉藤直様に結合）'',
        tl_data_id VARCHAR(50) NULL COMMENT ''TL電文の場合のDataID'',
        staff_id INT NULL COMMENT ''操作したスタッフID'',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reservation_id) REFERENCES reservations(id),
        INDEX idx_reservation_id (reservation_id),
        INDEX idx_event_at (event_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- reservations テーブル変更
-- ============================================================

-- === booked_at: TLの予約日時（TravelAgencyBookingDate + Time） ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'booked_at';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE reservations ADD COLUMN booked_at DATETIME NULL COMMENT ''OTA予約日時（TL: TravelAgencyBookingDate+Time）'' AFTER reservation_no',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === display_last_name 削除（guests テーブルから取得に一本化） ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'display_last_name';
SET @sql = IF(@col_exists > 0,
    'ALTER TABLE reservations DROP COLUMN display_last_name',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === display_first_name 削除 ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'display_first_name';
SET @sql = IF(@col_exists > 0,
    'ALTER TABLE reservations DROP COLUMN display_first_name',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === reservation_no + channel 複合インデックス（TL取込時の検索高速化） ===
SELECT COUNT(*) INTO @idx_exists FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND INDEX_NAME = 'idx_reservation_channel';
SET @sql = IF(@idx_exists = 0,
    'ALTER TABLE reservations ADD INDEX idx_reservation_channel (reservation_no, channel)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
