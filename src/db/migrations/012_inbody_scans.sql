-- Migration 012: InBody scan catalog
-- One row per InBody scan (InBody 570 prints ~60 metrics). We catalogue every
-- metric, let the user view trends, and compare against reference sets
-- (Male/Female norms via 014, Me-goals via 013).

CREATE TABLE IF NOT EXISTS inbody_scans (
  uuid TEXT PRIMARY KEY,
  scanned_at TIMESTAMP NOT NULL,
  device TEXT NOT NULL DEFAULT 'InBody 570',
  venue TEXT,
  age_at_scan INTEGER,
  height_cm NUMERIC,

  -- Body composition
  weight_kg NUMERIC,
  total_body_water_l NUMERIC,
  intracellular_water_l NUMERIC,
  extracellular_water_l NUMERIC,
  protein_kg NUMERIC,
  minerals_kg NUMERIC,
  bone_mineral_kg NUMERIC,
  body_fat_mass_kg NUMERIC,
  smm_kg NUMERIC,             -- skeletal muscle mass

  -- Derived
  bmi NUMERIC,
  pbf_pct NUMERIC,            -- percent body fat
  whr NUMERIC,                -- waist-hip ratio
  inbody_score INTEGER,
  visceral_fat_level INTEGER,
  bmr_kcal INTEGER,
  body_cell_mass_kg NUMERIC,
  ecw_ratio NUMERIC,

  -- Segmental lean (kg and %)
  seg_lean_right_arm_kg NUMERIC, seg_lean_right_arm_pct NUMERIC,
  seg_lean_left_arm_kg NUMERIC,  seg_lean_left_arm_pct NUMERIC,
  seg_lean_trunk_kg NUMERIC,     seg_lean_trunk_pct NUMERIC,
  seg_lean_right_leg_kg NUMERIC, seg_lean_right_leg_pct NUMERIC,
  seg_lean_left_leg_kg NUMERIC,  seg_lean_left_leg_pct NUMERIC,

  -- Segmental fat (kg)
  seg_fat_right_arm_kg NUMERIC,
  seg_fat_left_arm_kg NUMERIC,
  seg_fat_trunk_kg NUMERIC,
  seg_fat_right_leg_kg NUMERIC,
  seg_fat_left_leg_kg NUMERIC,

  -- Segmental circumferences (cm) — InBody sheet lists these
  circ_neck_cm NUMERIC,
  circ_chest_cm NUMERIC,
  circ_abdomen_cm NUMERIC,
  circ_hip_cm NUMERIC,
  circ_right_arm_cm NUMERIC,
  circ_left_arm_cm NUMERIC,
  circ_right_thigh_cm NUMERIC,
  circ_left_thigh_cm NUMERIC,

  -- Recommendations from the sheet
  target_weight_kg NUMERIC,
  weight_control_kg NUMERIC,
  fat_control_kg NUMERIC,
  muscle_control_kg NUMERIC,

  -- Body balance evaluation
  balance_upper TEXT CHECK (balance_upper IS NULL OR balance_upper IN ('balanced','under','over','slightly_under','slightly_over')),
  balance_lower TEXT CHECK (balance_lower IS NULL OR balance_lower IN ('balanced','under','over','slightly_under','slightly_over')),
  balance_upper_lower TEXT CHECK (balance_upper_lower IS NULL OR balance_upper_lower IN ('balanced','under','over','slightly_under','slightly_over')),

  -- Raw impedance (JSON, keyed by freq → {ra,la,trunk,rl,ll})
  impedance JSONB NOT NULL DEFAULT '{}'::jsonb,

  notes TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbody_scans_scanned_at ON inbody_scans(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbody_scans_updated_at ON inbody_scans(updated_at);

DROP TRIGGER IF EXISTS inbody_scans_updated_at ON inbody_scans;
CREATE TRIGGER inbody_scans_updated_at
  BEFORE UPDATE ON inbody_scans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Source tag for auto-inserted circumferences from InBody scans, so the user
-- can still separately log the same week without double-counting when we want to.
ALTER TABLE measurement_logs ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE measurement_logs ADD COLUMN IF NOT EXISTS source_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_measurement_logs_source_ref ON measurement_logs(source_ref);
