-- Migration 007: guests テーブルのローマ字カラムをNULL許可に変更
-- 理由: TL電文の原本データは reservations.tl_last_name / tl_first_name に保持されるため、
-- ゲストマスタのローマ字は必須ではない。スタッフが正しい情報を入力する運用。

ALTER TABLE guests MODIFY COLUMN last_name_romaji VARCHAR(50) NULL COMMENT '姓（ローマ字）';
ALTER TABLE guests MODIFY COLUMN first_name_romaji VARCHAR(50) NULL COMMENT '名（ローマ字）';
