-- Migration 030: pose tag on inspo_photos.
--
-- Inspo (aspiration) photos get the same pose categorization as progress photos so
-- the upcoming photos-compare feature can mix progress + inspo into the same
-- pose-filtered chronological viewer. NULL means "not yet categorized" — UI prompts
-- to set, but legacy rows captured before this column existed don't break.
--
-- Note: inspo_photos is intentionally NOT part of the local-first CDC sync layer
-- (see SYNCED_TABLES in src/lib/sync.ts). The capture flow is: Dexie save →
-- Vercel Blob upload → POST /api/inspo-photos. Gallery reads via REST.
--
-- Self-healing: if the inspo_photos table is missing on this DB (drift from an
-- earlier reset that didn't replay 002 cleanly), create it now with the same
-- schema migrations 002 + 010 + 019 would have produced.

CREATE TABLE IF NOT EXISTS inspo_photos (
  uuid TEXT PRIMARY KEY,
  blob_url TEXT NOT NULL,
  notes TEXT,
  taken_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  burst_group_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspo_photos_taken_at ON inspo_photos(taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspo_photos_burst_group_id ON inspo_photos(burst_group_id);

ALTER TABLE inspo_photos
  ADD COLUMN IF NOT EXISTS pose TEXT
    CHECK (pose IS NULL OR pose IN ('front', 'side', 'back', 'other'));

CREATE INDEX IF NOT EXISTS idx_inspo_photos_pose ON inspo_photos(pose);
