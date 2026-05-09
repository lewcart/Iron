-- Migration 046: seed audited per-exercise secondary weights (v1.1).
--
-- Applies SME-grounded weights from the /autoplan Androgodess pass to the
-- ~25 high-impact compounds in Lou's catalog. Weights cite EMG / Schoenfeld
-- stretch-mediated work / RP convention / biomechanics inference. Where the
-- SME proposed a value DIFFERENT from the legacy 0.5 default, we encode it
-- here so the volume math reads honestly.
--
-- Title-based matches handle catalog-name variants (idempotent — safe to
-- re-run). For exercises not matched here, secondary_weights stays NULL and
-- the math falls back to the legacy 0.5 default. Custom user exercises
-- always start at NULL until manually set.
--
-- weight_source = 'audited' for all rows seeded here. The MCP write path
-- (update_exercise) flips the source to 'manual-override' on user-driven
-- changes so the exercise page UI can distinguish reliable from override.
--
-- See docs/plans/routine-volume-drilldown-and-weights.md for the full SME
-- table with sources and rationales.

-- ── Posterior chain / glute-relevant compounds ─────────────────────────────

-- Hip thrust (barbell): hams 0.4 (lockout co-activation, no stretch),
--   adductors 0.3 (adductor magnus is a hip extensor), quads 0.0 (drop).
UPDATE exercises SET
  secondary_weights = jsonb_build_object('hamstrings', 0.4, 'hip_adductors', 0.3),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%hip thrust%' AND is_custom = false;

-- Romanian deadlift: glutes 0.6 (loaded stretch — slightly higher than RP
--   convention 0.5 per Schoenfeld), erectors 0.7, adductors 0.4, lats 0.2.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('glutes', 0.6, 'erectors', 0.7, 'hip_adductors', 0.4, 'lats', 0.2),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%romanian deadlift%' AND is_custom = false;

-- Single-leg RDL: glutes 0.7 (deeper stretch + unilateral gmed demand),
--   hip_abductors 0.6, erectors 0.5.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('glutes', 0.7, 'hip_abductors', 0.6, 'erectors', 0.5),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%single leg rdl%' AND is_custom = false;

-- Bulgarian split squat: glutes 0.7 (deep hip flexion under load),
--   hams 0.3, adductors 0.5, hip_abductors 0.4.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('glutes', 0.7, 'hamstrings', 0.3, 'hip_adductors', 0.5, 'hip_abductors', 0.4),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%bulgarian split squat%' AND is_custom = false;

-- Leg press: glutes 0.3 (standard depth — high+wide+deep variant 0.5+,
--   flagged in plan as ROM-variant ambiguity), hams 0.2, adductors 0.3.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('glutes', 0.3, 'hamstrings', 0.2, 'hip_adductors', 0.3),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%leg press%' AND is_custom = false;

-- Cable pull-through: hams 0.5 (knee-soft hip extension), erectors 0.4.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('hamstrings', 0.5, 'erectors', 0.4),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%pull-through%' OR LOWER(title) LIKE '%pull through%')
  AND is_custom = false;

-- Cable kickback: hams 0.3, erectors 0.2.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('hamstrings', 0.3, 'erectors', 0.2),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%cable kickback%' AND is_custom = false;

-- Cable hip abduction: glutes 0.5 (gmax upper fibers — plan's 0.8 was too
--   high; gmed is the true primary).
UPDATE exercises SET
  secondary_weights = jsonb_build_object('glutes', 0.5),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%cable hip abduction%' AND is_custom = false;

-- Hip abduction (machine): glutes 0.4 (machine restricts ROM vs cable).
UPDATE exercises SET
  secondary_weights = jsonb_build_object('glutes', 0.4),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%machine hip abduction%' AND is_custom = false;

-- Step-up: hams 0.3, hip_abductors 0.4, adductors 0.3.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('hamstrings', 0.3, 'hip_abductors', 0.4, 'hip_adductors', 0.3),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%step-up%' OR LOWER(title) LIKE '%step up%')
  AND is_custom = false;

-- Conventional deadlift: glutes 0.5, quads 0.4, lats 0.4, traps 0.5,
--   forearms 0.5 (grip).
UPDATE exercises SET
  secondary_weights = jsonb_build_object('glutes', 0.5, 'quads', 0.4, 'lats', 0.4, 'mid_traps', 0.5, 'forearms', 0.5),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%conventional deadlift%' OR LOWER(title) = 'deadlift' OR LOWER(title) LIKE '%barbell deadlift%')
  AND is_custom = false
  AND LOWER(title) NOT LIKE '%sumo%';

-- Sumo deadlift: hams 0.4, adductors 0.6 (wide stance), erectors 0.5,
--   traps 0.5, forearms 0.5.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('hamstrings', 0.4, 'hip_adductors', 0.6, 'erectors', 0.5, 'mid_traps', 0.5, 'forearms', 0.5),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%sumo deadlift%' AND is_custom = false;

-- Back squat: glutes 0.6 (Schoenfeld 2019 — depth-dependent), hams 0.3,
--   adductors 0.5, erectors 0.5.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('glutes', 0.6, 'hamstrings', 0.3, 'hip_adductors', 0.5, 'erectors', 0.5),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%back squat%' OR LOWER(title) = 'squat')
  AND is_custom = false;

-- Front squat: glutes 0.4, adductors 0.4, erectors 0.5, core 0.5
--   (front-rack anti-flexion).
UPDATE exercises SET
  secondary_weights = jsonb_build_object('glutes', 0.4, 'hip_adductors', 0.4, 'erectors', 0.5, 'core', 0.5),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%front squat%' AND is_custom = false;

-- Walking lunge: hams 0.3, adductors 0.5, hip_abductors 0.4.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('hamstrings', 0.3, 'hip_adductors', 0.5, 'hip_abductors', 0.4),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%walking lunge%' OR LOWER(title) = 'lunge')
  AND is_custom = false;

-- ── Knee-flexion isolation — glute credit drops to 0 ───────────────────────

-- Lying / seated leg curl: glutes 0.0 (drop — pure knee-flexion isolation,
--   catalogs that tag glutes here are wrong). Calves (gastroc) 0.3 — gastroc
--   crosses knee.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('glutes', 0.0, 'calves', 0.3),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%leg curl%' AND is_custom = false;

-- Leg extension: pure quad isolation. No secondary credit.
UPDATE exercises SET
  secondary_weights = '{}'::jsonb,
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%leg extension%' AND is_custom = false;

-- Calf raise: pure isolation.
UPDATE exercises SET
  secondary_weights = '{}'::jsonb,
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%calf raise%' AND is_custom = false;

-- ── Pressing / shoulder ───────────────────────────────────────────────────

-- Bench press: triceps 0.6, delts 0.6 (front delts — anterior dominates).
--   CRITICAL: no lateral-delt credit. Catalogs that credit 0.5 are wrong.
--   Lou's lateral-spec gap depends on this being honest.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('triceps', 0.6, 'delts', 0.6),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%bench press%' AND is_custom = false;

-- Overhead press: triceps 0.6, mid_traps 0.5 (scapular elevation), core 0.4
--   (standing OHP). Lateral delts already PRIMARY for OHP if catalog tags
--   it that way — secondary_weights doesn't double-credit primary.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('triceps', 0.6, 'mid_traps', 0.5, 'core', 0.4),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%overhead press%' OR LOWER(title) LIKE '%ohp%' OR LOWER(title) LIKE '%standing press%')
  AND is_custom = false;

-- Dips: front delts 0.5 (always co-recruited), triceps 0.7 if chest-primary.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('delts', 0.5, 'triceps', 0.7),
  weight_source = 'audited'
WHERE (LOWER(title) = 'dips' OR LOWER(title) LIKE '%chest dip%')
  AND is_custom = false;

-- ── Pulling / back ────────────────────────────────────────────────────────

-- Dumbbell row (single arm or two-arm): biceps 0.6, mid_traps 0.6,
--   forearms 0.4, delts 0.5 (rear-delt activation, esp wide-elbow).
UPDATE exercises SET
  secondary_weights = jsonb_build_object('biceps', 0.6, 'mid_traps', 0.6, 'forearms', 0.4, 'delts', 0.5),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%dumbbell row%' AND is_custom = false;

-- Lat pulldown: biceps 0.5, delts 0.3 (rear delts on wide grip), mid_traps 0.4.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('biceps', 0.5, 'delts', 0.3, 'mid_traps', 0.4),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%pulldown%' AND is_custom = false;

-- Pull-up / chin-up: biceps 0.7 (chin underhand near-primary), delts 0.3,
--   core 0.4 (anti-extension).
UPDATE exercises SET
  secondary_weights = jsonb_build_object('biceps', 0.7, 'delts', 0.3, 'core', 0.4),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%pull-up%' OR LOWER(title) LIKE '%pull up%' OR LOWER(title) LIKE '%chin-up%' OR LOWER(title) LIKE '%chin up%')
  AND is_custom = false;

-- Seated cable row (low row): biceps 0.6, mid_traps 0.7, delts 0.4.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('biceps', 0.6, 'mid_traps', 0.7, 'delts', 0.4),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%seated cable row%' OR LOWER(title) LIKE '%seated row%')
  AND is_custom = false;

-- ── Shoulder isolation ────────────────────────────────────────────────────

-- Lateral raise (DB or cable): mid_traps 0.3 (cheating reps higher).
--   Note: lateral_emphasis=true on these — virtual delts_lateral row
--   already handles the sub-muscle credit.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('mid_traps', 0.3),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%lateral raise%' AND is_custom = false;

-- Face pull: mid_traps 0.6, rotator_cuff 0.5 (Lou's RC is over MAV;
--   weighted honestly).
UPDATE exercises SET
  secondary_weights = jsonb_build_object('mid_traps', 0.6, 'rotator_cuff', 0.5),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%face pull%' AND is_custom = false;

-- Rear delt fly: mid_traps 0.5 (always co-recruited), rotator_cuff 0.3.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('mid_traps', 0.5, 'rotator_cuff', 0.3),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%rear delt fly%' OR LOWER(title) LIKE '%bent-over fly%')
  AND is_custom = false;

-- ── Arm isolation ─────────────────────────────────────────────────────────

-- DB curl: forearms (brachioradialis) 0.4.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('forearms', 0.4),
  weight_source = 'audited'
WHERE (LOWER(title) LIKE '%dumbbell curl%' OR LOWER(title) LIKE '%db curl%')
  AND LOWER(title) NOT LIKE '%hammer%'
  AND is_custom = false;

-- Hammer curl: brachioradialis (forearms) 0.7 — near-primary.
UPDATE exercises SET
  secondary_weights = jsonb_build_object('forearms', 0.7),
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%hammer curl%' AND is_custom = false;

-- Tricep pushdown: pure isolation.
UPDATE exercises SET
  secondary_weights = '{}'::jsonb,
  weight_source = 'audited'
WHERE LOWER(title) LIKE '%pushdown%' AND is_custom = false;

-- ── Backfill: every other catalog exercise gets weight_source='default' ───
-- (so the exercise page can distinguish "no audit" from "audit empty").
UPDATE exercises SET weight_source = 'default'
WHERE weight_source IS NULL AND is_custom = false;
