-- Iron workout tracker database schema

-- Exercise library (built-in + custom)
CREATE TABLE IF NOT EXISTS exercises (
  uuid TEXT PRIMARY KEY,
  everkinetic_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  alias JSONB NOT NULL DEFAULT '[]'::jsonb,
  description TEXT,
  primary_muscles JSONB NOT NULL DEFAULT '[]'::jsonb,
  secondary_muscles JSONB NOT NULL DEFAULT '[]'::jsonb,
  equipment JSONB NOT NULL DEFAULT '[]'::jsonb,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  tips JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_custom BOOLEAN NOT NULL DEFAULT false,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercises_title ON exercises(title);
CREATE INDEX IF NOT EXISTS idx_exercises_is_custom ON exercises(is_custom);
CREATE INDEX IF NOT EXISTS idx_exercises_is_hidden ON exercises(is_hidden);

-- Workout plans (templates)
CREATE TABLE IF NOT EXISTS workout_plans (
  uuid TEXT PRIMARY KEY,
  title TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Routines in a plan
CREATE TABLE IF NOT EXISTS workout_routines (
  uuid TEXT PRIMARY KEY,
  workout_plan_uuid TEXT NOT NULL,
  title TEXT,
  comment TEXT,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (workout_plan_uuid) REFERENCES workout_plans(uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workout_routines_plan ON workout_routines(workout_plan_uuid, order_index);

-- Workouts
CREATE TABLE IF NOT EXISTS workouts (
  uuid TEXT PRIMARY KEY,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  title TEXT,
  comment TEXT,
  is_current BOOLEAN NOT NULL DEFAULT false,
  workout_routine_uuid TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (workout_routine_uuid) REFERENCES workout_routines(uuid) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workouts_start_time ON workouts(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_workouts_is_current ON workouts(is_current);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_is_current_unique ON workouts(is_current) WHERE is_current = true;

-- Exercises in a workout
CREATE TABLE IF NOT EXISTS workout_exercises (
  uuid TEXT PRIMARY KEY,
  workout_uuid TEXT NOT NULL,
  exercise_uuid TEXT NOT NULL,
  comment TEXT,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (workout_uuid) REFERENCES workouts(uuid) ON DELETE CASCADE,
  FOREIGN KEY (exercise_uuid) REFERENCES exercises(uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout ON workout_exercises(workout_uuid, order_index);
CREATE INDEX IF NOT EXISTS idx_workout_exercises_exercise ON workout_exercises(exercise_uuid);

-- Sets in a workout exercise
CREATE TABLE IF NOT EXISTS workout_sets (
  uuid TEXT PRIMARY KEY,
  workout_exercise_uuid TEXT NOT NULL,
  weight NUMERIC,
  repetitions INTEGER,
  min_target_reps INTEGER,
  max_target_reps INTEGER,
  rpe NUMERIC CHECK(rpe IS NULL OR (rpe >= 7.0 AND rpe <= 10.0)),
  tag TEXT CHECK(tag IS NULL OR tag IN ('dropSet', 'failure')),
  comment TEXT,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  is_pr BOOLEAN NOT NULL DEFAULT false,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (workout_exercise_uuid) REFERENCES workout_exercises(uuid) ON DELETE CASCADE
);

-- Add is_pr to existing databases
ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS is_pr BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise ON workout_sets(workout_exercise_uuid, order_index);
CREATE INDEX IF NOT EXISTS idx_workout_sets_completed ON workout_sets(is_completed);

-- Exercises in a routine template
CREATE TABLE IF NOT EXISTS workout_routine_exercises (
  uuid TEXT PRIMARY KEY,
  workout_routine_uuid TEXT NOT NULL,
  exercise_uuid TEXT NOT NULL,
  comment TEXT,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (workout_routine_uuid) REFERENCES workout_routines(uuid) ON DELETE CASCADE,
  FOREIGN KEY (exercise_uuid) REFERENCES exercises(uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workout_routine_exercises_routine ON workout_routine_exercises(workout_routine_uuid, order_index);

-- Sets in a routine exercise template
CREATE TABLE IF NOT EXISTS workout_routine_sets (
  uuid TEXT PRIMARY KEY,
  workout_routine_exercise_uuid TEXT NOT NULL,
  min_repetitions INTEGER,
  max_repetitions INTEGER,
  tag TEXT CHECK(tag IS NULL OR tag = 'dropSet'),
  comment TEXT,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (workout_routine_exercise_uuid) REFERENCES workout_routine_exercises(uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workout_routine_sets_exercise ON workout_routine_sets(workout_routine_exercise_uuid, order_index);

-- Bodyweight logs (Module 1 — was missing from schema)
CREATE TABLE IF NOT EXISTS bodyweight_logs (
  uuid TEXT PRIMARY KEY,
  weight_kg NUMERIC NOT NULL,
  logged_at TIMESTAMP NOT NULL DEFAULT NOW(),
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_bodyweight_logs_logged_at ON bodyweight_logs(logged_at DESC);

-- ===== REBIRTH MODULES 2–6 =====

-- Module 2: Body spec logs (height, body fat %, lean mass, etc.)
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

-- Module 3: Circumference measurements (chest, waist, hips, etc.)
CREATE TABLE IF NOT EXISTS measurement_logs (
  uuid TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  value_cm NUMERIC NOT NULL,
  notes TEXT,
  measured_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_measurement_logs_measured_at ON measurement_logs(measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_measurement_logs_site ON measurement_logs(site, measured_at DESC);

-- Module 4: Nutrition logs
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

-- Extend nutrition_logs for Standard Week tracking
ALTER TABLE nutrition_logs ADD COLUMN IF NOT EXISTS meal_name TEXT;
ALTER TABLE nutrition_logs ADD COLUMN IF NOT EXISTS template_meal_id TEXT;
ALTER TABLE nutrition_logs ADD COLUMN IF NOT EXISTS status TEXT CHECK(status IS NULL OR status IN ('planned', 'deviation', 'added'));

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

-- Module 5: HRT logs
CREATE TABLE IF NOT EXISTS hrt_logs (
  uuid TEXT PRIMARY KEY,
  logged_at TIMESTAMP NOT NULL DEFAULT NOW(),
  medication TEXT NOT NULL,
  dose_mg NUMERIC,
  route TEXT CHECK(route IS NULL OR route IN ('injection', 'topical', 'oral', 'patch', 'other')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_hrt_logs_logged_at ON hrt_logs(logged_at DESC);

-- Module 6: Wellbeing logs
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

-- Module 7: Progress photos
CREATE TABLE IF NOT EXISTS progress_photos (
  uuid TEXT PRIMARY KEY,
  blob_url TEXT NOT NULL,
  pose TEXT NOT NULL CHECK(pose IN ('front', 'side', 'back')),
  notes TEXT,
  taken_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_progress_photos_taken_at ON progress_photos(taken_at DESC);
