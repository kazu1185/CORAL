-- 018: チャネルマスタテーブル
-- OTAチャネル情報をDBで管理し、設定画面から追加・編集可能にする。
-- TlXmlParser.php の OTA_CHANNEL_MAP ハードコードを廃止するための基盤。

CREATE TABLE IF NOT EXISTS channels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    channel_code VARCHAR(20) NOT NULL UNIQUE COMMENT 'チャネルコード（jalan, phone等、不変）',
    channel_name VARCHAR(50) NOT NULL COMMENT '表示名（じゃらん、電話等）',
    color VARCHAR(7) NOT NULL DEFAULT '#6B7280' COMMENT 'バッジカラー（#RRGGBB）',
    channel_type ENUM('ota','manual') NOT NULL DEFAULT 'ota' COMMENT 'ota=TL経由, manual=手動入力',
    tl_match_patterns VARCHAR(200) NULL COMMENT 'TL XML CompanyName部分一致パターン（カンマ区切り）',
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 初期データ: 現行ハードコード値を移行
INSERT INTO channels (channel_code, channel_name, color, channel_type, tl_match_patterns, sort_order) VALUES
    ('jalan',      'じゃらん',        '#DC2626', 'ota',    'じゃらん',                1),
    ('rakuten',    '楽天',            '#991B1B', 'ota',    '楽天',                    2),
    ('booking',    'Booking.com',     '#1E3A5F', 'ota',    'Booking.com',             3),
    ('agoda',      'Agoda',           '#7C3AED', 'ota',    'Agoda',                   4),
    ('expedia',    'Expedia',         '#CA8A04', 'ota',    'Expedia',                 5),
    ('ikyu',       '一休',            '#D97706', 'ota',    '一休',                    6),
    ('jtb',        'JTB',             '#047857', 'ota',    'JTB,るるぶ',              7),
    ('ana',        'ANA',             '#1D4ED8', 'ota',    'ANA,ＡＮＡ',              8),
    ('jal',        'JAL',             '#B91C1C', 'ota',    'ジャルパック,ｼﾞｬﾙﾊﾟｯｸ',  9),
    ('skyticket',  'スカイチケット',  '#6366F1', 'ota',    'スカイチケット',          10),
    ('direct',     '直販',            '#16A34A', 'manual', NULL,                      11),
    ('phone',      '電話',            '#EA580C', 'manual', NULL,                      12),
    ('walkin',     'ウォークイン',    '#0891B2', 'manual', NULL,                      13),
    ('corporate',  '法人',            '#0369A1', 'manual', NULL,                      14),
    ('other',      'その他',          '#6B7280', 'ota',    NULL,                      99);
