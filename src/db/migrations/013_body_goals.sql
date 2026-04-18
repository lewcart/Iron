-- Migration 013: User-defined body goals (the "Me" reference set).
-- One row per metric the user wants a target for.

CREATE TABLE IF NOT EXISTS body_goals (
  metric_key TEXT PRIMARY KEY,       -- e.g. 'pbf_pct', 'smm_kg', 'seg_lean_trunk_kg'
  target_value NUMERIC NOT NULL,
  unit TEXT NOT NULL,                -- 'kg', '%', 'cm', 'score', 'level'
  direction TEXT NOT NULL CHECK (direction IN ('higher','lower','match')),
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS body_goals_updated_at ON body_goals;
CREATE TRIGGER body_goals_updated_at
  BEFORE UPDATE ON body_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
