-- Migration 006: 顧客管理機能拡張
-- guests テーブルに表示用顧客コード・住所・モバイル・性別・生年月日・会社名・言語設定を追加
-- reservation_passports テーブルを新規作成（パスポート画像保存用）

SET @db_name = DATABASE();

-- ============================================================
-- guests テーブル: カラム追加
-- ============================================================

-- === guest_code: 表示用顧客コード（G00001形式） ===
-- 内部FK紐付けは guests.id を使用し、guest_code は人間向け識別子
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'guest_code';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN guest_code VARCHAR(6) NULL UNIQUE COMMENT ''表示用顧客コード（G00001形式）''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === postal_code: 郵便番号（ハイフン込み、海外対応） ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'postal_code';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN postal_code VARCHAR(10) NULL COMMENT ''郵便番号''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === prefecture: 都道府県（海外ゲストはNULL） ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'prefecture';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN prefecture VARCHAR(20) NULL COMMENT ''都道府県''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === city: 市区町村 ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'city';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN city VARCHAR(50) NULL COMMENT ''市区町村''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === address_line: 番地・建物名 ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'address_line';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN address_line VARCHAR(100) NULL COMMENT ''番地・建物名''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === mobile_phone: 携帯電話番号 ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'mobile_phone';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN mobile_phone VARCHAR(20) NULL COMMENT ''携帯電話番号''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === gender: 性別 ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'gender';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN gender ENUM(''male'',''female'',''other'',''unknown'') NULL COMMENT ''性別''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === birth_date: 生年月日 ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'birth_date';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN birth_date DATE NULL COMMENT ''生年月日''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === company_name: 会社名（領収書印字用） ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'company_name';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN company_name VARCHAR(100) NULL COMMENT ''会社名（領収書印字用）''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === preferred_language: 優先言語（外国人ゲスト案内用） ===
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'preferred_language';
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE guests ADD COLUMN preferred_language VARCHAR(5) NULL DEFAULT ''ja'' COMMENT ''優先言語（ja/en/zh/ko等）''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === 既存データに guest_code を一括採番 ===
-- guest_code が NULL のレコードに G00001〜 を振る
SET @row_num = (SELECT COALESCE(MAX(CAST(SUBSTRING(guest_code, 2) AS UNSIGNED)), 0) FROM guests WHERE guest_code IS NOT NULL);
UPDATE guests SET guest_code = CONCAT('G', LPAD((@row_num := @row_num + 1), 5, '0'))
WHERE guest_code IS NULL ORDER BY id;

-- guest_code を NOT NULL に変更（全件採番済みのため）
-- INFORMATION_SCHEMAで現在NULLABLEかチェックしてから変更
SELECT IS_NULLABLE INTO @is_nullable FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND COLUMN_NAME = 'guest_code';
SET @sql = IF(@is_nullable = 'YES',
    'ALTER TABLE guests MODIFY COLUMN guest_code VARCHAR(6) NOT NULL COMMENT ''表示用顧客コード（G00001形式）''',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === mobile_phone インデックス追加（検索用） ===
SELECT COUNT(*) INTO @idx_exists FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'guests' AND INDEX_NAME = 'idx_mobile_phone';
SET @sql = IF(@idx_exists = 0,
    'ALTER TABLE guests ADD INDEX idx_mobile_phone (mobile_phone)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- reservation_passports テーブル: 新規作成
-- ============================================================
-- パスポート画像を予約に紐づけて保存
-- 代表者も同行者（インバウンド全員）も同じテーブルに入れる
-- 同行者は画像のみ保存（名前の手入力は不要）
-- 物理DELETE禁止のため deleted_at によるソフトデリート方式

SELECT COUNT(*) INTO @tbl_exists FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservation_passports';
SET @sql = IF(@tbl_exists = 0,
    'CREATE TABLE reservation_passports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reservation_id INT NOT NULL COMMENT ''予約ID'',
        is_representative TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''代表者フラグ'',
        image_path VARCHAR(255) NOT NULL COMMENT ''画像ファイルパス（storage/passports/からの相対パス）'',
        scanned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT ''スキャン日時'',
        scanned_by INT NULL COMMENT ''スキャンしたスタッフID'',
        deleted_at DATETIME NULL COMMENT ''論理削除日時'',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reservation_id) REFERENCES reservations(id),
        FOREIGN KEY (scanned_by) REFERENCES staff(id),
        INDEX idx_reservation_id (reservation_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
