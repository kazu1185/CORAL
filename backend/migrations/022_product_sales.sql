-- Migration 022: 物販管理（2026-07-22）
--
-- フロントデスクでの物販（土産・飲料・アメニティ等）を管理する。
--   販売形態: 部屋付け（宿泊予約の明細に追加しCO精算）＋ 即売（現金/カード等の即時決済）
--   在庫管理: なし（将来拡張の余地だけ残す。在庫列は作らない）
--   税率:     8%（軽減）と10%が混在するため商品ごとにDBで保持（ハードコード禁止）
--
-- MySQL 8.4 は ADD COLUMN IF NOT EXISTS 不可のため INFORMATION_SCHEMA で存在チェック（規約 #10）
-- DB名は本番/開発で異なる可能性があるため DATABASE() から取る（017等と同じ流儀）

SET @db_name = DATABASE();

-- ============================================================
-- 1. products（商品マスタ）
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_name VARCHAR(100) NOT NULL,
  category VARCHAR(30) NOT NULL DEFAULT 'その他' COMMENT 'レジ画面のタブ分け用（飲料/食品/雑貨 等の自由入力）',
  price INT NOT NULL COMMENT '税込価格（円）',
  tax_rate TINYINT NOT NULL DEFAULT 10 COMMENT '8 or 10。税率ハードコード禁止のためDBで保持',
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '論理削除（規約 #13）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. product_sales（販売記録）— 物販の記録の本体
--
-- product_name / unit_price / tax_rate をスナップショットとして持つ理由:
--   マスタの商品名や価格を後から変更しても、過去の売上記録は当時の内容のまま
--   不変でなければならない（領収書の再発行・売上レポートの遡及集計のため）
-- ============================================================
CREATE TABLE IF NOT EXISTS product_sales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sale_date DATE NOT NULL,
  sale_group_id INT NULL COMMENT '同一会計の識別子（その会計の先頭 product_sales.id）。1会計＝1枚の領収書にするため',
  reservation_id INT NULL COMMENT 'NULL=即売 / あり=部屋付け',
  charge_id INT NULL COMMENT '部屋付け時に生成した reservation_charges 行',
  product_id INT NOT NULL,
  product_name VARCHAR(100) NOT NULL COMMENT 'スナップショット',
  unit_price INT NOT NULL COMMENT 'スナップショット（税込）',
  tax_rate TINYINT NOT NULL COMMENT 'スナップショット',
  quantity INT NOT NULL DEFAULT 1,
  amount INT NOT NULL COMMENT 'unit_price * quantity（税込）',
  tax_amount INT NOT NULL COMMENT '内消費税額（amount - floor(amount / (1 + rate/100))、円未満切り捨て）',
  payment_method_id INT NULL COMMENT '即売時のみ。部屋付けはNULL（CO精算時に決まる）',
  staff_id INT NOT NULL,
  status ENUM('active','cancelled') NOT NULL DEFAULT 'active' COMMENT '取消は論理削除（規約 #13）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sale_date (sale_date),
  KEY idx_reservation (reservation_id),
  KEY idx_product (product_id),
  KEY idx_sale_group (sale_group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- sale_group_id は開発中に後から追加した列。
-- CREATE TABLE IF NOT EXISTS は既存テーブルには効かないため、
-- 先に022を適用済みの環境（開発DB）でも列が入るよう存在チェック付きで追加する
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'product_sales' AND COLUMN_NAME = 'sale_group_id';
SET @sql = IF(@col_exists = 0,
    "ALTER TABLE product_sales ADD COLUMN sale_group_id INT NULL COMMENT '同一会計の識別子（その会計の先頭 product_sales.id）' AFTER sale_date, ADD INDEX idx_sale_group (sale_group_id)",
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- 3. reservation_charges の改修（部屋付け明細用）
-- ============================================================

-- charge_type に 'goods' を追加（012 と同じく既存値を全列挙して MODIFY）
SET @enum_ok = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservation_charges'
      AND COLUMN_NAME = 'charge_type' AND COLUMN_TYPE LIKE '%goods%');
SET @sql = IF(@enum_ok = 0,
    "ALTER TABLE reservation_charges MODIFY COLUMN charge_type ENUM('room','cancel_fee','no_show_fee','addon','payment','refund','discount','goods') NOT NULL",
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- tax_rate 追加。既存行はNULL（=10%扱い）のまま。goods行のみ 8/10 を設定する
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservation_charges' AND COLUMN_NAME = 'tax_rate';
SET @sql = IF(@col_exists = 0,
    "ALTER TABLE reservation_charges ADD COLUMN tax_rate TINYINT NULL COMMENT '消費税率(%)。NULL=10%扱い（既存行の後方互換）'",
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- 4. document_items の改修（領収書の税率区分記載＋即売明細の参照）
-- ============================================================

SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'document_items' AND COLUMN_NAME = 'tax_rate';
SET @sql = IF(@col_exists = 0,
    "ALTER TABLE document_items ADD COLUMN tax_rate TINYINT NULL COMMENT '消費税率(%)。インボイスの税率区分記載用。NULL=10%扱い'",
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sale_id は即売領収書用（即売には reservation_charges 行が無いため charge_id が使えない）
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'document_items' AND COLUMN_NAME = 'sale_id';
SET @sql = IF(@col_exists = 0,
    "ALTER TABLE document_items ADD COLUMN sale_id INT NULL COMMENT 'product_sales.id参照（即売領収書の明細）'",
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- 5. 権限
--
-- role_permissions は「4ロール×全権限の行を必ず作り is_granted の 0/1 で制御する」
-- 既存の流儀に合わせ、付与しないロールも is_granted=0 の行を作る。
--   product_sales.* … receipt.issue と同じ（フロント系3ロールに付与）
--   master.products … master.plans と同じ（admin / front_manager のみ）
-- ============================================================

INSERT IGNORE INTO permissions (permission_key, permission_name, category, sort_order) VALUES
  ('product_sales.view',   '物販ページの閲覧',     '物販', 33),
  ('product_sales.create', '物販の販売・取消',     '物販', 34),
  ('master.products',      '商品マスタの編集',     '設定', 54);

INSERT IGNORE INTO role_permissions (role, permission_key, is_granted) VALUES
  ('admin',        'product_sales.view',   1),
  ('front_manager','product_sales.view',   1),
  ('front',        'product_sales.view',   1),
  ('housekeeping', 'product_sales.view',   0),
  ('admin',        'product_sales.create', 1),
  ('front_manager','product_sales.create', 1),
  ('front',        'product_sales.create', 1),
  ('housekeeping', 'product_sales.create', 0),
  ('admin',        'master.products',      1),
  ('front_manager','master.products',      1),
  ('front',        'master.products',      0),
  ('housekeeping', 'master.products',      0);
