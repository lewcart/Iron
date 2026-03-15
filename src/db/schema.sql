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
  order_index INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (workout_exercise_uuid) REFERENCES workout_exercises(uuid) ON DELETE CASCADE
);

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
