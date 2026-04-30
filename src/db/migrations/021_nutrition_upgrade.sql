-- Migration 020: Nutrition page upgrade
--
-- Adds:
--   1. Day-approval state (pending|approved) to nutrition_day_notes. The
--      "auto-approved" / "logged" state is NOT stored, it is derived in the
--      application layer at render time as `pending && date < today`. This
--      avoids writing under read traffic and keeps the DB simple.
--   2. Per-macro adherence bands (JSONB) on nutrition_targets. Each macro
--      has an asymmetric band, default values reflect typical guidance
--      (cal +/-10%, protein -10%/no upper cap, carb +/-15%, fat -15%/+20%).
--   3. pg_trgm extension + GIN index on food_name for fuzzy substring
--      search on nutrition_food_entries (powers the AddFoodSheet autocomplete
--      Layer 1 search).
--   4. nutrition_food_canonical view, de-duplicated foods keyed by lowercase
--      food_name, surfacing the most-recently-logged macros and a
--      times_logged frequency count for ranking.
--
-- See:
--   src/app/nutrition/today/AddFoodSheet.tsx (Layer 1 consumer)
--   src/app/api/nutrition/foods/route.ts (search endpoint)
--   src/lib/mutations-nutrition.ts (approveDayNote, setNutritionTargets)
--
-- Note: migrate.ts splits raw on the statement separator and does not strip
-- comments, so all comment lines below are kept free of that separator.

-- Day-approval state

ALTER TABLE nutrition_day_notes
  ADD COLUMN IF NOT EXISTS approved_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approved_status IN ('pending', 'approved')),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Partial index, we only query pending rows so don't waste index space on the rest.
CREATE INDEX IF NOT EXISTS idx_nutrition_day_notes_pending
  ON nutrition_day_notes(date)
  WHERE approved_status = 'pending';

-- Per-macro adherence bands.
-- JSONB so future edits don't need another migration. Default reflects
-- asymmetric tolerances per macro.

ALTER TABLE nutrition_targets
  ADD COLUMN IF NOT EXISTS bands JSONB NOT NULL DEFAULT '{"cal":{"low":-0.10,"high":0.10},"pro":{"low":-0.10,"high":null},"carb":{"low":-0.15,"high":0.15},"fat":{"low":-0.15,"high":0.20}}'::jsonb;

-- Food search infrastructure.
-- pg_trgm enables `food_name % q` (trigram similarity) and the gin_trgm_ops
-- index makes substring LIKE matches index-backed instead of seq-scan.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_nutrition_food_entries_name_trgm
  ON nutrition_food_entries
  USING gin (food_name gin_trgm_ops);

-- Canonical foods view.
-- One row per distinct food_name (case-insensitive, trim-normalized).
-- Surfaces the most-recently-logged macros for that food plus a
-- times_logged frequency count. Drives AddFoodSheet ranking.

CREATE OR REPLACE VIEW nutrition_food_canonical AS
SELECT DISTINCT ON (lower(trim(food_name)))
  lower(trim(food_name))                                        AS canonical_name,
  food_name,
  calories,
  protein_g,
  carbs_g,
  fat_g,
  nutrients,
  logged_at                                                     AS last_logged_at,
  count(*) OVER (PARTITION BY lower(trim(food_name)))           AS times_logged
FROM nutrition_food_entries
ORDER BY lower(trim(food_name)), logged_at DESC;
