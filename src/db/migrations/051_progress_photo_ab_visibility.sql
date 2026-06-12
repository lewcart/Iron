-- Migration 051: ab-visibility 0-5 quick tag on progress photos.
--
-- One-tap rating Lou applies on a front/side progress photo to track ab
-- definition over time (0 = no separation, 5 = fully shredded). Stored as a
-- nullable SMALLINT with a CHECK so only 0-5 (or NULL = unrated) are valid.
--
-- progress_photos only — inspo / projection photos are aspirational reference
-- images, not Lou's own body, so they have no ab-visibility self-rating.
--
-- Additive nullable column. Existing rows stay NULL (unrated); the next sync
-- pull leaves them NULL. Mirrors the crop_offset_x rollout pattern (mig 039):
-- DB column + Dexie interface + Dexie version bump + push/pull threading.

ALTER TABLE progress_photos
  ADD COLUMN ab_visibility SMALLINT
  CHECK (ab_visibility IS NULL OR (ab_visibility >= 0 AND ab_visibility <= 5));
