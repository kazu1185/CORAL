-- マイグレーション016: guests に領収書用宛名カラム追加
-- 直接入力で指定した宛名を保存し、次回以降のデフォルト値として使用する

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='guests' AND COLUMN_NAME='receipt_addressee');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN receipt_addressee VARCHAR(100) DEFAULT NULL COMMENT ''領収書用宛名（直接入力時に保存）'' AFTER guest_notes',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
