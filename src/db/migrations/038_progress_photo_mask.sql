-- Migration 038: add mask_url to photo tables for the silhouette compare mode.
--
-- The silhouette mode in /photos/compare overlays a person-segmentation outline
-- on each photo. Masks are generated on-device via iOS Vision
-- (VNGeneratePersonSegmentationRequest), uploaded to Vercel Blob, and the URL
-- cached here so the work runs once per photo. NULL = mask not yet computed
-- (lazy backfill: first time the user opens silhouette mode for that photo).
--
-- Server-owned cache: clients never null this column on push. The sync push
-- route should only update mask_url when explicitly present in the envelope.

ALTER TABLE progress_photos   ADD COLUMN IF NOT EXISTS mask_url TEXT;
ALTER TABLE projection_photos ADD COLUMN IF NOT EXISTS mask_url TEXT;
ALTER TABLE inspo_photos      ADD COLUMN IF NOT EXISTS mask_url TEXT;
