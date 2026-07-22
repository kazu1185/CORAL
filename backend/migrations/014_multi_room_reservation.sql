-- 014: 複数室予約（団体予約）対応
-- 1電文にN室含まれるAgoda/Booking予約を親1件+子N件に分割する
-- 親予約 = OTA予約そのもの（channel, reservation_no保持）
-- 子予約 = 各部屋（独立CI/CO/精算）

-- reservations テーブルに3カラム追加

-- parent_reservation_id: 子予約が親を参照するFK
SET @col1 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='parent_reservation_id');
SET @sql1 = IF(@col1 = 0,
    'ALTER TABLE reservations ADD COLUMN parent_reservation_id INT NULL AFTER id, ADD INDEX idx_parent (parent_reservation_id), ADD FOREIGN KEY fk_parent_reservation (parent_reservation_id) REFERENCES reservations(id)',
    'SELECT 1');
PREPARE stmt1 FROM @sql1; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;

-- room_count: 複数室予約の室数（1室予約は1のまま）
SET @col2 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='room_count');
SET @sql2 = IF(@col2 = 0,
    'ALTER TABLE reservations ADD COLUMN room_count INT NOT NULL DEFAULT 1 AFTER parent_reservation_id',
    'SELECT 1');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- room_index: 親内の室番号（1-based）。子予約のみセット、親・単室予約はNULL
SET @col3 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='room_index');
SET @sql3 = IF(@col3 = 0,
    'ALTER TABLE reservations ADD COLUMN room_index INT NULL AFTER room_count',
    'SELECT 1');
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;

-- room_type を NULL 許可に変更（group_parent は部屋タイプを持たないため）
ALTER TABLE reservations MODIFY COLUMN room_type VARCHAR(20) NULL COMMENT '予約時の部屋タイプ（group_parentはNULL）';

-- status ENUM に group_parent を追加
-- MySQL 8.4 では ALTER COLUMN MODIFY で ENUM値を拡張する
-- 既存の status カラムの型を確認して group_parent が無ければ追加
SET @has_gp = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='status'
    AND COLUMN_TYPE LIKE '%group_parent%');
SET @sql4 = IF(@has_gp = 0,
    "ALTER TABLE reservations MODIFY COLUMN status ENUM('confirmed','checked_in','checked_out','cancelled','no_show','merged','group_parent') NOT NULL DEFAULT 'confirmed'",
    'SELECT 1');
PREPARE stmt4 FROM @sql4; EXECUTE stmt4; DEALLOCATE PREPARE stmt4;
