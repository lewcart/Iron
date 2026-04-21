-- Migration 018: exercises.updated_at + trigger
--
-- Why: the sync pull endpoint now emits exercises alongside workout_exercises so the
-- client's Dexie catalog can never drift from the UUIDs that workout rows reference.
-- Incremental pull needs an indexed updated_at to filter by `since`.
--
-- See: src/app/api/sync/pull/route.ts (server-side consumer)
--      src/lib/sync.ts (client-side consumer)

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE exercises SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS exercises_updated_at ON exercises;
CREATE TRIGGER exercises_updated_at
  BEFORE UPDATE ON exercises
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_exercises_updated_at ON exercises(updated_at);
