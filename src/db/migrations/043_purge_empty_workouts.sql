-- Migration 043: purge empty / canceled workouts.
--
-- A handful of `workouts` rows accumulated where the user tapped Start, then
-- tapped Start again on a different routine (or just changed their mind). The
-- prior `startWorkout()` mutation handled this by stamping `end_time = now()`
-- and `is_current = false` on the abandoned row, leaving a 0-exercise corpse
-- in history (and an inflated session count in week aggregates).
--
-- The application-side fix soft-deletes these as they're created from now on
-- (src/lib/mutations.ts startWorkout). This migration cleans the corpses that
-- already exist on production.
--
-- Criteria: a workout with zero workout_exercises is unambiguously empty.
-- end_time and duration are not part of the criteria — a workout the user
-- intentionally finished without adding exercises is still a corpse.
--
-- Hard delete (not soft delete) because:
--  - workouts table doesn't carry _deleted (sync metadata lives only on Dexie)
--  - no FK rows reference these (workout_exercises count is the predicate)
--  - CDC will append delete change_log entries that the client picks up on
--    next pull and removes from local Dexie.
--
-- Idempotent: re-running on a clean DB is a no-op (no rows match the predicate).

DELETE FROM workouts w
 WHERE NOT EXISTS (
   SELECT 1 FROM workout_exercises we WHERE we.workout_uuid = w.uuid
 );
