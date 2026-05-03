-- Migration 037: expand pose enum to 6 values across photo tables.
--
-- Adds two face-crop poses (face_front, face_side) so close-up shots have a
-- proper category instead of being shoehorned into front/side, plus 'other'
-- for genuinely uncategorizable shots. progress_photos and projection_photos
-- previously allowed only {front, side, back}; inspo_photos already had
-- 'other' but is widened here for parity. NULL stays allowed on inspo_photos
-- (legacy uncategorized rows).
--
-- Postgres auto-names inline CHECK constraints `{table}_{col}_check`, but we
-- drop by discovered name in case earlier migrations chose a custom name.

DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid IN (
      'progress_photos'::regclass,
      'projection_photos'::regclass,
      'inspo_photos'::regclass
    ) AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%pose%'
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',
      (SELECT relname FROM pg_class WHERE oid = (
        SELECT conrelid FROM pg_constraint WHERE conname = c LIMIT 1
      )),
      c);
  END LOOP;
END $$;

ALTER TABLE progress_photos
  ADD CONSTRAINT progress_photos_pose_check
  CHECK (pose IN ('front', 'side', 'back', 'face_front', 'face_side', 'other'));

ALTER TABLE projection_photos
  ADD CONSTRAINT projection_photos_pose_check
  CHECK (pose IN ('front', 'side', 'back', 'face_front', 'face_side', 'other'));

ALTER TABLE inspo_photos
  ADD CONSTRAINT inspo_photos_pose_check
  CHECK (pose IS NULL OR pose IN ('front', 'side', 'back', 'face_front', 'face_side', 'other'));
