-- Migration 031: projection_photos.
--
-- A "projection" is an AI-generated image of Lou (generated outside this app —
-- ChatGPT / Midjourney / wherever) showing an aspirational future-self physique.
-- Lou uploads them here so the photos-compare viewer can line them up against
-- real progress photos at the same pose.
--
-- Schema mirrors progress_photos: same pose enum (front/side/back), same
-- blob_url + notes + taken_at shape. Two extras specific to projections:
--   - source_progress_photo_uuid: optional link to the progress photo this
--     projection was generated from (the comparison viewer prefers this pairing
--     when set). Nullable, ON DELETE SET NULL so deleting a progress photo
--     doesn't cascade-delete the projection.
--   - target_horizon: optional label like '3mo' / '6mo' / '12mo' / freeform.
--
-- Sync layer: NOT in CDC sync (matches inspo_photos pattern). The capture path
-- is direct REST: client picks file → POST /api/projection-photos/upload (Vercel
-- Blob put) → POST /api/projection-photos (metadata insert). The gallery reads
-- via GET /api/projection-photos.

CREATE TABLE IF NOT EXISTS projection_photos (
  uuid TEXT PRIMARY KEY,
  blob_url TEXT NOT NULL,
  pose TEXT NOT NULL CHECK (pose IN ('front', 'side', 'back')),
  notes TEXT,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_progress_photo_uuid TEXT REFERENCES progress_photos(uuid) ON DELETE SET NULL,
  target_horizon TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projection_photos_taken_at ON projection_photos (taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_projection_photos_pose ON projection_photos (pose);
CREATE INDEX IF NOT EXISTS idx_projection_photos_source ON projection_photos (source_progress_photo_uuid);
