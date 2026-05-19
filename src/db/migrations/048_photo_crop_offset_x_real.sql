-- Migration 048: widen crop_offset_x from INTEGER to REAL across photo tables.
--
-- Migration 033 created crop_offset_y as REAL; migration 039 created
-- crop_offset_x as INTEGER. The comment in 039 said "same semantics as
-- crop_offset_y" — that promise was broken by the type.
--
-- Symptom: iOS sync push wedged with
--   `invalid input syntax for type integer: "17.9"` (SQLSTATE 22P02)
-- on every progress_photos upsert. The AdjustOffsetDialog drag handler
-- produces fractional percent values (CSS object-position is a float
-- everywhere else), the client side stores them as `number | null`, and the
-- mismatched X column rejects everything except whole-integer drags.
--
-- Promote all three tables' X column to REAL so it matches Y. No data loss
-- on the way up (INTEGER values cast cleanly to REAL). Existing NULLs stay
-- NULL — renderer continues to default to 50 (center).

ALTER TABLE progress_photos   ALTER COLUMN crop_offset_x TYPE REAL USING crop_offset_x::REAL;
ALTER TABLE projection_photos ALTER COLUMN crop_offset_x TYPE REAL USING crop_offset_x::REAL;
ALTER TABLE inspo_photos      ALTER COLUMN crop_offset_x TYPE REAL USING crop_offset_x::REAL;
