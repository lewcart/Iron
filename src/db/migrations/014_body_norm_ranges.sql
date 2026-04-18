-- Migration 014: Seeded body norm ranges (Male / Female).
-- Each row gives a healthy [low, high] band for a metric, optionally scoped by
-- age and height. Source is cited per row. Metrics whose "normal" is heavily
-- individual (e.g. absolute SMM in kg, BMR in kcal) are intentionally NOT
-- seeded — we only catalogue metrics with authoritative, generalisable norms.

CREATE TABLE IF NOT EXISTS body_norm_ranges (
  id SERIAL PRIMARY KEY,
  sex TEXT NOT NULL CHECK (sex IN ('M','F')),
  metric_key TEXT NOT NULL,
  age_min INTEGER,                   -- inclusive, null = no lower bound
  age_max INTEGER,                   -- inclusive
  height_min_cm NUMERIC,             -- null = no lower bound (most metrics are height-independent)
  height_max_cm NUMERIC,
  low NUMERIC NOT NULL,              -- lower healthy bound
  high NUMERIC NOT NULL,             -- upper healthy bound
  source TEXT,                       -- 'InBody 570 reference', 'ACSM', 'WHO', etc.
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_body_norm_ranges_lookup
  ON body_norm_ranges(sex, metric_key);

-- ── Seeds ─────────────────────────────────────────────────────────────────────
-- Numbers are drawn from published guidelines. Sources are cited per row.
-- When two overlapping guidelines exist we pick the most conservative band.

-- BMI: same range both sexes (WHO)
INSERT INTO body_norm_ranges (sex, metric_key, age_min, age_max, low, high, source, notes) VALUES
  ('M', 'bmi', 18, NULL, 18.5, 24.9, 'WHO', 'Adult healthy BMI band (18.5–24.9)'),
  ('F', 'bmi', 18, NULL, 18.5, 24.9, 'WHO', 'Adult healthy BMI band (18.5–24.9)');

-- Percent body fat (PBF). InBody 570 prints 10–20% "Normal" for males.
-- Female healthy range from ACSM/ACE (18–28%).
INSERT INTO body_norm_ranges (sex, metric_key, age_min, age_max, low, high, source, notes) VALUES
  ('M', 'pbf_pct', 18, NULL, 10, 20, 'InBody 570 reference', 'Printed "Normal" band on the 570 result sheet for males'),
  ('F', 'pbf_pct', 18, NULL, 18, 28, 'ACSM / ACE guidelines', 'Healthy adult female range (18–28%)');

-- InBody Score: InBody documents ~70–80 as "average", 80+ athletic.
-- A single healthy band of 70–89 captures "normal to athletic" without
-- over-claiming an athletic score is required.
INSERT INTO body_norm_ranges (sex, metric_key, age_min, age_max, low, high, source, notes) VALUES
  ('M', 'inbody_score', 18, NULL, 70, 89, 'InBody 570 reference', '70–80 avg, 80+ athletic per InBody docs'),
  ('F', 'inbody_score', 18, NULL, 70, 89, 'InBody 570 reference', '70–80 avg, 80+ athletic per InBody docs');

-- Visceral fat level (InBody 1–20 scale). 1–9 healthy, 10+ risky.
INSERT INTO body_norm_ranges (sex, metric_key, age_min, age_max, low, high, source, notes) VALUES
  ('M', 'visceral_fat_level', 18, NULL, 1, 9, 'InBody 570 reference', '1–9 healthy, ≥10 elevated cardiovascular risk'),
  ('F', 'visceral_fat_level', 18, NULL, 1, 9, 'InBody 570 reference', '1–9 healthy, ≥10 elevated cardiovascular risk');

-- ECW ratio. InBody healthy band 0.360–0.390 (>0.390 suggests fluid imbalance).
INSERT INTO body_norm_ranges (sex, metric_key, age_min, age_max, low, high, source, notes) VALUES
  ('M', 'ecw_ratio', 18, NULL, 0.360, 0.390, 'InBody 570 reference', 'Healthy ECW/TBW ratio. >0.390 fluid imbalance'),
  ('F', 'ecw_ratio', 18, NULL, 0.360, 0.390, 'InBody 570 reference', 'Healthy ECW/TBW ratio. >0.390 fluid imbalance');

-- Waist–hip ratio (WHR). WHO: male <0.90, female <0.85 for low risk.
INSERT INTO body_norm_ranges (sex, metric_key, age_min, age_max, low, high, source, notes) VALUES
  ('M', 'whr', 18, NULL, 0.70, 0.90, 'WHO', 'Male low-risk WHR <0.90'),
  ('F', 'whr', 18, NULL, 0.65, 0.85, 'WHO', 'Female low-risk WHR <0.85');

-- bmr_kcal: intentionally NOT seeded. BMR depends heavily on height/weight/age
-- (Mifflin–St Jeor) so a population "healthy band" without those inputs would
-- be misleading. TODO: seed per-height bands if the product ever needs to
-- compare against a population normal rather than a derived individual target.

-- smm_kg: intentionally NOT seeded. Absolute skeletal muscle mass is strongly
-- height/weight/frame dependent. The InBody 570 prints per-patient context
-- bars, not a universal band. Users should set a personal goal via body_goals
-- (the "Me" reference) rather than compare to a synthetic population value.
-- TODO: seed height-banded SMM norms if a good peer-reviewed source emerges.
