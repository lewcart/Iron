-- Migration 015: Fill nutrition schema gaps so MCP can round-trip a full plan.
--
-- Previously nutrition_week_meals stored only protein + calories (carbs/fat
-- were dropped on write), and there was no place to persist daily macro
-- targets. This migration:
--   1. Adds carbs_g and fat_g columns to nutrition_week_meals.
--   2. Adds a singleton nutrition_targets table (id = 1) for daily macro targets.

ALTER TABLE nutrition_week_meals ADD COLUMN IF NOT EXISTS carbs_g NUMERIC;
ALTER TABLE nutrition_week_meals ADD COLUMN IF NOT EXISTS fat_g NUMERIC;

CREATE TABLE IF NOT EXISTS nutrition_targets (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  calories NUMERIC,
  protein_g NUMERIC,
  carbs_g NUMERIC,
  fat_g NUMERIC,
  updated_at TIMESTAMP DEFAULT NOW()
);
