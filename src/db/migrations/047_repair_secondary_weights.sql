-- Migration 047: repair migration 046 damage from SQL precedence bug.
--
-- Migration 046 had `OR ... AND is_custom = false` without parens. SQL
-- AND-binds-tighter than OR, so the FIRST disjunct of every multi-OR clause
-- escaped the is_custom guard. Result: custom exercises whose titles match
-- compound-name patterns (e.g. user-named "Pull Through Variant" or
-- "Front Squat") got stamped with audited weights and weight_source='audited'
-- when they should have stayed at NULL.
--
-- This migration:
--   1. Resets weight_source='audited' on any is_custom=true row (those were
--      collateral damage; custom exercises should never be 'audited' since the
--      audit pass only runs against the bundled catalog).
--   2. Clears their secondary_weights so the math falls back to the legacy
--      0.5 default until Lou explicitly sets per-muscle weights via MCP / UI.
--
-- Defensive: also wipes weight_source on any is_custom=true row that's
-- 'inferred' or 'default', leaving custom exercises with weight_source=NULL
-- (the documented "no audit" state for custom rows). Audited and inferred
-- sources are reserved for the bundled catalog.

UPDATE exercises
SET secondary_weights = NULL,
    weight_source = NULL
WHERE is_custom = true
  AND (weight_source IS NOT NULL OR secondary_weights IS NOT NULL);

-- For bundled catalog rows: re-apply the (now-correctly-parenthesized) audit
-- in 046, but only where weight_source is NULL or 'default' so we don't
-- clobber any manual-override rows Lou may have set via MCP since 046 ran.
-- Idempotent — re-running this migration after editing weights is safe.

-- Subset of 046 that involves multi-OR clauses (the ones at risk from the
-- precedence bug). Single-OR clauses don't need re-application.

UPDATE exercises SET
  secondary_weights = jsonb_build_object('hamstrings', 0.5, 'erectors', 0.4),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%pull-through%' OR LOWER(title) LIKE '%pull through%')
  AND is_custom = false
  AND (weight_source IS NULL OR weight_source = 'default');

UPDATE exercises SET
  secondary_weights = jsonb_build_object('hamstrings', 0.3, 'hip_abductors', 0.4, 'hip_adductors', 0.3),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%step-up%' OR LOWER(title) LIKE '%step up%')
  AND is_custom = false
  AND (weight_source IS NULL OR weight_source = 'default');

UPDATE exercises SET
  secondary_weights = jsonb_build_object('glutes', 0.5, 'quads', 0.4, 'lats', 0.4, 'mid_traps', 0.5, 'forearms', 0.5),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%conventional deadlift%' OR LOWER(title) = 'deadlift' OR LOWER(title) LIKE '%barbell deadlift%')
  AND is_custom = false
  AND LOWER(title) NOT LIKE '%sumo%'
  AND (weight_source IS NULL OR weight_source = 'default');

UPDATE exercises SET
  secondary_weights = jsonb_build_object('glutes', 0.6, 'hamstrings', 0.3, 'hip_adductors', 0.5, 'erectors', 0.5),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%back squat%' OR LOWER(title) = 'squat')
  AND is_custom = false
  AND (weight_source IS NULL OR weight_source = 'default');

UPDATE exercises SET
  secondary_weights = jsonb_build_object('hamstrings', 0.3, 'hip_adductors', 0.5, 'hip_abductors', 0.4),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%walking lunge%' OR LOWER(title) = 'lunge')
  AND is_custom = false
  AND (weight_source IS NULL OR weight_source = 'default');

UPDATE exercises SET
  secondary_weights = jsonb_build_object('triceps', 0.6, 'mid_traps', 0.5, 'core', 0.4),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%overhead press%' OR LOWER(title) LIKE '%ohp%' OR LOWER(title) LIKE '%standing press%')
  AND is_custom = false
  AND (weight_source IS NULL OR weight_source = 'default');

UPDATE exercises SET
  secondary_weights = jsonb_build_object('delts', 0.5, 'triceps', 0.7),
  weight_source = 'audited'
WHERE (LOWER(title) = 'dips' OR LOWER(title) LIKE '%chest dip%')
  AND is_custom = false
  AND (weight_source IS NULL OR weight_source = 'default');

UPDATE exercises SET
  secondary_weights = jsonb_build_object('biceps', 0.7, 'delts', 0.3, 'core', 0.4),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%pull-up%' OR LOWER(title) LIKE '%pull up%' OR LOWER(title) LIKE '%chin-up%' OR LOWER(title) LIKE '%chin up%')
  AND is_custom = false
  AND (weight_source IS NULL OR weight_source = 'default');

UPDATE exercises SET
  secondary_weights = jsonb_build_object('biceps', 0.6, 'mid_traps', 0.7, 'delts', 0.4),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%seated cable row%' OR LOWER(title) LIKE '%seated row%')
  AND is_custom = false
  AND (weight_source IS NULL OR weight_source = 'default');

UPDATE exercises SET
  secondary_weights = jsonb_build_object('mid_traps', 0.5, 'rotator_cuff', 0.3),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%rear delt fly%' OR LOWER(title) LIKE '%bent-over fly%')
  AND is_custom = false
  AND (weight_source IS NULL OR weight_source = 'default');

UPDATE exercises SET
  secondary_weights = jsonb_build_object('forearms', 0.4),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%dumbbell curl%' OR LOWER(title) LIKE '%db curl%')
  AND LOWER(title) NOT LIKE '%hammer%'
  AND is_custom = false
  AND (weight_source IS NULL OR weight_source = 'default');
