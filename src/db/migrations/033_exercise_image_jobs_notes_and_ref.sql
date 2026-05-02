-- Migration 033: Add notes + reference_image_url to exercise_image_generation_jobs
--
-- Two optional inputs the user can attach when regenerating:
--
--   notes TEXT
--     Free-form correction the user typed in the manager sheet (max 280 chars
--     enforced by the route, not by a CHECK — server-side validation gives a
--     better error message than a constraint violation). Threaded into both
--     the frame 1 and frame 2 prompts as
--     "Additional guidance from the user: {notes}". Persisted here so
--     idempotent retries replay the same instruction and so we have an
--     audit trail of what the user asked for on each attempt.
--
--   reference_image_url TEXT
--     Vercel Blob URL of the user-uploaded reference, after sharp-resizing
--     it to 600×800 PNG. Lives at exercise-images/{uuid}/{batchId}/ref.png.
--     When present, the route uses openai.images.edit({ image: ref }) for
--     frame 1 instead of openai.images.generate. Frame 2 still chains from
--     frame 1 via the existing edit-call. URL is preserved on rollback —
--     it's the user's source artifact and lives independently of the
--     candidate pair (so retries can re-use it without re-uploading).
--
-- Both NULLABLE — additive, no backfill needed. exercise_image_generation_jobs
-- is server-side audit only (no change_log trigger), so there's nothing to
-- propagate to clients.

ALTER TABLE exercise_image_generation_jobs
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS reference_image_url TEXT;

COMMENT ON COLUMN exercise_image_generation_jobs.notes IS
  'Optional free-form user guidance (max 280 chars, server-validated). '
  'Threaded into both frame prompts as "Additional guidance from the user: ...". '
  'Persisted so idempotent retries replay the same instruction.';

COMMENT ON COLUMN exercise_image_generation_jobs.reference_image_url IS
  'Optional Vercel Blob URL of the user-uploaded reference image '
  '(resized to 600x800 PNG). When set, the route uses openai.images.edit() '
  'with this image as the seed for frame 1 instead of images.generate(). '
  'Preserved on rollback so retries can re-use the same reference.';
