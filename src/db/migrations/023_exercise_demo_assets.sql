-- Migration 023: Exercise demo assets (images + YouTube link)
--
-- Adds three columns to exercises:
--   image_count INT NOT NULL DEFAULT 0  — how many demo frames this exercise
--                                          has (0-3). Source-of-truth for
--                                          whether to render the demo strip.
--   youtube_url TEXT NULL               — optional reference video. Stored
--                                          as-is with start-time embedded
--                                          (e.g. ?t=42). Helper canonicalizes
--                                          before opening.
--   image_urls TEXT[] NULL              — optional Vercel Blob URLs for
--                                          in-app-generated images (when an
--                                          AI-generated set is uploaded mid-
--                                          flight from iOS). Bundled images
--                                          live at /exercise-images/{uuid}/
--                                          and need no DB pointer; image_urls
--                                          is the OOB-fetch path for blobs.
--
-- Per /plan-eng-review (2026-05-01) decisions:
--   - Image addressing by exercise UUID (not everkinetic_id) for universality
--   - Bundled catalog images live in public/exercise-images/{uuid}/01.jpg etc.
--   - In-app generated images uploaded to Vercel Blob, URLs in image_urls[]
--   - youtube_url validated server-side via parseYouTubeUrl regex on push
--
-- All additive, all defaulted, no backfill required for existing rows.

ALTER TABLE exercises
  ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0
  CHECK (image_count >= 0 AND image_count <= 3);

ALTER TABLE exercises
  ADD COLUMN youtube_url TEXT;

ALTER TABLE exercises
  ADD COLUMN image_urls TEXT[];

COMMENT ON COLUMN exercises.image_count IS
  'Number of demo image frames available (0-3). 0 = no images, render text-only. '
  'Frames are addressed by exercise.uuid: bundled at public/exercise-images/{uuid}/{01,02,03}.jpg, '
  'or referenced via image_urls when AI-generated in-app and stored in Vercel Blob.';

COMMENT ON COLUMN exercises.youtube_url IS
  'Optional YouTube reference video. Stored as raw URL with start-time embedded. '
  'Validated via parseYouTubeUrl helper before persistence. Null = no link.';

COMMENT ON COLUMN exercises.image_urls IS
  'Optional Vercel Blob URLs for AI-generated demo images uploaded in-app. '
  'When set, takes precedence over the bundled public/exercise-images/{uuid}/ path. '
  'NULL or empty = use bundled fallback. Length should equal image_count when set.';
