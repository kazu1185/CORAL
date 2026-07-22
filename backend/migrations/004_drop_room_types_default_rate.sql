-- Migration 004: room_types から default_rate カラムを削除
-- 料金は別途料金マスタテーブルで管理する方針のため不要

SET @db_name = DATABASE();

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name
  AND TABLE_NAME = 'room_types'
  AND COLUMN_NAME = 'default_rate';

SET @sql = IF(@col_exists > 0,
    'ALTER TABLE room_types DROP COLUMN default_rate',
    'SELECT ''Column default_rate does not exist in room_types'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
