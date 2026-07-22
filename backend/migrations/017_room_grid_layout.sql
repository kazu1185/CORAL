-- Migration 017: 部屋グリッド配置
--
-- ルームインジケーター画面で実際の部屋配置を再現するため、
-- 各部屋にフロア内でのグリッド座標（行・列）を持たせる。
-- NULLの場合は従来通りsort_order順のauto-fill表示。

SET @db_name = DATABASE();

-- grid_row カラム追加
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'rooms' AND COLUMN_NAME = 'grid_row';
SET @sql = IF(@col_exists = 0,
    "ALTER TABLE rooms ADD COLUMN grid_row INT NULL COMMENT 'グリッド行位置（1-based）'",
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- grid_col カラム追加
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'rooms' AND COLUMN_NAME = 'grid_col';
SET @sql = IF(@col_exists = 0,
    "ALTER TABLE rooms ADD COLUMN grid_col INT NULL COMMENT 'グリッド列位置（1-based）'",
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
