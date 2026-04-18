-- Migration 011: backfill distinct order_index for workout_plans
-- Existing rows were created before the reorder UI existed and defaulted to 0,
-- which made swap-based reordering a no-op. Renumber by created_at.

UPDATE workout_plans p
SET order_index = sub.rn - 1
FROM (
  SELECT uuid, ROW_NUMBER() OVER (ORDER BY order_index ASC, created_at ASC) AS rn
  FROM workout_plans
) sub
WHERE p.uuid = sub.uuid;
