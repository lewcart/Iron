-- Migration 007: Add target_weight and rpe_target to routine sets; add description to workout plans

ALTER TABLE workout_routine_sets
  ADD COLUMN IF NOT EXISTS target_weight NUMERIC,
  ADD COLUMN IF NOT EXISTS rpe_target NUMERIC CHECK (rpe_target IS NULL OR (rpe_target >= 5.0 AND rpe_target <= 10.0));

ALTER TABLE workout_plans
  ADD COLUMN IF NOT EXISTS description TEXT;
