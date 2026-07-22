-- staffテーブルにログイン失敗カウントとロック判定用カラムを追加
ALTER TABLE staff
    ADD COLUMN login_fail_count INT NOT NULL DEFAULT 0 AFTER is_active,
    ADD COLUMN last_login_fail_at DATETIME NULL AFTER login_fail_count;
