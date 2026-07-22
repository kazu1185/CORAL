-- Migration 003: room_types に is_active カラムを追加
-- 部屋タイプの論理削除に対応（削除しても過去の予約履歴から参照可能にするため）
-- MySQL 8.4 は ADD COLUMN IF NOT EXISTS 未対応のためINFORMATION_SCHEMAで事前チェック

SET @db_name = DATABASE();

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name
  AND TABLE_NAME = 'room_types'
  AND COLUMN_NAME = 'is_active';

SET @sql = IF(@col_exists = 0,
    'ALTER TABLE room_types ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''有効フラグ（0=論理削除）'' AFTER sort_order',
    'SELECT ''Column is_active already exists in room_types'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
