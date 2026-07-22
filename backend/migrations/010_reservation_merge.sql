-- Migration 010: 予約統合機能
--
-- 目的:
-- 1. reservation_sources テーブル新規作成（統合元のOTA予約番号を保持）
-- 2. reservations.status ENUMに 'merged' を追加（統合された子予約の識別用）
--
-- 背景:
-- OTAが連泊を1泊ずつ別予約で通知するケースがある（例: 4泊→4件の1泊予約）。
-- スタッフが手動でこれらを1つの予約に統合し、統合元のOTA予約番号を
-- reservation_sources に保持することで、TL通知の追跡を可能にする。

SET @db_name = DATABASE();

-- ============================================================
-- reservation_sources テーブル新規作成
-- 統合された予約の元OTA予約番号を保持するテーブル
-- TL通知が統合子の予約番号で来た場合、ここから親予約を辿る
-- ============================================================

SELECT COUNT(*) INTO @tbl_exists FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservation_sources';
SET @sql = IF(@tbl_exists = 0,
    'CREATE TABLE reservation_sources (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reservation_id INT NOT NULL COMMENT ''統合先の親予約ID（reservations.id）'',
        original_reservation_id INT NULL COMMENT ''元の予約レコードID（merged化されたreservations.id）'',
        reservation_no VARCHAR(50) NOT NULL COMMENT ''元のOTA予約番号'',
        channel VARCHAR(30) NOT NULL COMMENT ''元のチャネル'',
        checkin_date DATE NOT NULL COMMENT ''元のCI日'',
        checkout_date DATE NOT NULL COMMENT ''元のCO日'',
        amount INT NOT NULL COMMENT ''元の予約金額'',
        nights INT NOT NULL COMMENT ''元の泊数'',
        status ENUM(''active'',''cancelled'') NOT NULL DEFAULT ''active'' COMMENT ''active=有効, cancelled=中日キャンセル等'',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reservation_id) REFERENCES reservations(id),
        INDEX idx_reservation_no (reservation_no, channel),
        INDEX idx_reservation_id (reservation_id),
        UNIQUE KEY uk_channel_resno (reservation_id, channel, reservation_no)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- reservations.status ENUM に 'merged' を追加
-- merged: 統合されて無効化された子予約を示す内部管理ステータス
-- 一覧・集計・状態遷移の対象外として扱う
-- ============================================================

SELECT COLUMN_TYPE INTO @current_type FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'status';

-- merged が既に含まれていなければ追加
SET @sql = IF(@current_type NOT LIKE '%merged%',
    "ALTER TABLE reservations MODIFY COLUMN status ENUM('confirmed','checked_in','checked_out','cancelled','no_show','merged') NOT NULL DEFAULT 'confirmed'",
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- reservations.channel を NULL 許可に変更
-- 統合予約は特定OTAに属さないため channel=NULL とする
-- ============================================================

ALTER TABLE reservations MODIFY COLUMN channel VARCHAR(30) NULL COMMENT 'OTA名（統合予約はNULL）';
