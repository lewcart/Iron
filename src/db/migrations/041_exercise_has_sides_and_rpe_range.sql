-- Migration 041: Unilateral-flag on exercises + RPE range realignment
--
-- Two additive changes that ship together because the in-workout stopwatch
-- feature touches both:
--
--   1. exercises.has_sides — when true, the exercise is performed
--      unilaterally (each leg / each arm). The new in-workout stopwatch
--      enters a 10-second "switch sides" countdown after the user stops
--      the first side, then resumes counting up for the second side.
--
--   2. workout_sets.rpe range realignment — the original 001_core_schema
--      check constraint allowed only 7.0–10.0 (because UI never collected
--      it and the legacy convention assumed Borg-style RPE). Time-mode
--      exercises (planks, holds, isometrics) now collect RPE 1–10 as the
--      proximity-to-failure proxy, hidden behind a chip strip on
--      `SetRow`. We drop the old constraint and add an integer 1–10 check.
--
-- RPE → RIR bridge — server side: the workout_sets UPSERT in
-- api/sync/push/route.ts derives `rir = clamp(10 - rpe, 0, 5)` for sets
-- whose joined exercise is time-mode. This keeps the existing RIR-based
-- effective_set_count weighting (queries.ts:1367) working without SQL
-- changes. Client-pushed `rir` is ignored for time-mode rows.
--
-- See:
--   - PLAN-exercise-timer.md (autoplan output for this branch)
--   - src/db/migrations/022_tracking_mode.sql (precedent for additive
--     exercise columns)
--   - src/db/local.ts (Dexie v20 mirror)

ALTER TABLE exercises
  ADD COLUMN has_sides BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN exercises.has_sides IS
  'When true, the exercise is performed unilaterally (each leg / each '
  'arm). In-workout stopwatch enters a 10-second switch countdown after '
  'the user stops the first side, then resumes counting up for the '
  'second side. Default false for legacy and bilateral exercises.';

-- Drop legacy 7.0–10.0 RPE check. UI never wrote it, so no rows depend
-- on the old range, but the constraint blocks the new 1–10 convention
-- for time-mode exercises.
ALTER TABLE workout_sets DROP CONSTRAINT IF EXISTS workout_sets_rpe_check;

ALTER TABLE workout_sets ADD CONSTRAINT workout_sets_rpe_check
  CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10 AND rpe = floor(rpe)));

COMMENT ON COLUMN workout_sets.rpe IS
  'Time-mode: integer RPE 1-10 (10 = volitional failure / form broke). '
  'The server derives rir = clamp(10 - rpe, 0, 5) on sync push for '
  'time-mode sets — see api/sync/push/route.ts. Rep-mode: column unused '
  '(UI collects RIR directly). Legacy rows may carry the old 7.0-10.0 '
  'float values; the floor() check accepts integer-valued legacy data.';
