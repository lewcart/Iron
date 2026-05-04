-- Migration 041: per-set "excluded from PB" flag.
--
-- Why: Lou sometimes realizes they were doing an exercise wrong (partial-rep
-- bench, shallow leg press, kipping pullup) AFTER PBs have been recorded.
-- Today the only fix is to delete the set, which loses the workout record.
-- This flag lets a set stay in history (counts toward volume / set-counts)
-- but be invisible to PR / PB calculations.
--
-- Two entry points use this flag:
--   - per-set toggle in the workout history / exercise-detail UI
--   - per-exercise "Adjust PB history" sheet that bulk-flags sets up to and
--     including a chosen cutoff date (the form-fix moment).
--
-- A separate app-level helper (recomputePRFlagsForExercise) walks the
-- canonical exercise group's completed non-excluded sets in chronological
-- order and re-stamps `is_pr` after any change to this column or to a
-- set's weight / repetitions / is_completed.
--
-- Schema-only migration: no backfill needed (default false matches "every
-- existing set still counts for PB"). Recompute is idempotent and runs at
-- runtime, not at migration time.

ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS excluded_from_pb BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_workout_sets_excluded_from_pb
  ON workout_sets(excluded_from_pb)
  WHERE excluded_from_pb = true;
