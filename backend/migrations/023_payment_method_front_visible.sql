-- マイグレーション023: payment_methods にフロントモード表示フラグを追加
-- フロント（iPad）の精算パネルは front_visible=1 の決済方法のみ表示する。
-- 既存挙動を壊さないため列は DEFAULT 1。ただしカウンターで受けないOTAオンライン決済・
-- 楽天ポイント・クーポン・法人売掛は初期値を0にして最初から絞り込む（PC設定でいつでも変更可）。
-- MySQL 8.4 は ADD COLUMN IF NOT EXISTS 非対応のため INFORMATION_SCHEMA で存在チェック（規約 #10）。

-- TABLE_SCHEMA は DATABASE() で現在の接続先DBを参照（本番/開発でDB名が違っても正しく動く・冪等）
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_methods' AND COLUMN_NAME='front_visible');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE payment_methods ADD COLUMN front_visible TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''フロントモード(iPad)精算パネルに表示するか'' AFTER is_active',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 初期デフォルト: カウンターで受けない決済方法は非表示にする。
-- 列を今回追加したとき（@col_exists=0）のみ実行し、再実行時にユーザー設定を上書きしない（冪等）。
SET @sql2 = IF(@col_exists = 0,
    'UPDATE payment_methods SET front_visible = 0
       WHERE method_code IN (''ota_prepaid'',''ota_jalan'',''ota_rakuten'',''ota_booking'',''ota_agoda'',''rakuten_point'',''coupon'',''corporate'')',
    'SELECT 1');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
