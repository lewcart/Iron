-- Migration 032: Exercise image candidates + generation jobs
--
-- Two new tables to support in-app AI generation of exercise demo images
-- with multi-candidate history, atomic pair activation, and server-side
-- cost/audit telemetry.
--
-- exercise_image_candidates
--   Each row is one frame of a generated pair. Generated together = same
--   batch_id. Active pair (one per exercise) gets is_active=true; mirrored
--   into exercises.image_urls / exercises.image_count for the demo strip
--   (which keeps reading the existing column shape).
--
--   Synced via change_log → /api/sync/changes (pull-only on the client).
--
-- exercise_image_generation_jobs
--   Server-side audit log: one row per POST /generate-images attempt. Tracks
--   status (running / succeeded / failed_frame1 / failed_frame2 / failed_db /
--   rollback_orphan), OpenAI request ids for credit reconciliation, estimated
--   cost in cents, and the client-supplied request_id used by the PWA-suspend
--   recovery flow to identify "did my background generation succeed?".
--
--   NOT synced to clients (no CDC trigger). Audit-only.
--
-- Per /autoplan (2026-05-02) decisions 17-25. Originally numbered 031 but
-- two other 031 migrations (routine_exercise_goal_window, projection_photos)
-- landed on main / dev DB while this branch was in flight, so renumbered
-- to 032 to avoid the schema_migrations name collision.
-- UUIDs are stored as TEXT (matches the existing convention — see
-- exercises.uuid, body_plan.uuid, etc — never the Postgres UUID type).

-- ─── exercise_image_candidates ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS exercise_image_candidates (
  uuid           TEXT PRIMARY KEY,
  exercise_uuid  TEXT NOT NULL REFERENCES exercises(uuid) ON DELETE CASCADE,
  batch_id       TEXT NOT NULL,
  frame_index    INT  NOT NULL CHECK (frame_index IN (1, 2)),
  url            TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercise_image_candidates_exercise_batch
  ON exercise_image_candidates(exercise_uuid, batch_id);

CREATE INDEX IF NOT EXISTS idx_exercise_image_candidates_created_at
  ON exercise_image_candidates(exercise_uuid, created_at DESC);

-- DB-layer protection: at most one active row per (exercise, frame_index).
-- A pair has TWO active rows (frame 1 + frame 2), so the unique key has to
-- include frame_index — otherwise the index would reject the pair itself.
-- This still rules out the bug-state where two batches end up both marked
-- active for the same frame slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_image_candidates_one_active_per_frame
  ON exercise_image_candidates(exercise_uuid, frame_index)
  WHERE is_active;

-- updated_at maintenance + change_log CDC (mirrors migration 023/024 pattern).
DROP TRIGGER IF EXISTS exercise_image_candidates_updated_at ON exercise_image_candidates;
CREATE TRIGGER exercise_image_candidates_updated_at
  BEFORE UPDATE ON exercise_image_candidates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS exercise_image_candidates_change_log ON exercise_image_candidates;
CREATE TRIGGER exercise_image_candidates_change_log
  AFTER INSERT OR UPDATE OR DELETE ON exercise_image_candidates
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

COMMENT ON TABLE exercise_image_candidates IS
  'AI-generated demo image frames per exercise. Each row = one frame. '
  'Two rows per batch (frame 1 = start position, frame 2 = end position '
  'conditioned on frame 1 via openai.images.edit). is_active row pair is '
  'mirrored into exercises.image_urls/image_count for the demo strip.';

COMMENT ON COLUMN exercise_image_candidates.batch_id IS
  'Groups two rows generated together. Pair is the unit of selection — '
  'mixing frames across batches breaks visual consistency.';

COMMENT ON COLUMN exercise_image_candidates.is_active IS
  'True for the pair currently shown in the demo strip. Enforced unique-'
  'per-exercise via partial index. Mirrored to exercises.image_urls.';

-- ─── exercise_image_generation_jobs ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS exercise_image_generation_jobs (
  uuid                TEXT PRIMARY KEY,
  exercise_uuid       TEXT NOT NULL REFERENCES exercises(uuid) ON DELETE CASCADE,
  batch_id            TEXT,
  request_id          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN (
                        'running',
                        'succeeded',
                        'failed_frame1',
                        'failed_frame2',
                        'failed_db',
                        'rollback_orphan'
                      )),
  openai_request_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  cost_usd_cents      INTEGER NOT NULL DEFAULT 0,
  error_message       TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercise_image_jobs_exercise_started
  ON exercise_image_generation_jobs(exercise_uuid, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_exercise_image_jobs_request_id
  ON exercise_image_generation_jobs(request_id);

DROP TRIGGER IF EXISTS exercise_image_jobs_updated_at ON exercise_image_generation_jobs;
CREATE TRIGGER exercise_image_jobs_updated_at
  BEFORE UPDATE ON exercise_image_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- NOTE: deliberately NO change_log trigger here. The jobs table is
-- server-side audit only — clients don't need it. Saves bytes on every
-- pull and keeps Dexie focused on user-visible state.

COMMENT ON TABLE exercise_image_generation_jobs IS
  'Server-side audit log for AI image generation attempts. Tracks status, '
  'OpenAI request_ids (for cost reconciliation if a frame partially '
  'completed), client-supplied request_id (for PWA-suspend recovery '
  'polling), and estimated cost. Not synced to clients.';

COMMENT ON COLUMN exercise_image_generation_jobs.request_id IS
  'Client-generated UUID. Allows the PWA to identify "did my regenerate '
  'job succeed?" after backgrounding by polling '
  '/image-candidates?request_id=X.';

COMMENT ON COLUMN exercise_image_generation_jobs.status IS
  'running    — in flight (no completion yet)
   succeeded  — both frames + DB writes succeeded
   failed_frame1     — first openai.images.generate call failed
   failed_frame2     — second openai.images.edit call failed; frame 1 blob rolled back
   failed_db         — both blobs uploaded but DB activation failed; both blobs deleted
   rollback_orphan   — failure path tried to del() a blob and del() also failed';
