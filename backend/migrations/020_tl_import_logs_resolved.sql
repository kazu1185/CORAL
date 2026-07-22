-- 020: tl_import_logsにresolved_atカラム追加
-- TL取込エラーアラートの解消（自動・手動）を管理するため
-- resolved_at IS NULL → 未解消（ダッシュボードに表示）
-- resolved_at に日時 → 解消済み（非表示）

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='tl_import_logs' AND COLUMN_NAME='resolved_at');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE tl_import_logs ADD COLUMN resolved_at DATETIME NULL DEFAULT NULL AFTER error_message',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- import_typeカラムの存在確認（以前のマイグレーションで追加済みの可能性）
SET @col_exists2 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='tl_import_logs' AND COLUMN_NAME='import_type');
SET @sql2 = IF(@col_exists2 = 0,
    "ALTER TABLE tl_import_logs ADD COLUMN import_type ENUM('new','modify','cancel') NULL AFTER reservation_id",
    'SELECT 1');
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
