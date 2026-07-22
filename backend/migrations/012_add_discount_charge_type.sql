-- 012: reservation_charges の charge_type に 'discount' を追加
-- ポイント割引・補助金・クーポン等のマイナス明細行を記録するため

ALTER TABLE reservation_charges
  MODIFY COLUMN charge_type ENUM('room','cancel_fee','no_show_fee','addon','payment','refund','discount') NOT NULL;
