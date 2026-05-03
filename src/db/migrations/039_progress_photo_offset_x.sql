-- Migration 039: add crop_offset_x to photo tables for horizontal alignment.
--
-- crop_offset_y (migration 033) anchored heads vertically; the silhouette
-- venn overlay (v0.7.7) makes horizontal misalignment painfully visible
-- because positional drift gets read as shape change. crop_offset_x is the
-- mirror axis: 0-100 percent, NULL = renderer defaults to 50 (center).
--
-- Same semantics as crop_offset_y. The renderer multiplies both axes via
-- src/lib/photo-offset.ts offsetTransform(x, y).

ALTER TABLE progress_photos   ADD COLUMN IF NOT EXISTS crop_offset_x INTEGER;
ALTER TABLE projection_photos ADD COLUMN IF NOT EXISTS crop_offset_x INTEGER;
ALTER TABLE inspo_photos      ADD COLUMN IF NOT EXISTS crop_offset_x INTEGER;
