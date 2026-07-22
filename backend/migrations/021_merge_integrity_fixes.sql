-- 021: 予約統合の整合性修正用カラム追加（2026-06-12 脆弱性検証報告 #1, #10 対応）
--
-- 1) reservation_charges.merged_from_reservation_id
--    統合時に「どの子予約から移した明細か」を記録する。
--    従来は統合解除時に日付範囲（date >= ci AND date < co）で明細を子に戻していたため、
--    CO日当日の入金やCO日のアドオンが親に取り残される実証済みバグがあった。
--    解除時はこのカラムで正確に戻し、戻したらNULLにクリアする。
--
-- 2) reservation_sources.original_guest_id
--    統合時の子予約の guest_id を記録する。
--    従来は解除時に親の guest_id を全子に設定していたため、
--    異なるゲストの予約を統合すると元のゲスト紐付けが失われていた。
--
-- MySQL 8.4 は ADD COLUMN IF NOT EXISTS 不可のため INFORMATION_SCHEMA で存在チェック（規約 #10）

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservation_charges' AND COLUMN_NAME='merged_from_reservation_id');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE reservation_charges ADD COLUMN merged_from_reservation_id INT NULL DEFAULT NULL COMMENT ''統合で移した明細の元予約ID（解除時の戻し先特定用）'', ADD INDEX idx_merged_from (merged_from_reservation_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservation_sources' AND COLUMN_NAME='original_guest_id');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE reservation_sources ADD COLUMN original_guest_id INT NULL DEFAULT NULL COMMENT ''統合時の子予約のguest_id（解除時の復元用）''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
