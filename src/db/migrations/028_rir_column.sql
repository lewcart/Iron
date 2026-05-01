-- Migration 028: Reps-in-Reserve (RIR) column on workout_sets.
--
-- Phase 2 of the sets-per-muscle initiative. Adds a separate `rir` column
-- (0–5) for per-set effort capture. The pre-existing `rpe` column from
-- migration 001 is left in place for back-compat; UI does not write to it.
--
-- RIR semantics:
--   0 = went to failure (no reps left)
--   1 = 1 rep left in the tank
--   …
--   5 = 5+ reps left (light enough not to count for hypertrophy)
--   NULL = not recorded (default; treated as "in range" by Phase 3 weighting
--          until a corpus of real data exists)
--
-- Phase 3 (queries.ts getWeekSetsPerMuscle) consumes this column to compute
-- effective_set_count: RIR 0–3 = 1.0, RIR 4 = 0.5, RIR 5+ = 0.0, NULL = 1.0.

ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS rir INT;

-- Constraint added separately so the migration is rerunnable: dropping +
-- recreating an existing constraint with the same name is safe.
ALTER TABLE workout_sets
  DROP CONSTRAINT IF EXISTS workout_sets_rir_range;

ALTER TABLE workout_sets
  ADD CONSTRAINT workout_sets_rir_range
  CHECK (rir IS NULL OR (rir BETWEEN 0 AND 5));

COMMENT ON COLUMN workout_sets.rir IS
  'Reps in Reserve (0-5). 0=failure, 5=5+ left. NULL=not recorded. '
  'Phase 2 of sets-per-muscle plan; Phase 3 weights this for effective set counting.';
