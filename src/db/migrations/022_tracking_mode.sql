-- Migration 020: Time-based exercise tracking
--
-- Adds support for exercises that are tracked by held duration (e.g. plank
-- for 60s) instead of weight × reps. Schema is additive — every existing
-- exercise defaults to 'reps' mode and continues to behave exactly as before.
--
-- Per /plan-eng-review (2026-04-30) decisions:
--   - Mode is exercise-level (one source of truth), freely mutable. Flipping
--     mode is a retroactive correction (not history-rewriting), so no lock.
--   - workout_sets.duration_seconds = the actually-logged duration.
--   - workout_routine_sets.target_duration_seconds = the routine template
--     target (mirrors min_target_reps/max_target_reps split for reps mode).
--   - Mode filtering for 1RM eligibility happens at the SQL JOIN, not in
--     pure helpers (defense at the data boundary).
--
-- See:
--   - src/db/local.ts (Dexie v6 mirrors these columns)
--   - src/lib/pr.ts (calculateTimePRs for longest-hold)
--   - src/app/api/sync/{pull,push}/route.ts (envelope serializers)

ALTER TABLE exercises
  ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'reps'
  CHECK (tracking_mode IN ('reps', 'time'));

ALTER TABLE workout_sets
  ADD COLUMN duration_seconds INTEGER;

ALTER TABLE workout_routine_sets
  ADD COLUMN target_duration_seconds INTEGER;

-- Surface the new fields on the change_log so sync pull picks them up.
-- The trigger fires on UPDATE OF any column, so no trigger change is
-- strictly needed — but the documented column list is updated for clarity
-- in the audit query that follows.
COMMENT ON COLUMN exercises.tracking_mode IS
  'How sets for this exercise are tracked: ''reps'' (weight × repetitions) '
  'or ''time'' (duration_seconds hold). Default ''reps''. Mode is freely '
  'mutable; changing it reinterprets historical sets, treating prior data '
  'as having always been the new mode.';

COMMENT ON COLUMN workout_sets.duration_seconds IS
  'Held duration in seconds. Populated only for sets of time-mode exercises. '
  'NULL for reps-mode sets (use weight + repetitions instead).';

COMMENT ON COLUMN workout_routine_sets.target_duration_seconds IS
  'Routine template target hold in seconds. Populated only for time-mode '
  'exercises. Mirrors min_target_reps/max_target_reps for the rep case.';
