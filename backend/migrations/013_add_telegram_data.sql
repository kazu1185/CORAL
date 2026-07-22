-- 013: TL電文テキスト（TelegramData）を保存するカラム追加
-- 人間可読形式の全予約情報。予約詳細画面で明細との突合確認に使用。

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='tl_telegram_data');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE reservations ADD COLUMN tl_telegram_data TEXT NULL COMMENT ''TL電文テキスト（確認用）'' AFTER tl_other_info',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
