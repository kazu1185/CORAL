-- Migration 008: ゲスト名前カラムを姓名分割(6)から統合(3)に変更
-- 理由: TLは姓名を1フィールドで通知するため、最初のスペースで無理やり分割していた。
-- インバウンドゲストは「どこまでが姓か」判別不能なケースが多く、1フィールドが運用に合う。
-- 変更: last_name_kanji + first_name_kanji → name_kanji
--        last_name_kana + first_name_kana → name_kana
--        last_name_romaji + first_name_romaji → name_romaji

SET @db_name = DATABASE();

-- === 新カラム追加 ===

SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'name_kanji';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN name_kanji VARCHAR(100) NULL COMMENT ''氏名（漢字）'' AFTER guest_code',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'name_kana';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN name_kana VARCHAR(100) NULL COMMENT ''氏名（カタカナ）'' AFTER name_kanji',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'name_romaji';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN name_romaji VARCHAR(100) NULL COMMENT ''氏名（ローマ字）'' AFTER name_kana',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === 既存データを新カラムに移行 ===
-- 姓+スペース+名を結合（片方だけの場合はTRIMで余計なスペースを除去）
UPDATE guests SET
    name_kanji = NULLIF(TRIM(CONCAT(COALESCE(last_name_kanji, ''), ' ', COALESCE(first_name_kanji, ''))), ''),
    name_kana = NULLIF(TRIM(CONCAT(COALESCE(last_name_kana, ''), ' ', COALESCE(first_name_kana, ''))), ''),
    name_romaji = NULLIF(TRIM(CONCAT(COALESCE(last_name_romaji, ''), ' ', COALESCE(first_name_romaji, ''))), '')
WHERE name_kanji IS NULL AND name_kana IS NULL AND name_romaji IS NULL;

-- === 旧カラム削除 ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'last_name_kanji';
SET @sql = IF(@col_exists > 0,
    'ALTER TABLE guests DROP COLUMN last_name_kanji, DROP COLUMN first_name_kanji, DROP COLUMN last_name_kana, DROP COLUMN first_name_kana, DROP COLUMN last_name_romaji, DROP COLUMN first_name_romaji',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === インデックス追加（検索用） ===
SELECT COUNT(*) INTO @idx_exists FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND INDEX_NAME = 'idx_name_kana';
SET @sql = IF(@idx_exists = 0,
    'ALTER TABLE guests ADD INDEX idx_name_kana (name_kana)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @idx_exists FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND INDEX_NAME = 'idx_name_romaji';
SET @sql = IF(@idx_exists = 0,
    'ALTER TABLE guests ADD INDEX idx_name_romaji (name_romaji)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 旧インデックスを削除（存在する場合のみ）
SELECT COUNT(*) INTO @idx_exists FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND INDEX_NAME = 'idx_kana';
SET @sql = IF(@idx_exists > 0,
    'ALTER TABLE guests DROP INDEX idx_kana',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @idx_exists FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND INDEX_NAME = 'idx_romaji';
SET @sql = IF(@idx_exists > 0,
    'ALTER TABLE guests DROP INDEX idx_romaji',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
