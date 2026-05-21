-- Rollback for migration 049.

DROP INDEX IF EXISTS idx_workout_exercises_superset_group;
DROP INDEX IF EXISTS idx_workout_routine_exercises_superset_group;

ALTER TABLE workout_exercises
  DROP COLUMN IF EXISTS superset_group_uuid,
  DROP COLUMN IF EXISTS superset_round_target,
  DROP COLUMN IF EXISTS superset_rest_override_seconds;

ALTER TABLE workout_routine_exercises
  DROP COLUMN IF EXISTS superset_group_uuid,
  DROP COLUMN IF EXISTS superset_round_target,
  DROP COLUMN IF EXISTS superset_rest_override_seconds;
