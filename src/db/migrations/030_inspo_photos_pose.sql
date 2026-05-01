-- Migration 030: pose tag on inspo_photos.
--
-- Inspo (aspiration) photos get the same pose categorization as progress photos so
-- the upcoming photos-compare feature can mix progress + inspo into the same
-- pose-filtered chronological viewer. NULL means "not yet categorized" — UI prompts
-- to set, but legacy rows captured before this column existed don't break.
--
-- Note: inspo_photos is intentionally NOT part of the local-first CDC sync layer
-- (see SYNCED_TABLES in src/lib/sync.ts). The capture flow is: Dexie save →
-- Vercel Blob upload → POST /api/inspo-photos. Gallery reads via REST. So this
-- column needs to flow through the Dexie type (LocalInspoPhoto), the REST API
-- request/response shape, and the InspoPhoto Postgres queries — but no
-- sync push/pull plumbing.

ALTER TABLE inspo_photos
  ADD COLUMN IF NOT EXISTS pose TEXT
    CHECK (pose IS NULL OR pose IN ('front', 'side', 'back', 'other'));

CREATE INDEX IF NOT EXISTS idx_inspo_photos_pose ON inspo_photos(pose);
