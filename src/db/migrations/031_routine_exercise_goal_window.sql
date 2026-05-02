-- Migration 031: goal_window on routine exercises.
--
-- Adds a per-exercise rep-range goal (Strength/Power/Build/Pump/Endurance) to
-- workout_routine_exercises. Single source of truth for the window registry
-- lives at src/lib/rep-windows.ts — backend, frontend, and MCP all import it.
--
-- Window semantics (canonical):
--   strength  → 4–6 reps
--   power     → 6–8 reps
--   build     → 8–12 reps
--   pump      → 12–15 reps
--   endurance → 15–30 reps (catch-only; never selected explicitly)
--
-- Upper bound is INCLUSIVE: a set of exactly 8 reps stays in Power; the 9th
-- rep is what escalates the lifter into Build. The next-window edge is the
-- progression rule's "go heavier" trigger, not the goal-window edge.
--
-- Backfill is intentionally NOT done here: per-set min_repetitions / max_
-- repetitions on workout_routine_sets remain authoritative for legacy rows.
-- The audit screen surfaces routines whose set-level targets snap to a known
-- window so the user can confirm assignment exercise-by-exercise. Once a
-- routine has goal_window set, set spawning resolves min/max via the registry
-- (set-level overrides on workout_routine_sets still take precedence when
-- present).
--
-- NULL goal_window = no assignment (legacy or custom). Production queries
-- treat NULL as "fall back to set-level min/max_repetitions."

ALTER TABLE workout_routine_exercises
  ADD COLUMN IF NOT EXISTS goal_window TEXT;

ALTER TABLE workout_routine_exercises
  DROP CONSTRAINT IF EXISTS workout_routine_exercises_goal_window_check;

ALTER TABLE workout_routine_exercises
  ADD CONSTRAINT workout_routine_exercises_goal_window_check
  CHECK (goal_window IS NULL OR goal_window IN
    ('strength', 'power', 'build', 'pump', 'endurance'));

COMMENT ON COLUMN workout_routine_exercises.goal_window IS
  'Rep-window goal (strength|power|build|pump|endurance) per src/lib/rep-windows.ts. '
  'NULL = unassigned (legacy or custom range). Set-level min_repetitions/max_repetitions '
  'on workout_routine_sets take precedence when both are present.';
