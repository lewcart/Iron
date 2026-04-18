-- Migration 002: Rebirth modules 2–10 baseline
-- Body composition, nutrition, HRT, wellbeing, dysphoria, clothes, inspo & progress photos.
-- Excludes schema added by later migrations (005 sync columns, 006 MCP, 007 routine targets,
-- 008 exercise seeds, 009 movement_pattern, 010 inspo burst_group_id).

-- ===== Module 2: Body spec logs =====
CREATE TABLE IF NOT EXISTS body_spec_logs (
  uuid TEXT PRIMARY KEY,
  height_cm NUMERIC,
  weight_kg NUMERIC,
  body_fat_pct NUMERIC,
  lean_mass_kg NUMERIC,
  notes TEXT,
  measured_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_body_spec_logs_measured_at ON body_spec_logs(measured_at DESC);

-- ===== Module 3: Circumference measurements =====
CREATE TABLE IF NOT EXISTS measurement_logs (
  uuid TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  value_cm NUMERIC NOT NULL,
  notes TEXT,
  measured_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_measurement_logs_measured_at ON measurement_logs(measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_measurement_logs_site ON measurement_logs(site, measured_at DESC);

-- ===== Module 4: Nutrition =====

-- Meal-level nutrition logs
CREATE TABLE IF NOT EXISTS nutrition_logs (
  uuid TEXT PRIMARY KEY,
  logged_at TIMESTAMP NOT NULL DEFAULT NOW(),
  meal_type TEXT CHECK(meal_type IS NULL OR meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  calories NUMERIC,
  protein_g NUMERIC,
  carbs_g NUMERIC,
  fat_g NUMERIC,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_nutrition_logs_logged_at ON nutrition_logs(logged_at DESC);

-- Extend nutrition_logs for Standard Week tracking + Fitbee idempotency.
-- These were bolted on via ALTER in the legacy schema; keep as idempotent guards.
ALTER TABLE nutrition_logs ADD COLUMN IF NOT EXISTS meal_name TEXT;
ALTER TABLE nutrition_logs ADD COLUMN IF NOT EXISTS template_meal_id TEXT;
ALTER TABLE nutrition_logs ADD COLUMN IF NOT EXISTS status TEXT CHECK(status IS NULL OR status IN ('planned', 'deviation', 'added'));
ALTER TABLE nutrition_logs ADD COLUMN IF NOT EXISTS external_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_nutrition_logs_external_ref ON nutrition_logs (external_ref);

-- Standard Week meal templates
CREATE TABLE IF NOT EXISTS nutrition_week_meals (
  uuid TEXT PRIMARY KEY,
  day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
  meal_slot TEXT NOT NULL,
  meal_name TEXT NOT NULL,
  protein_g NUMERIC,
  calories NUMERIC,
  quality_rating INTEGER CHECK(quality_rating IS NULL OR quality_rating BETWEEN 1 AND 5),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nutrition_week_meals_day ON nutrition_week_meals(day_of_week, sort_order);

-- Daily notes: hydration + summary per calendar day
CREATE TABLE IF NOT EXISTS nutrition_day_notes (
  uuid TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  hydration_ml INTEGER,
  notes TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Fitbee import batches (audit + FK from food entries)
CREATE TABLE IF NOT EXISTS fitbee_import_batches (
  uuid TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  label TEXT,
  file_hashes JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Per-food lines (full macro + micro detail in nutrients JSONB)
CREATE TABLE IF NOT EXISTS nutrition_food_entries (
  uuid TEXT PRIMARY KEY,
  logged_at TIMESTAMPTZ NOT NULL,
  day_local TEXT NOT NULL,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  food_name TEXT NOT NULL,
  calories NUMERIC,
  protein_g NUMERIC,
  carbs_g NUMERIC,
  fat_g NUMERIC,
  nutrients JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'fitbee',
  import_batch_uuid TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  FOREIGN KEY (import_batch_uuid) REFERENCES fitbee_import_batches(uuid) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_nutrition_food_entries_logged_at ON nutrition_food_entries(logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_nutrition_food_entries_day_local ON nutrition_food_entries(day_local);
CREATE INDEX IF NOT EXISTS idx_nutrition_food_entries_batch ON nutrition_food_entries(import_batch_uuid);

-- Apple / Fitbee-style activity energy (not Iron workouts)
CREATE TABLE IF NOT EXISTS activity_logs (
  uuid TEXT PRIMARY KEY,
  logged_at TIMESTAMPTZ NOT NULL,
  activity_name TEXT NOT NULL,
  calories_burned NUMERIC,
  source TEXT NOT NULL DEFAULT 'fitbee',
  dedupe_key TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_logged_at ON activity_logs(logged_at DESC);

-- ===== Module 5: HRT =====

-- HRT protocols (active medication plans)
CREATE TABLE IF NOT EXISTS hrt_protocols (
  uuid TEXT PRIMARY KEY,
  medication TEXT NOT NULL,
  dose_description TEXT NOT NULL,
  form TEXT NOT NULL CHECK(form IN ('gel', 'patch', 'injection', 'oral', 'other')),
  started_at DATE NOT NULL,
  ended_at DATE,
  includes_blocker BOOLEAN NOT NULL DEFAULT false,
  blocker_name TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hrt_protocols_started_at ON hrt_protocols(started_at DESC);

-- HRT logs
CREATE TABLE IF NOT EXISTS hrt_logs (
  uuid TEXT PRIMARY KEY,
  logged_at TIMESTAMP NOT NULL DEFAULT NOW(),
  medication TEXT NOT NULL,
  dose_mg NUMERIC,
  route TEXT CHECK(route IS NULL OR route IN ('injection', 'topical', 'oral', 'patch', 'other')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_hrt_logs_logged_at ON hrt_logs(logged_at DESC);

-- RB-09: extend hrt_logs with taken flag + protocol reference (legacy ALTERs)
ALTER TABLE hrt_logs ADD COLUMN IF NOT EXISTS taken BOOLEAN DEFAULT false;
ALTER TABLE hrt_logs ADD COLUMN IF NOT EXISTS protocol_uuid TEXT REFERENCES hrt_protocols(uuid) ON DELETE SET NULL;

-- ===== Module 6: Wellbeing =====
CREATE TABLE IF NOT EXISTS wellbeing_logs (
  uuid TEXT PRIMARY KEY,
  logged_at TIMESTAMP NOT NULL DEFAULT NOW(),
  mood INTEGER CHECK(mood IS NULL OR (mood BETWEEN 1 AND 10)),
  energy INTEGER CHECK(energy IS NULL OR (energy BETWEEN 1 AND 10)),
  sleep_hours NUMERIC,
  sleep_quality INTEGER CHECK(sleep_quality IS NULL OR (sleep_quality BETWEEN 1 AND 10)),
  stress INTEGER CHECK(stress IS NULL OR (stress BETWEEN 1 AND 10)),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_wellbeing_logs_logged_at ON wellbeing_logs(logged_at DESC);

-- ===== Module 10: Dysphoria / euphoria journal =====
CREATE TABLE IF NOT EXISTS dysphoria_logs (
  uuid TEXT PRIMARY KEY,
  logged_at TIMESTAMP NOT NULL DEFAULT NOW(),
  scale INTEGER NOT NULL CHECK(scale BETWEEN 1 AND 10),
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_dysphoria_logs_logged_at ON dysphoria_logs(logged_at DESC);

-- ===== Module 10: Clothes test log =====
CREATE TABLE IF NOT EXISTS clothes_test_logs (
  uuid TEXT PRIMARY KEY,
  logged_at TIMESTAMP NOT NULL DEFAULT NOW(),
  outfit_description TEXT NOT NULL,
  photo_url TEXT,
  comfort_rating INTEGER CHECK(comfort_rating IS NULL OR (comfort_rating BETWEEN 1 AND 10)),
  euphoria_rating INTEGER CHECK(euphoria_rating IS NULL OR (euphoria_rating BETWEEN 1 AND 10)),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_clothes_test_logs_logged_at ON clothes_test_logs(logged_at DESC);

-- ===== Inspo photos (discreet physique inspiration captures) =====
-- burst_group_id is added by migration 010.
CREATE TABLE IF NOT EXISTS inspo_photos (
  uuid TEXT PRIMARY KEY,
  blob_url TEXT NOT NULL,
  notes TEXT,
  taken_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspo_photos_taken_at ON inspo_photos(taken_at DESC);

-- ===== Module 7: Progress photos =====
CREATE TABLE IF NOT EXISTS progress_photos (
  uuid TEXT PRIMARY KEY,
  blob_url TEXT NOT NULL,
  pose TEXT NOT NULL CHECK(pose IN ('front', 'side', 'back')),
  notes TEXT,
  taken_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_progress_photos_taken_at ON progress_photos(taken_at DESC);
