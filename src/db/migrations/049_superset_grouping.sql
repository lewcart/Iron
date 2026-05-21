-- Migration 049: superset grouping on workout_exercises + workout_routine_exercises.
--
-- Two or more exercises in the same workout (or same routine) that share a
-- non-null superset_group_uuid form a superset. Group identity is the shared
-- UUID; metadata (round_target, rest_override_seconds) lives on the lowest-
-- order_index member of each group. No separate superset_groups table — at
-- N=0-2 groups per workout (the common case), a column-only approach skips
-- the sync handler / pull mapper / MCP create+delete tools the table would
-- require. Schema promotes to a table later non-breakingly if group-level
-- metadata grows beyond the 2 scalars.
--
-- See /Users/lewis/.gstack/projects/lewcart-Iron/main-supersets-dropsets-plan-20260522-065756.md
-- "User challenge decisions (locked at final gate)" UC1 for the rationale.
--
-- Drop chains are NOT touched by this migration. The existing `tag = 'dropSet'`
-- marker on workout_sets and workout_routine_sets is sufficient — drop chains
-- are recognized by tag + adjacency-by-order_index within an exercise. Per
-- UC2 (locked), no new column on the set rows.

ALTER TABLE workout_exercises
  ADD COLUMN superset_group_uuid TEXT,
  ADD COLUMN superset_round_target INTEGER,
  ADD COLUMN superset_rest_override_seconds INTEGER;

ALTER TABLE workout_routine_exercises
  ADD COLUMN superset_group_uuid TEXT,
  ADD COLUMN superset_round_target INTEGER,
  ADD COLUMN superset_rest_override_seconds INTEGER;

-- Partial indexes — only paths through grouped rows pay the index cost.
-- N=0 groups (the common case) sees no size impact.
CREATE INDEX idx_workout_exercises_superset_group
  ON workout_exercises(superset_group_uuid)
  WHERE superset_group_uuid IS NOT NULL;

CREATE INDEX idx_workout_routine_exercises_superset_group
  ON workout_routine_exercises(superset_group_uuid)
  WHERE superset_group_uuid IS NOT NULL;
