-- 036_nutrition_week_template_autofill.sql
--
-- Aligns the Standard Week template with the Today log's slot taxonomy and
-- wires the long-planned auto-fill mechanism that was schema-ready but never
-- shipped.
--
-- Two changes:
--   1. nutrition_week_meals.meal_slot becomes a strict enum
--      ('breakfast','lunch','dinner','snack'). Previously TEXT NOT NULL with
--      no constraint, used as free-text ("breakfast", "snack 1", "snack 2"…).
--      The Today page already groups by the strict meal_type enum; the Week
--      page now matches.
--   2. nutrition_day_notes gains template_applied_at TIMESTAMPTZ. When a date
--      is opened (Today/Yesterday view, or any aggregator), the app
--      materializes that day-of-week's standard week template into
--      nutrition_logs rows with status='planned' and template_meal_id set.
--      template_applied_at is the idempotency stamp — once set, never re-fill
--      for that date, even if the user later deletes those logs.
--
-- nutrition_logs.status='planned'/'deviation'/'added' and
-- nutrition_logs.template_meal_id were added in earlier schema work and have
-- been waiting for a UI consumer. This migration is what finally makes them
-- meaningful.

-- ─── 1. Backfill meal_slot to enum values ────────────────────────────────────
--
-- Strategy: case-insensitive substring match on the existing free-text. Any
-- row containing "breakfast" → 'breakfast', etc. Anything that doesn't match
-- (e.g., legacy "snack 1" / "morning snack" / blank) defaults to 'snack' —
-- snack is the catch-all on the Today view too.

UPDATE nutrition_week_meals
SET meal_slot = CASE
  WHEN LOWER(meal_slot) LIKE '%breakfast%' THEN 'breakfast'
  WHEN LOWER(meal_slot) LIKE '%lunch%'     THEN 'lunch'
  WHEN LOWER(meal_slot) LIKE '%dinner%'    THEN 'dinner'
  ELSE 'snack'
END
WHERE meal_slot IS NULL
   OR meal_slot NOT IN ('breakfast','lunch','dinner','snack');

ALTER TABLE nutrition_week_meals
  DROP CONSTRAINT IF EXISTS nutrition_week_meals_meal_slot_check;

ALTER TABLE nutrition_week_meals
  ADD CONSTRAINT nutrition_week_meals_meal_slot_check
    CHECK (meal_slot IN ('breakfast','lunch','dinner','snack'));

-- ─── 2. template_applied_at on day notes ─────────────────────────────────────
--
-- NULL = never auto-filled. Set to NOW() the first time the app materializes
-- the standard week template into nutrition_logs for this date.

ALTER TABLE nutrition_day_notes
  ADD COLUMN IF NOT EXISTS template_applied_at TIMESTAMPTZ;
