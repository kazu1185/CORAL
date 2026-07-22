-- 015: 人数内訳カラム追加
-- TL電文の男性/女性/子供A(70%)/B(50%)/C(30%)/D(0%)を個別保存する
-- 既存の adult_count / child_count はそのまま残す（集計値として使う）

-- male_count: 大人男性
SET @col1 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='male_count');
SET @sql1 = IF(@col1 = 0,
    'ALTER TABLE reservations ADD COLUMN male_count INT NOT NULL DEFAULT 0 AFTER child_count',
    'SELECT 1');
PREPARE s1 FROM @sql1; EXECUTE s1; DEALLOCATE PREPARE s1;

-- female_count: 大人女性
SET @col2 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='female_count');
SET @sql2 = IF(@col2 = 0,
    'ALTER TABLE reservations ADD COLUMN female_count INT NOT NULL DEFAULT 0 AFTER male_count',
    'SELECT 1');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

-- child_a_count: 子供A（70%料金）
SET @col3 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='child_a_count');
SET @sql3 = IF(@col3 = 0,
    'ALTER TABLE reservations ADD COLUMN child_a_count INT NOT NULL DEFAULT 0 AFTER female_count',
    'SELECT 1');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

-- child_b_count: 子供B（50%料金）
SET @col4 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='child_b_count');
SET @sql4 = IF(@col4 = 0,
    'ALTER TABLE reservations ADD COLUMN child_b_count INT NOT NULL DEFAULT 0 AFTER child_a_count',
    'SELECT 1');
PREPARE s4 FROM @sql4; EXECUTE s4; DEALLOCATE PREPARE s4;

-- child_c_count: 子供C（30%料金）
SET @col5 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='child_c_count');
SET @sql5 = IF(@col5 = 0,
    'ALTER TABLE reservations ADD COLUMN child_c_count INT NOT NULL DEFAULT 0 AFTER child_b_count',
    'SELECT 1');
PREPARE s5 FROM @sql5; EXECUTE s5; DEALLOCATE PREPARE s5;

-- child_d_count: 子供D（添い寝/0%料金）
SET @col6 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='pms_db' AND TABLE_NAME='reservations' AND COLUMN_NAME='child_d_count');
SET @sql6 = IF(@col6 = 0,
    'ALTER TABLE reservations ADD COLUMN child_d_count INT NOT NULL DEFAULT 0 AFTER child_c_count',
    'SELECT 1');
PREPARE s6 FROM @sql6; EXECUTE s6; DEALLOCATE PREPARE s6;
