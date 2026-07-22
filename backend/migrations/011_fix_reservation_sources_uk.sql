-- 011: reservation_sources のユニークキー修正
-- 旧: (channel, reservation_no) → 同じ予約番号は全体で1レコードのみ
-- 新: (reservation_id, channel, reservation_no) → 同じ予約番号でも統合先が異なれば許容
-- 理由: 分割→再統合のケースで同じOTA予約番号が新しい統合先に再登録される必要がある

ALTER TABLE reservation_sources
    DROP INDEX uk_channel_resno,
    ADD UNIQUE KEY uk_channel_resno (reservation_id, channel, reservation_no);
