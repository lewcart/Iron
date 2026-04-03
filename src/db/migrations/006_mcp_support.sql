-- Migration 006: MCP server support
-- Adds is_active flag to workout_plans, training_blocks, and coaching_notes tables

-- ── workout_plans.is_active ───────────────────────────────────────────────────
ALTER TABLE workout_plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;

-- Partial unique index: only one plan can be active at a time
CREATE UNIQUE INDEX IF NOT EXISTS workout_plans_one_active
  ON workout_plans (is_active) WHERE is_active = true;

-- ── training_blocks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_blocks (
  uuid TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT,
  workout_plan_uuid TEXT REFERENCES workout_plans(uuid) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_blocks_plan ON training_blocks(workout_plan_uuid);
CREATE INDEX IF NOT EXISTS idx_training_blocks_dates ON training_blocks(start_date, end_date);

DROP TRIGGER IF EXISTS training_blocks_updated_at ON training_blocks;
CREATE TRIGGER training_blocks_updated_at
  BEFORE UPDATE ON training_blocks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── coaching_notes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_notes (
  uuid TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  category TEXT, -- 'programming' | 'nutrition' | 'recovery' | 'general'
  related_exercise_uuid TEXT REFERENCES exercises(uuid) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coaching_notes_pinned ON coaching_notes(is_pinned) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS idx_coaching_notes_category ON coaching_notes(category);

DROP TRIGGER IF EXISTS coaching_notes_updated_at ON coaching_notes;
CREATE TRIGGER coaching_notes_updated_at
  BEFORE UPDATE ON coaching_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
