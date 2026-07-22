-- TL原本の日程・部屋タイプを保持するカラム追加
-- TLから受信した値を書き換え不可の原本として保持する
-- フロントで変更するのは checkin_date/checkout_date/room_type の方

-- MySQL 8.4互換（IF NOT EXISTS非対応のため条件付き実行）
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='tl_checkin_date');
SET @sql = IF(@col = 0, 'ALTER TABLE reservations ADD COLUMN tl_checkin_date DATE NULL COMMENT \'TL原本CI日（書き換え不可）\'', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='tl_checkout_date');
SET @sql = IF(@col = 0, 'ALTER TABLE reservations ADD COLUMN tl_checkout_date DATE NULL COMMENT \'TL原本CO日（書き換え不可）\'', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='tl_room_type');
SET @sql = IF(@col = 0, 'ALTER TABLE reservations ADD COLUMN tl_room_type VARCHAR(20) NULL COMMENT \'TL原本部屋タイプ（書き換え不可）\'', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 既存データの原本フィールドを現在の値で埋める（初回のみ）
UPDATE reservations SET tl_checkin_date = checkin_date WHERE tl_checkin_date IS NULL;
UPDATE reservations SET tl_checkout_date = checkout_date WHERE tl_checkout_date IS NULL;
UPDATE reservations SET tl_room_type = room_type WHERE tl_room_type IS NULL;
