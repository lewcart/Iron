-- Migration 020: HRT timeline + lab results + Apple Health medications.
--
-- Replaces the day-by-day HRT adherence model (hrt_protocols + hrt_logs) with
-- a period-based timeline model that mirrors the Notion "HRT Timeline" DB:
-- one row per protocol period (start date → optional end date) listing what
-- doses were taken across that span. Adherence tracking is intentionally
-- dropped — Lewis logs adherence in a separate medications app, and this
-- surface is for "what was the protocol during X period" reads.
--
-- Adds blood-test tracking via two tables:
--   * lab_draws        — one row per blood draw (date + notes)
--   * lab_results      — long-form (one row per (draw, lab_code, value))
--   * lab_definitions  — metadata for each lab (units, reference ranges)
-- The long-table shape lets new labs be added by inserting a definition row,
-- no migrations required. Wide-table parity (Notion has ~50 columns) would
-- ossify the schema and make sex-specific reference ranges painful.
--
-- Adds healthkit_medications for Apple Health "Medications" feature ingestion
-- (HKCategoryTypeIdentifierMedicationRecord, iOS 16.4+). Sits alongside the
-- existing healthkit_daily/workouts tables; uses the same sync route + state
-- bookkeeping. Reads exposed via MCP only — no client-side Dexie cache.

-- ─── Drop legacy HRT adherence tables ────────────────────────────────────────
-- hrt_protocols / hrt_logs are replaced wholesale. Single-user app — no
-- migration of historical adherence data is preserved (Lewis confirmed his
-- adherence history lives in the medications app, not Rebirth).

DROP TRIGGER IF EXISTS hrt_logs_change_log ON hrt_logs;
DROP TRIGGER IF EXISTS hrt_logs_updated_at ON hrt_logs;
DROP TABLE IF EXISTS hrt_logs;

DROP TRIGGER IF EXISTS hrt_protocols_change_log ON hrt_protocols;
DROP TRIGGER IF EXISTS hrt_protocols_updated_at ON hrt_protocols;
DROP TABLE IF EXISTS hrt_protocols;

-- ─── HRT Timeline ────────────────────────────────────────────────────────────
-- Mirrors Notion "HRT Timeline" DB (16f8dae8301b80ce…):
--   Name              → name
--   Period start/end  → started_at / ended_at (DATE; ended_at NULL = "current")
--   Doses E           → doses_e        (single TEXT — display string)
--   Doses T-Blocker   → doses_t_blocker (single TEXT — display string)
--   Doses Other       → doses_other    (JSONB array — multi-select)
-- The dose columns are free-text rather than enum constraints so adding a new
-- prescribed dose doesn't require a migration. UI surfaces the canonical
-- options as picker presets.

CREATE TABLE IF NOT EXISTS hrt_timeline_periods (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  started_at DATE NOT NULL,
  ended_at DATE,
  doses_e TEXT,
  doses_t_blocker TEXT,
  doses_other JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hrt_timeline_periods_started_at ON hrt_timeline_periods(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_hrt_timeline_periods_updated_at ON hrt_timeline_periods(updated_at);

DROP TRIGGER IF EXISTS hrt_timeline_periods_updated_at ON hrt_timeline_periods;
CREATE TRIGGER hrt_timeline_periods_updated_at BEFORE UPDATE ON hrt_timeline_periods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS hrt_timeline_periods_change_log ON hrt_timeline_periods;
CREATE TRIGGER hrt_timeline_periods_change_log AFTER INSERT OR UPDATE OR DELETE ON hrt_timeline_periods
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- ─── Lab definitions (metadata + reference ranges) ───────────────────────────
-- One row per lab. lab_code is the stable canonical identifier the rest of
-- the system references (e.g. 'e2', 'testosterone', 'hb'). label is the
-- display name. Reference ranges are stored as numeric low/high pairs where
-- the lab has a clean numeric range, OR as ref_text for cases like "<300"
-- or "Male: <150 / Female: 250–1000" where a single number doesn't fit.
-- Sex-specific labs (E2, Testosterone) get female_low/high since Lewis is
-- the only user and female ranges are the relevant ones.

CREATE TABLE IF NOT EXISTS lab_definitions (
  lab_code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  unit TEXT,
  ref_low NUMERIC,
  ref_high NUMERIC,
  ref_text TEXT,
  ref_female_low NUMERIC,
  ref_female_high NUMERIC,
  ref_male_low NUMERIC,
  ref_male_high NUMERIC,
  category TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_definitions_category ON lab_definitions(category, sort_order);

-- ─── Lab draws (one row per blood draw event) ────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_draws (
  uuid TEXT PRIMARY KEY,
  drawn_at DATE NOT NULL,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_draws_drawn_at ON lab_draws(drawn_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_draws_updated_at ON lab_draws(updated_at);

DROP TRIGGER IF EXISTS lab_draws_updated_at ON lab_draws;
CREATE TRIGGER lab_draws_updated_at BEFORE UPDATE ON lab_draws
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS lab_draws_change_log ON lab_draws;
CREATE TRIGGER lab_draws_change_log AFTER INSERT OR UPDATE OR DELETE ON lab_draws
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- ─── Lab results (one row per (draw, lab) measurement) ───────────────────────

CREATE TABLE IF NOT EXISTS lab_results (
  uuid TEXT PRIMARY KEY,
  draw_uuid TEXT NOT NULL REFERENCES lab_draws(uuid) ON DELETE CASCADE,
  lab_code TEXT NOT NULL REFERENCES lab_definitions(lab_code) ON DELETE RESTRICT,
  value NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (draw_uuid, lab_code)
);

CREATE INDEX IF NOT EXISTS idx_lab_results_draw ON lab_results(draw_uuid);
CREATE INDEX IF NOT EXISTS idx_lab_results_lab ON lab_results(lab_code);
CREATE INDEX IF NOT EXISTS idx_lab_results_updated_at ON lab_results(updated_at);

DROP TRIGGER IF EXISTS lab_results_updated_at ON lab_results;
CREATE TRIGGER lab_results_updated_at BEFORE UPDATE ON lab_results
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS lab_results_change_log ON lab_results;
CREATE TRIGGER lab_results_change_log AFTER INSERT OR UPDATE OR DELETE ON lab_results
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- ─── Apple Health medications (HKCategoryTypeIdentifierMedicationRecord) ─────
-- Read-only mirror of medication records the user logs in the iOS Health app.
-- Uses the existing healthkit_* sync pipeline (anchor-based) — see
-- src/app/api/healthkit/sync/route.ts. NOT in the change_log CDC system;
-- reads go through MCP get_hk_medications and the /hrt page Meds tab.
--
-- HK gives us: medication name, dose (free text — varies by source),
-- taken_at (when the user marked taken), scheduled_at (when due), source.

CREATE TABLE IF NOT EXISTS healthkit_medications (
  hk_uuid TEXT PRIMARY KEY,
  medication_name TEXT NOT NULL,
  dose_string TEXT,
  taken_at TIMESTAMPTZ NOT NULL,
  scheduled_at TIMESTAMPTZ,
  source_name TEXT,
  source_bundle_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_healthkit_medications_taken_at ON healthkit_medications(taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_healthkit_medications_name ON healthkit_medications(medication_name, taken_at DESC);

DROP TRIGGER IF EXISTS healthkit_medications_updated_at ON healthkit_medications;
CREATE TRIGGER healthkit_medications_updated_at BEFORE UPDATE ON healthkit_medications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Seed lab_definitions from Notion "Blood Test Result" schema ─────────────
-- Order + categories chosen for clean grouping in the UI Labs tab. Reference
-- ranges sourced from the Notion column descriptions; sex-specific ones
-- (E2, Testosterone) get female_low/high.
-- Categories: 'hormones', 'lipids', 'liver', 'kidney', 'electrolytes',
-- 'blood', 'inflammation', 'thyroid', 'minerals', 'other'.

INSERT INTO lab_definitions (lab_code, label, unit, ref_low, ref_high, ref_text, ref_female_low, ref_female_high, ref_male_low, ref_male_high, category, sort_order) VALUES
  -- Sex hormones (HRT-relevant)
  ('e2',           'E2 (Estradiol)',         'pmol/L', NULL, NULL, 'Male: <150 / Female: 250–1000', 250, 1000, NULL, 150, 'hormones', 10),
  ('testosterone', 'Testosterone',           'nmol/L', NULL, NULL, 'Male: 10.0–33.0 / Female: <2.5', 0,   2.5,  10,   33,   'hormones', 20),
  ('fsh',          'FSH',                    'IU/L',   1,    10,   NULL, NULL, NULL, NULL, NULL, 'hormones', 30),
  ('lh',           'LH',                     'IU/L',   1,    10,   NULL, NULL, NULL, NULL, NULL, 'hormones', 40),
  ('prl',          'PRL (Prolactin)',        'mIU/L',  NULL, 300,  '<300', NULL, NULL, NULL, NULL, 'hormones', 50),
  -- Thyroid
  ('tsh',          'TSH',                    'mIU/L',  0.5,  4.0,  NULL, NULL, NULL, NULL, NULL, 'thyroid', 60),
  -- Lipids
  ('total_cholesterol', 'Total Cholesterol', 'mmol/L', NULL, 4.0,  '<4.0', NULL, NULL, NULL, NULL, 'lipids', 100),
  ('hdl',          'HDL',                    'mmol/L', 1.0,  NULL, '>1.0', NULL, NULL, NULL, NULL, 'lipids', 110),
  ('ldl',          'LDL',                    'mmol/L', NULL, 2.5,  '<2.5', NULL, NULL, NULL, NULL, 'lipids', 120),
  ('non_hdl',      'Non-HDL',                'mmol/L', NULL, 3.3,  '<3.3', NULL, NULL, NULL, NULL, 'lipids', 130),
  ('total_hdl_ratio', 'Total/HDL ratio',     NULL,     NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'lipids', 140),
  ('triglycerides','Triglycerides',          'mmol/L', NULL, 2.0,  '<2.0', NULL, NULL, NULL, NULL, 'lipids', 150),
  -- Inflammation
  ('crp',          'CRP',                    'mg/L',   0,    6,    NULL, NULL, NULL, NULL, NULL, 'inflammation', 200),
  -- Blood / haematology
  ('hb',           'Hb (Haemoglobin)',       'g/L',    135,  180,  NULL, NULL, NULL, NULL, NULL, 'blood', 300),
  ('hct',          'Hct (Haematocrit)',      NULL,     0.38, 0.52, NULL, NULL, NULL, NULL, NULL, 'blood', 310),
  ('rcc',          'RCC',                    'x10^12/L', 4.2, 6.0, NULL, NULL, NULL, NULL, NULL, 'blood', 320),
  ('mcv',          'MCV',                    'fL',     80,   98,   NULL, NULL, NULL, NULL, NULL, 'blood', 330),
  ('mch',          'MCH',                    'pg',     27,   35,   NULL, NULL, NULL, NULL, NULL, 'blood', 340),
  ('platelets',    'Platelets',              'x10^9/L',150,  450,  NULL, NULL, NULL, NULL, NULL, 'blood', 350),
  ('wcc',          'WCC',                    'x10^9/L',4.0,  11.0, NULL, NULL, NULL, NULL, NULL, 'blood', 360),
  ('neutrophils',  'Neutrophils',            '%',      NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'blood', 370),
  ('lymphocytes',  'Lymphocytes',            '%',      NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'blood', 380),
  ('monocytes',    'Monocytes',              '%',      NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'blood', 390),
  ('eosinophils',  'Eosinophils',            '%',      NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'blood', 400),
  ('basophils',    'Basophils',              '%',      NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'blood', 410),
  ('ferritin',     'Ferritin',               'ug/L',   30,   320,  NULL, NULL, NULL, NULL, NULL, 'blood', 420),
  -- Electrolytes
  ('sodium',       'Sodium',                 'mmol/L', 137,  147,  NULL, NULL, NULL, NULL, NULL, 'electrolytes', 500),
  ('potassium',    'Potassium',              'mmol/L', 3.5,  5.0,  NULL, NULL, NULL, NULL, NULL, 'electrolytes', 510),
  ('chloride',     'Chloride',               'mmol/L', 96,   109,  NULL, NULL, NULL, NULL, NULL, 'electrolytes', 520),
  ('bicarbonate',  'Bicarbonate',            'mmol/L', 25,   33,   NULL, NULL, NULL, NULL, NULL, 'electrolytes', 530),
  ('anion_gap',    'Anion Gap',              'mmol/L', 4,    17,   NULL, NULL, NULL, NULL, NULL, 'electrolytes', 540),
  -- Glucose / metabolic
  ('glucose',      'Glucose',                'mmol/L', 3.0,  7.7,  NULL, NULL, NULL, NULL, NULL, 'other', 600),
  -- Kidney
  ('urea',         'Urea',                   'mmol/L', 2.5,  8.0,  NULL, NULL, NULL, NULL, NULL, 'kidney', 700),
  ('creatinine',   'Creatinine',             'umol/L', 60,   130,  NULL, NULL, NULL, NULL, NULL, 'kidney', 710),
  ('egfr',         'eGFR',                   'mL/min', 59,   NULL, '>59', NULL, NULL, NULL, NULL, 'kidney', 720),
  ('urate',        'Urate',                  'mmol/L', 0.12, 0.45, NULL, NULL, NULL, NULL, NULL, 'kidney', 730),
  -- Liver
  ('t_bilirubin',  'T.Bilirubin',            'umol/L', 2,    20,   NULL, NULL, NULL, NULL, NULL, 'liver', 800),
  ('alp',          'ALP',                    'U/L',    30,   115,  NULL, NULL, NULL, NULL, NULL, 'liver', 810),
  ('ggt',          'GGT',                    'U/L',    0,    70,   NULL, NULL, NULL, NULL, NULL, 'liver', 820),
  ('alt',          'ALT',                    'U/L',    0,    45,   NULL, NULL, NULL, NULL, NULL, 'liver', 830),
  ('ast',          'AST',                    'U/L',    0,    41,   NULL, NULL, NULL, NULL, NULL, 'liver', 840),
  ('ld',           'LD',                     'U/L',    80,   250,  NULL, NULL, NULL, NULL, NULL, 'liver', 850),
  ('total_protein','Total Protein',          'g/L',    60,   82,   NULL, NULL, NULL, NULL, NULL, 'liver', 860),
  ('albumin',      'Albumin',                'g/L',    35,   50,   NULL, NULL, NULL, NULL, NULL, 'liver', 870),
  ('globulin',     'Globulin',               'g/L',    20,   40,   NULL, NULL, NULL, NULL, NULL, 'liver', 880),
  -- Minerals + bone
  ('calcium',      'Calcium',                'mmol/L', 2.15, 2.60, NULL, NULL, NULL, NULL, NULL, 'minerals', 900),
  ('corrected_calcium', 'Corrected Calcium', 'mmol/L', 2.15, 2.60, NULL, NULL, NULL, NULL, NULL, 'minerals', 910),
  ('phosphate',    'Phosphate',              'mmol/L', 0.8,  1.5,  NULL, NULL, NULL, NULL, NULL, 'minerals', 920),
  ('pth',          'PTH',                    'pmol/L', 1.5,  7.6,  NULL, NULL, NULL, NULL, NULL, 'minerals', 930),
  ('vitamin_d3',   'Vitamin D3',             'nmol/L', 49,   NULL, '>49', NULL, NULL, NULL, NULL, 'minerals', 940)
ON CONFLICT (lab_code) DO UPDATE SET
  label = EXCLUDED.label,
  unit = EXCLUDED.unit,
  ref_low = EXCLUDED.ref_low,
  ref_high = EXCLUDED.ref_high,
  ref_text = EXCLUDED.ref_text,
  ref_female_low = EXCLUDED.ref_female_low,
  ref_female_high = EXCLUDED.ref_female_high,
  ref_male_low = EXCLUDED.ref_male_low,
  ref_male_high = EXCLUDED.ref_male_high,
  category = EXCLUDED.category,
  sort_order = EXCLUDED.sort_order;
