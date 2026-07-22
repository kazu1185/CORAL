-- 019: 到着予定時刻カラム追加
-- TL電文には到着時刻情報がないため、スタッフが予約詳細から手入力する。
-- ルームインジケーターのCI予定カードに表示する。

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='estimated_arrival');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE reservations ADD COLUMN estimated_arrival TIME NULL COMMENT ''到着予定時刻（スタッフ手入力）'' AFTER reservation_notes',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
