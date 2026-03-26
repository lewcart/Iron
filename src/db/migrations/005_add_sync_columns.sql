-- Migration 005: Add bodyweight_logs table + updated_at sync columns

-- ── bodyweight_logs table (not in original schema.sql) ────────────────────────
CREATE TABLE IF NOT EXISTS bodyweight_logs (
  uuid TEXT PRIMARY KEY,
  weight_kg NUMERIC NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── workouts ──────────────────────────────────────────────────────────────────
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE workouts SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;

-- ── workout_exercises ─────────────────────────────────────────────────────────
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE workout_exercises SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;

-- ── workout_sets ──────────────────────────────────────────────────────────────
ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE workout_sets SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;

-- ── bodyweight_logs ───────────────────────────────────────────────────────────
ALTER TABLE bodyweight_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE bodyweight_logs SET updated_at = COALESCE(logged_at, NOW()) WHERE updated_at IS NULL;

-- ── Auto-update triggers ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workouts_updated_at ON workouts;
CREATE TRIGGER workouts_updated_at
  BEFORE UPDATE ON workouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS workout_exercises_updated_at ON workout_exercises;
CREATE TRIGGER workout_exercises_updated_at
  BEFORE UPDATE ON workout_exercises
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS workout_sets_updated_at ON workout_sets;
CREATE TRIGGER workout_sets_updated_at
  BEFORE UPDATE ON workout_sets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS bodyweight_logs_updated_at ON bodyweight_logs;
CREATE TRIGGER bodyweight_logs_updated_at
  BEFORE UPDATE ON bodyweight_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Indexes for efficient sync pull queries ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_workouts_updated_at ON workouts(updated_at);
CREATE INDEX IF NOT EXISTS idx_workout_exercises_updated_at ON workout_exercises(updated_at);
CREATE INDEX IF NOT EXISTS idx_workout_sets_updated_at ON workout_sets(updated_at);
CREATE INDEX IF NOT EXISTS idx_bodyweight_logs_updated_at ON bodyweight_logs(updated_at);
