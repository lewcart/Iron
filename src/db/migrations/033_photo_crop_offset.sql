-- Migration 033: crop_offset_y for photo alignment.
--
-- Photos in the compare viewer rarely line up — heads land at different
-- screen y-coordinates because framing varies shot to shot. We persist a
-- crop_offset_y (CSS object-position y%, range typically 0-100) per photo.
-- Renderer feeds this directly into `object-position: center {offset}%` so
-- the same image crops differently across surfaces.
--
-- NULL = no alignment data; renderer defaults to 50 (center). New uploads
-- can have it auto-filled via best-effort face detection (window.FaceDetector
-- where supported); manual drag-to-nudge writes here too.
--
-- Applied to all three photo tables so the comparison viewer can align any
-- pair (progress + projection, progress + inspo, progress + progress).

ALTER TABLE progress_photos
  ADD COLUMN IF NOT EXISTS crop_offset_y REAL;

ALTER TABLE inspo_photos
  ADD COLUMN IF NOT EXISTS crop_offset_y REAL;

ALTER TABLE projection_photos
  ADD COLUMN IF NOT EXISTS crop_offset_y REAL;
