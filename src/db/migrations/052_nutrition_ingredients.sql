-- Migration 052: Nutrition ingredients — foods table, week_meal_ingredients
-- join table, is_recipe flag on nutrition_week_meals, and
-- nutrition_week_meal_effective view.
--
-- Design decisions (see docs/plans/2026-06-nutrition-ingredients.md, GATE DECISIONS):
--
-- 1. foods is a promote-on-attach table (starts empty; rows are minted when a
--    user attaches a food to a recipe from the search canonical view). No bulk
--    seed from nutrition_food_entries — avoids forking a second frozen corpus.
--
-- 2. week_meal_ingredients.week_meal_uuid is NULLABLE (type) so the column
--    can later be repurposed for log-level ingredients (fast-follow). A CHECK
--    constraint enforces NOT NULL for MVP. A log_uuid column can be added in a
--    later migration; the CHECK updated then.
--
-- 3. is_recipe BOOLEAN on nutrition_week_meals (GATE DECISION 1): macros derive
--    from ingredients ONLY when is_recipe=true. Until explicitly converted, a
--    meal retains its stored aggregate macros. This prevents silent number-drop
--    when the first ingredient is added.
--
-- 4. nutrition_week_meal_effective VIEW is the single SQL source of truth for
--    effective macros. Server, MCP, and template-fill read this view; never
--    re-derive the formula elsewhere (grep-guard test enforces this).
--
-- 5. Full CDC + update_updated_at sync wiring on both new tables so they
--    participate in the unified change_log stream.
--
-- Dependencies: record_change_uuid() and update_updated_at() functions already
-- exist (migration 005 + 019).

-- ─── foods ───────────────────────────────────────────────────────────────────
--
-- Canonical ingredient table. Each row represents a named food with macros
-- expressed per (per_qty, per_unit). When a food is attached to a recipe
-- ingredient, amount is in per_unit and macros scale as:
--   effective_macro = (amount / per_qty) * food.macro
--
-- per_unit 'serve': macros are per 1 serve; per_qty can be set to the gram
--   weight of a standard serve for future gram-native math.
-- per_unit 'g' / 'ml': macros are per per_qty grams/ml (typically 100).

CREATE TABLE IF NOT EXISTS foods (
  uuid           TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  brand          TEXT,
  -- macros are per (per_qty of per_unit)
  per_unit       TEXT NOT NULL DEFAULT 'serve'
                   CHECK (per_unit IN ('g', 'ml', 'serve')),
  per_qty        NUMERIC NOT NULL DEFAULT 1
                   CHECK (per_qty > 0),
  calories       NUMERIC,
  protein_g      NUMERIC,
  carbs_g        NUMERIC,
  fat_g          NUMERIC,
  -- carry-through from nutrition_food_entries / manual entry
  nutrients      JSONB NOT NULL DEFAULT '{}',
  -- 'manual' | 'fitbee-seed' | future sources
  source         TEXT NOT NULL DEFAULT 'manual',
  -- archive-only deletion (ON DELETE RESTRICT on ingredient rows)
  archived_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_foods_updated_at ON foods(updated_at);
CREATE INDEX IF NOT EXISTS idx_foods_archived_at ON foods(archived_at)
  WHERE archived_at IS NOT NULL;

-- CDC + updated_at triggers (mirroring migration 019 pattern exactly)
DROP TRIGGER IF EXISTS foods_updated_at ON foods;
CREATE TRIGGER foods_updated_at
  BEFORE UPDATE ON foods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS foods_change_log ON foods;
CREATE TRIGGER foods_change_log
  AFTER INSERT OR UPDATE OR DELETE ON foods
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- ─── week_meal_ingredients ────────────────────────────────────────────────────
--
-- Join table: links a Standard Week meal to a food with an amount.
-- amount is in the food's per_unit (grams, ml, or serves depending on per_unit).
-- sort_order controls display order within a meal.
--
-- Polymorphic-parent note: week_meal_uuid is NULLABLE so a future migration can
-- add log_uuid and make this table serve log-level ingredients too. The CHECK
-- below enforces NOT NULL for the MVP — update it when log_uuid is added.

CREATE TABLE IF NOT EXISTS week_meal_ingredients (
  uuid              TEXT PRIMARY KEY,
  week_meal_uuid    TEXT REFERENCES nutrition_week_meals(uuid) ON DELETE CASCADE,
  food_uuid         TEXT NOT NULL REFERENCES foods(uuid) ON DELETE RESTRICT,
  -- amount is in food.per_unit
  amount            NUMERIC NOT NULL CHECK (amount > 0),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- MVP: require a week_meal parent; relax when log_uuid column is added
  CONSTRAINT week_meal_ingredients_has_parent CHECK (week_meal_uuid IS NOT NULL),
  -- prevent duplicate food in the same meal
  UNIQUE (week_meal_uuid, food_uuid)
);

CREATE INDEX IF NOT EXISTS idx_week_meal_ingredients_meal_sort
  ON week_meal_ingredients(week_meal_uuid, sort_order);

CREATE INDEX IF NOT EXISTS idx_week_meal_ingredients_food
  ON week_meal_ingredients(food_uuid);

CREATE INDEX IF NOT EXISTS idx_week_meal_ingredients_updated_at
  ON week_meal_ingredients(updated_at);

-- CDC + updated_at triggers
DROP TRIGGER IF EXISTS week_meal_ingredients_updated_at ON week_meal_ingredients;
CREATE TRIGGER week_meal_ingredients_updated_at
  BEFORE UPDATE ON week_meal_ingredients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS week_meal_ingredients_change_log ON week_meal_ingredients;
CREATE TRIGGER week_meal_ingredients_change_log
  AFTER INSERT OR UPDATE OR DELETE ON week_meal_ingredients
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- ─── nutrition_week_meals: is_recipe flag ─────────────────────────────────────
--
-- GATE DECISION 1: a meal derives macros from its ingredients ONLY when
-- is_recipe = true. Adding an ingredient to a non-recipe meal does not silently
-- supersede the stored aggregate. The user must explicitly "Convert to recipe"
-- (which sets is_recipe = true and optionally clears the stored macros).

ALTER TABLE nutrition_week_meals
  ADD COLUMN IF NOT EXISTS is_recipe BOOLEAN NOT NULL DEFAULT false;

-- ─── nutrition_week_meal_effective VIEW ───────────────────────────────────────
--
-- Single SQL source of truth for effective macros per week meal.
--
-- Logic:
--   is_recipe = false  → use stored aggregate (legacy quick-add)
--   is_recipe = true   → SUM over week_meal_ingredients × foods macro scaling
--                        formula: SUM(amount / NULLIF(per_qty, 0) * macro)
--
-- NULLIF guard on per_qty is defensive: the CHECK (per_qty > 0) already blocks
-- zero, but NULLIF prevents a potential division-by-zero if a row ever bypasses
-- the constraint (e.g. direct DB edit or pre-constraint legacy data).
--
-- All numeric results are explicitly cast to NUMERIC so callers see consistent
-- types regardless of whether the stored or derived path fires.

CREATE OR REPLACE VIEW nutrition_week_meal_effective AS
SELECT
  nwm.uuid,
  nwm.day_of_week,
  nwm.meal_slot,
  nwm.meal_name,
  nwm.is_recipe,
  CASE
    WHEN nwm.is_recipe = false THEN nwm.calories
    ELSE (
      SELECT SUM(wmi.amount / NULLIF(f.per_qty, 0) * f.calories)
      FROM week_meal_ingredients wmi
      JOIN foods f ON f.uuid = wmi.food_uuid
      WHERE wmi.week_meal_uuid = nwm.uuid
    )
  END::NUMERIC AS calories,
  CASE
    WHEN nwm.is_recipe = false THEN nwm.protein_g
    ELSE (
      SELECT SUM(wmi.amount / NULLIF(f.per_qty, 0) * f.protein_g)
      FROM week_meal_ingredients wmi
      JOIN foods f ON f.uuid = wmi.food_uuid
      WHERE wmi.week_meal_uuid = nwm.uuid
    )
  END::NUMERIC AS protein_g,
  CASE
    WHEN nwm.is_recipe = false THEN nwm.carbs_g
    ELSE (
      SELECT SUM(wmi.amount / NULLIF(f.per_qty, 0) * f.carbs_g)
      FROM week_meal_ingredients wmi
      JOIN foods f ON f.uuid = wmi.food_uuid
      WHERE wmi.week_meal_uuid = nwm.uuid
    )
  END::NUMERIC AS carbs_g,
  CASE
    WHEN nwm.is_recipe = false THEN nwm.fat_g
    ELSE (
      SELECT SUM(wmi.amount / NULLIF(f.per_qty, 0) * f.fat_g)
      FROM week_meal_ingredients wmi
      JOIN foods f ON f.uuid = wmi.food_uuid
      WHERE wmi.week_meal_uuid = nwm.uuid
    )
  END::NUMERIC AS fat_g,
  nwm.quality_rating,
  nwm.sort_order,
  nwm.created_at,
  nwm.updated_at
FROM nutrition_week_meals nwm;
