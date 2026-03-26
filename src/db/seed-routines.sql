-- Seed Iron routines from screenshots
-- Two plans: Q1 (5 routines) and Booty Patrol (5 routines)

-- Helper: resolve exercise UUID by title (picks first non-hidden match)
-- We use a CTE to map names → uuids once

BEGIN;

-- ===== PLAN 1: Q1 =====
INSERT INTO workout_plans (uuid, title) VALUES ('plan-q1', 'Q1') ON CONFLICT DO NOTHING;

-- Monday - Lower A
INSERT INTO workout_routines (uuid, workout_plan_uuid, title, comment, order_index)
VALUES ('rtn-q1-mon', 'plan-q1', 'Monday - Lower A', 'Glutes/Hams bias (and waist)', 0) ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index)
VALUES
  ('rte-q1-mon-0', 'rtn-q1-mon', (SELECT uuid FROM exercises WHERE title = 'Leg Press' AND is_hidden = false LIMIT 1), 0),
  ('rte-q1-mon-1', 'rtn-q1-mon', (SELECT uuid FROM exercises WHERE title = 'Hip Thrust (Barbell)' AND is_hidden = false LIMIT 1), 1),
  ('rte-q1-mon-2', 'rtn-q1-mon', (SELECT uuid FROM exercises WHERE title = 'Leg Curl (Seated)' AND is_hidden = false LIMIT 1), 2),
  ('rte-q1-mon-3', 'rtn-q1-mon', (SELECT uuid FROM exercises WHERE title = 'Glute Cable Kick Back' AND is_hidden = false LIMIT 1), 3),
  ('rte-q1-mon-4', 'rtn-q1-mon', (SELECT uuid FROM exercises WHERE title = 'Plank' AND is_hidden = false LIMIT 1), 4),
  ('rte-q1-mon-5', 'rtn-q1-mon', (SELECT uuid FROM exercises WHERE title = 'Dead bug' AND is_hidden = false LIMIT 1), 5),
  ('rte-q1-mon-6', 'rtn-q1-mon', (SELECT uuid FROM exercises WHERE title = 'Ab Wheel' AND is_hidden = false LIMIT 1), 6)
ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index)
SELECT gen_random_uuid()::text, rte.uuid, s.min_r, s.max_r, s.idx
FROM (VALUES
  ('rte-q1-mon-0', 8, 12, 0), ('rte-q1-mon-0', 8, 12, 1), ('rte-q1-mon-0', 8, 12, 2), ('rte-q1-mon-0', 8, 12, 3),
  ('rte-q1-mon-1', 8, 12, 0), ('rte-q1-mon-1', 8, 12, 1), ('rte-q1-mon-1', 8, 12, 2), ('rte-q1-mon-1', 8, 12, 3),
  ('rte-q1-mon-2', 10, 15, 0), ('rte-q1-mon-2', 10, 15, 1), ('rte-q1-mon-2', 10, 15, 2), ('rte-q1-mon-2', 10, 15, 3),
  ('rte-q1-mon-3', 12, 20, 0), ('rte-q1-mon-3', 12, 20, 1), ('rte-q1-mon-3', 12, 20, 2), ('rte-q1-mon-3', 12, 20, 3),
  ('rte-q1-mon-4', 45, 60, 0), ('rte-q1-mon-4', 45, 60, 1), ('rte-q1-mon-4', 45, 60, 2), ('rte-q1-mon-4', 45, 60, 3),
  ('rte-q1-mon-5', 20, 20, 0), ('rte-q1-mon-5', 20, 20, 1), ('rte-q1-mon-5', 20, 20, 2), ('rte-q1-mon-5', 20, 20, 3),
  ('rte-q1-mon-6', 6, 12, 0), ('rte-q1-mon-6', 6, 12, 1), ('rte-q1-mon-6', 6, 12, 2), ('rte-q1-mon-6', 6, 12, 3)
) AS s(rte_uuid, min_r, max_r, idx)
JOIN workout_routine_exercises rte ON rte.uuid = s.rte_uuid;

-- Tuesday - Upper A
INSERT INTO workout_routines (uuid, workout_plan_uuid, title, comment, order_index)
VALUES ('rtn-q1-tue', 'plan-q1', 'Tuesday - Upper A', 'Back + delts + arms', 1) ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index)
VALUES
  ('rte-q1-tue-0', 'rtn-q1-tue', (SELECT uuid FROM exercises WHERE title = 'Pulldown (Overhand)' AND is_hidden = false LIMIT 1), 0),
  ('rte-q1-tue-1', 'rtn-q1-tue', (SELECT uuid FROM exercises WHERE title = 'Row (Machine, Chest-Supported)' AND is_hidden = false LIMIT 1), 1),
  ('rte-q1-tue-2', 'rtn-q1-tue', (SELECT uuid FROM exercises WHERE title = 'Biceps Curl: Machine' AND is_hidden = false LIMIT 1), 2),
  ('rte-q1-tue-3', 'rtn-q1-tue', (SELECT uuid FROM exercises WHERE title = 'Triceps Extension: Machine' AND is_hidden = false LIMIT 1), 3),
  ('rte-q1-tue-4', 'rtn-q1-tue', (SELECT uuid FROM exercises WHERE title = 'External Cable Rotation (Band)' AND is_hidden = false LIMIT 1), 4),
  ('rte-q1-tue-5', 'rtn-q1-tue', (SELECT uuid FROM exercises WHERE title = 'Internal Cable Rotation (Band)' AND is_hidden = false LIMIT 1), 5),
  ('rte-q1-tue-6', 'rtn-q1-tue', (SELECT uuid FROM exercises WHERE title = 'Rear Delt Fly Bentover (Dumbbell)' AND is_hidden = false LIMIT 1), 6)
ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index)
SELECT gen_random_uuid()::text, rte.uuid, s.min_r, s.max_r, s.idx
FROM (VALUES
  ('rte-q1-tue-0', 8, 12, 0), ('rte-q1-tue-0', 8, 12, 1), ('rte-q1-tue-0', 8, 12, 2), ('rte-q1-tue-0', 8, 12, 3),
  ('rte-q1-tue-1', 8, 12, 0), ('rte-q1-tue-1', 8, 12, 1), ('rte-q1-tue-1', 8, 12, 2), ('rte-q1-tue-1', 8, 12, 3),
  ('rte-q1-tue-2', 10, 15, 0), ('rte-q1-tue-2', 10, 15, 1), ('rte-q1-tue-2', 10, 15, 2), ('rte-q1-tue-2', 10, 15, 3),
  ('rte-q1-tue-3', 10, 15, 0), ('rte-q1-tue-3', 10, 15, 1), ('rte-q1-tue-3', 10, 15, 2), ('rte-q1-tue-3', 10, 15, 3),
  ('rte-q1-tue-4', 6, 10, 0), ('rte-q1-tue-4', 6, 10, 1), ('rte-q1-tue-4', 6, 10, 2),
  ('rte-q1-tue-5', 6, 10, 0), ('rte-q1-tue-5', 6, 10, 1), ('rte-q1-tue-5', 6, 10, 2),
  ('rte-q1-tue-6', 10, 12, 0), ('rte-q1-tue-6', 10, 12, 1), ('rte-q1-tue-6', 10, 12, 2), ('rte-q1-tue-6', 10, 12, 3)
) AS s(rte_uuid, min_r, max_r, idx)
JOIN workout_routine_exercises rte ON rte.uuid = s.rte_uuid;

-- Thursday - Lower B
INSERT INTO workout_routines (uuid, workout_plan_uuid, title, comment, order_index)
VALUES ('rtn-q1-thu', 'plan-q1', 'Thursday - Lower B', 'Quads + glute shape', 2) ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index)
VALUES
  ('rte-q1-thu-0', 'rtn-q1-thu', (SELECT uuid FROM exercises WHERE title = 'Hack Squat: Machine' AND is_hidden = false LIMIT 1), 0),
  ('rte-q1-thu-1', 'rtn-q1-thu', (SELECT uuid FROM exercises WHERE title = 'Leg Extension' AND is_hidden = false LIMIT 1), 1),
  ('rte-q1-thu-2', 'rtn-q1-thu', (SELECT uuid FROM exercises WHERE title = 'Leg Curl (Lying)' AND is_hidden = false LIMIT 1), 2),
  ('rte-q1-thu-3', 'rtn-q1-thu', (SELECT uuid FROM exercises WHERE title = 'GHD Hip Extension' AND is_hidden = false LIMIT 1), 3),
  ('rte-q1-thu-4', 'rtn-q1-thu', (SELECT uuid FROM exercises WHERE title = 'Cable Hip Adduction' AND is_hidden = false LIMIT 1), 4)
ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index)
SELECT gen_random_uuid()::text, rte.uuid, s.min_r, s.max_r, s.idx
FROM (VALUES
  ('rte-q1-thu-0', 6, 10, 0), ('rte-q1-thu-0', 6, 10, 1), ('rte-q1-thu-0', 6, 10, 2), ('rte-q1-thu-0', 6, 10, 3),
  ('rte-q1-thu-1', 10, 15, 0), ('rte-q1-thu-1', 10, 15, 1), ('rte-q1-thu-1', 10, 15, 2), ('rte-q1-thu-1', 10, 15, 3),
  ('rte-q1-thu-2', 10, 15, 0), ('rte-q1-thu-2', 10, 15, 1), ('rte-q1-thu-2', 10, 15, 2), ('rte-q1-thu-2', 10, 15, 3),
  ('rte-q1-thu-3', 8, 12, 0), ('rte-q1-thu-3', 8, 12, 1), ('rte-q1-thu-3', 8, 12, 2), ('rte-q1-thu-3', 8, 12, 3),
  ('rte-q1-thu-4', 12, 20, 0), ('rte-q1-thu-4', 12, 20, 1), ('rte-q1-thu-4', 12, 20, 2), ('rte-q1-thu-4', 12, 20, 3)
) AS s(rte_uuid, min_r, max_r, idx)
JOIN workout_routine_exercises rte ON rte.uuid = s.rte_uuid;

-- Friday - Upper B
INSERT INTO workout_routines (uuid, workout_plan_uuid, title, comment, order_index)
VALUES ('rtn-q1-fri', 'plan-q1', 'Friday - Upper B', 'Delt emphasis + racerback pop', 3) ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index)
VALUES
  ('rte-q1-fri-0', 'rtn-q1-fri', (SELECT uuid FROM exercises WHERE title = 'Seated Cable Row (Low Row)' AND is_hidden = false LIMIT 1), 0),
  ('rte-q1-fri-1', 'rtn-q1-fri', (SELECT uuid FROM exercises WHERE title = 'Face Pulls' AND is_hidden = false LIMIT 1), 1),
  ('rte-q1-fri-2', 'rtn-q1-fri', (SELECT uuid FROM exercises WHERE title = 'Incline Bench Shoulder Press (Dumbbell)' AND is_hidden = false LIMIT 1), 2),
  ('rte-q1-fri-3', 'rtn-q1-fri', (SELECT uuid FROM exercises WHERE title = 'Crunch (Machine)' AND is_hidden = false LIMIT 1), 3),
  ('rte-q1-fri-4', 'rtn-q1-fri', (SELECT uuid FROM exercises WHERE title = 'Chest Press (Machine)' AND is_hidden = false LIMIT 1), 4),
  ('rte-q1-fri-5', 'rtn-q1-fri', (SELECT uuid FROM exercises WHERE title = 'Pallof Rotations (Band)' AND is_hidden = false LIMIT 1), 5)
ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index)
SELECT gen_random_uuid()::text, rte.uuid, s.min_r, s.max_r, s.idx
FROM (VALUES
  ('rte-q1-fri-0', 8, 12, 0), ('rte-q1-fri-0', 8, 12, 1), ('rte-q1-fri-0', 8, 12, 2), ('rte-q1-fri-0', 8, 12, 3),
  ('rte-q1-fri-1', 12, 20, 0), ('rte-q1-fri-1', 12, 20, 1), ('rte-q1-fri-1', 12, 20, 2), ('rte-q1-fri-1', 12, 20, 3),
  ('rte-q1-fri-2', 10, 15, 0), ('rte-q1-fri-2', 10, 15, 1), ('rte-q1-fri-2', 10, 15, 2), ('rte-q1-fri-2', 10, 15, 3),
  ('rte-q1-fri-3', 10, 15, 0), ('rte-q1-fri-3', 10, 15, 1), ('rte-q1-fri-3', 10, 15, 2),
  ('rte-q1-fri-4', 8, 12, 0), ('rte-q1-fri-4', 8, 12, 1), ('rte-q1-fri-4', 8, 12, 2),
  ('rte-q1-fri-5', 10, 15, 0), ('rte-q1-fri-5', 10, 15, 1), ('rte-q1-fri-5', 10, 15, 2)
) AS s(rte_uuid, min_r, max_r, idx)
JOIN workout_routine_exercises rte ON rte.uuid = s.rte_uuid;

-- Oh Shit, Bonus Day
INSERT INTO workout_routines (uuid, workout_plan_uuid, title, comment, order_index)
VALUES ('rtn-q1-bonus', 'plan-q1', 'Oh Shit, Bonus Day', NULL, 4) ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index)
VALUES
  ('rte-q1-bon-0', 'rtn-q1-bonus', (SELECT uuid FROM exercises WHERE title = 'Face Pulls' AND is_hidden = false LIMIT 1), 0),
  ('rte-q1-bon-1', 'rtn-q1-bonus', (SELECT uuid FROM exercises WHERE title = 'Rear Delt Fly (Machine)' AND is_hidden = false LIMIT 1), 1),
  ('rte-q1-bon-2', 'rtn-q1-bonus', (SELECT uuid FROM exercises WHERE title = 'Flyes: Machine' AND is_hidden = false LIMIT 1), 2),
  ('rte-q1-bon-3', 'rtn-q1-bonus', (SELECT uuid FROM exercises WHERE title = 'Straight Arm Pulldown' AND is_hidden = false LIMIT 1), 3),
  ('rte-q1-bon-4', 'rtn-q1-bonus', (SELECT uuid FROM exercises WHERE title = 'Lateral Raise: Dumbbell' AND is_hidden = false LIMIT 1), 4)
ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index)
SELECT gen_random_uuid()::text, rte.uuid, s.min_r, s.max_r, s.idx
FROM (VALUES
  ('rte-q1-bon-0', 10, 15, 0), ('rte-q1-bon-0', 10, 15, 1), ('rte-q1-bon-0', 10, 15, 2),
  ('rte-q1-bon-1', 12, 20, 0), ('rte-q1-bon-1', 12, 20, 1), ('rte-q1-bon-1', 12, 20, 2),
  ('rte-q1-bon-2', 8, 12, 0), ('rte-q1-bon-2', 8, 12, 1), ('rte-q1-bon-2', 8, 12, 2),
  ('rte-q1-bon-3', 10, 15, 0), ('rte-q1-bon-3', 10, 15, 1), ('rte-q1-bon-3', 10, 15, 2),
  ('rte-q1-bon-4', 12, 20, 0), ('rte-q1-bon-4', 12, 20, 1), ('rte-q1-bon-4', 12, 20, 2), ('rte-q1-bon-4', 12, 20, 3)
) AS s(rte_uuid, min_r, max_r, idx)
JOIN workout_routine_exercises rte ON rte.uuid = s.rte_uuid;


-- ===== PLAN 2: Booty Patrol =====
INSERT INTO workout_plans (uuid, title) VALUES ('plan-booty', 'Booty Patrol') ON CONFLICT DO NOTHING;

-- Monday
INSERT INTO workout_routines (uuid, workout_plan_uuid, title, comment, order_index)
VALUES ('rtn-bp-mon', 'plan-booty', 'Monday', 'Lower A (Glute + Quad bias)', 0) ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index)
VALUES
  ('rte-bp-mon-0', 'rtn-bp-mon', (SELECT uuid FROM exercises WHERE title = 'Hip Thrust (Barbell)' AND is_hidden = false LIMIT 1), 0),
  ('rte-bp-mon-1', 'rtn-bp-mon', (SELECT uuid FROM exercises WHERE title = 'Leg Press' AND is_hidden = false LIMIT 1), 1),
  ('rte-bp-mon-2', 'rtn-bp-mon', (SELECT uuid FROM exercises WHERE title = 'Leg Curl (Seated)' AND is_hidden = false LIMIT 1), 2),
  ('rte-bp-mon-3', 'rtn-bp-mon', (SELECT uuid FROM exercises WHERE title = 'Hip Abduction (Machine)' AND is_hidden = false LIMIT 1), 3)
ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index)
SELECT gen_random_uuid()::text, rte.uuid, s.min_r, s.max_r, s.idx
FROM (VALUES
  ('rte-bp-mon-0', 8, 12, 0), ('rte-bp-mon-0', 8, 12, 1), ('rte-bp-mon-0', 8, 12, 2),
  ('rte-bp-mon-1', 10, 12, 0), ('rte-bp-mon-1', 10, 12, 1), ('rte-bp-mon-1', 10, 12, 2),
  ('rte-bp-mon-2', 10, 12, 0), ('rte-bp-mon-2', 10, 12, 1), ('rte-bp-mon-2', 10, 12, 2),
  ('rte-bp-mon-3', 15, 20, 0), ('rte-bp-mon-3', 15, 20, 1)
) AS s(rte_uuid, min_r, max_r, idx)
JOIN workout_routine_exercises rte ON rte.uuid = s.rte_uuid;

-- Tuesday
INSERT INTO workout_routines (uuid, workout_plan_uuid, title, comment, order_index)
VALUES ('rtn-bp-tue', 'plan-booty', 'Tuesday', 'Upper/Posture + Back Care', 1) ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index)
VALUES
  ('rte-bp-tue-0', 'rtn-bp-tue', (SELECT uuid FROM exercises WHERE title = 'Row (Machine, Chest-Supported)' AND is_hidden = false LIMIT 1), 0),
  ('rte-bp-tue-1', 'rtn-bp-tue', (SELECT uuid FROM exercises WHERE title = 'Pulldown (Overhand)' AND is_hidden = false LIMIT 1), 1),
  ('rte-bp-tue-2', 'rtn-bp-tue', (SELECT uuid FROM exercises WHERE title = 'Chest Press (Machine)' AND is_hidden = false LIMIT 1), 2),
  ('rte-bp-tue-3', 'rtn-bp-tue', (SELECT uuid FROM exercises WHERE title = 'Rear Delt Fly (Machine)' AND is_hidden = false LIMIT 1), 3),
  ('rte-bp-tue-4', 'rtn-bp-tue', (SELECT uuid FROM exercises WHERE title = 'Face Pulls' AND is_hidden = false LIMIT 1), 4),
  ('rte-bp-tue-5', 'rtn-bp-tue', (SELECT uuid FROM exercises WHERE title = 'Chin Tuck' AND is_hidden = false LIMIT 1), 5),
  ('rte-bp-tue-6', 'rtn-bp-tue', (SELECT uuid FROM exercises WHERE title = 'Wall Slide' AND is_hidden = false LIMIT 1), 6)
ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index)
SELECT gen_random_uuid()::text, rte.uuid, s.min_r, s.max_r, s.idx
FROM (VALUES
  ('rte-bp-tue-0', 10, 12, 0), ('rte-bp-tue-0', 10, 12, 1), ('rte-bp-tue-0', 10, 12, 2),
  ('rte-bp-tue-1', 8, 12, 0), ('rte-bp-tue-1', 8, 12, 1), ('rte-bp-tue-1', 8, 12, 2),
  ('rte-bp-tue-2', 10, 12, 0), ('rte-bp-tue-2', 10, 12, 1),
  ('rte-bp-tue-3', 12, 15, 0), ('rte-bp-tue-3', 12, 15, 1),
  ('rte-bp-tue-4', 12, 15, 0), ('rte-bp-tue-4', 12, 15, 1),
  ('rte-bp-tue-5', 10, 10, 0), ('rte-bp-tue-5', 10, 10, 1),
  ('rte-bp-tue-6', 10, 10, 0), ('rte-bp-tue-6', 10, 10, 1)
) AS s(rte_uuid, min_r, max_r, idx)
JOIN workout_routine_exercises rte ON rte.uuid = s.rte_uuid;

-- Wednesday
INSERT INTO workout_routines (uuid, workout_plan_uuid, title, comment, order_index)
VALUES ('rtn-bp-wed', 'plan-booty', 'Wednesday', 'Lower B (Glute + Hamstring)', 2) ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index)
VALUES
  ('rte-bp-wed-0', 'rtn-bp-wed', (SELECT uuid FROM exercises WHERE title = 'Hip Thrust (Barbell)' AND is_hidden = false LIMIT 1), 0),
  ('rte-bp-wed-1', 'rtn-bp-wed', (SELECT uuid FROM exercises WHERE title = 'Cable Pull-Through' AND is_hidden = false LIMIT 1), 1),
  ('rte-bp-wed-2', 'rtn-bp-wed', (SELECT uuid FROM exercises WHERE title = 'Leg Curl (Seated)' AND is_hidden = false LIMIT 1), 2),
  ('rte-bp-wed-3', 'rtn-bp-wed', (SELECT uuid FROM exercises WHERE title = 'Leg Press (Single Leg)' AND is_hidden = false LIMIT 1), 3)
ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index)
SELECT gen_random_uuid()::text, rte.uuid, s.min_r, s.max_r, s.idx
FROM (VALUES
  ('rte-bp-wed-0', 8, 12, 0), ('rte-bp-wed-0', 8, 12, 1), ('rte-bp-wed-0', 8, 12, 2),
  ('rte-bp-wed-1', 10, 12, 0), ('rte-bp-wed-1', 10, 12, 1), ('rte-bp-wed-1', 10, 12, 2),
  ('rte-bp-wed-2', 8, 12, 0), ('rte-bp-wed-2', 8, 12, 1), ('rte-bp-wed-2', 8, 12, 2),
  ('rte-bp-wed-3', 10, 12, 0), ('rte-bp-wed-3', 10, 12, 1)
) AS s(rte_uuid, min_r, max_r, idx)
JOIN workout_routine_exercises rte ON rte.uuid = s.rte_uuid;

-- Thursday
INSERT INTO workout_routines (uuid, workout_plan_uuid, title, comment, order_index)
VALUES ('rtn-bp-thu', 'plan-booty', 'Thursday', 'Upper Lite + Anti-Rotation', 3) ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index)
VALUES
  ('rte-bp-thu-0', 'rtn-bp-thu', (SELECT uuid FROM exercises WHERE title ILIKE 'Row: Cable (Seated)' AND is_hidden = false LIMIT 1), 0),
  ('rte-bp-thu-1', 'rtn-bp-thu', (SELECT uuid FROM exercises WHERE title ILIKE 'Bench Press: Machine (Incline)%' AND is_hidden = false LIMIT 1), 1),
  ('rte-bp-thu-2', 'rtn-bp-thu', (SELECT uuid FROM exercises WHERE title = 'Pallof Rotations (Band)' AND is_hidden = false LIMIT 1), 2),
  ('rte-bp-thu-3', 'rtn-bp-thu', (SELECT uuid FROM exercises WHERE title = 'Side Plank' AND is_hidden = false LIMIT 1), 3)
ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index)
SELECT gen_random_uuid()::text, rte.uuid, s.min_r, s.max_r, s.idx
FROM (VALUES
  ('rte-bp-thu-0', 10, 12, 0), ('rte-bp-thu-0', 10, 12, 1), ('rte-bp-thu-0', 10, 12, 2),
  ('rte-bp-thu-1', 10, 12, 0), ('rte-bp-thu-1', 10, 12, 1),
  ('rte-bp-thu-2', 10, 10, 0), ('rte-bp-thu-2', 10, 10, 1),
  ('rte-bp-thu-3', 20, 30, 0), ('rte-bp-thu-3', 20, 30, 1)
) AS s(rte_uuid, min_r, max_r, idx)
JOIN workout_routine_exercises rte ON rte.uuid = s.rte_uuid;

-- Friday
INSERT INTO workout_routines (uuid, workout_plan_uuid, title, comment, order_index)
VALUES ('rtn-bp-fri', 'plan-booty', 'Friday', 'Lower C (Glute Pump + Unilateral)', 4) ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index)
VALUES
  ('rte-bp-fri-0', 'rtn-bp-fri', (SELECT uuid FROM exercises WHERE title = 'Leg Press (Single Leg)' AND is_hidden = false LIMIT 1), 0),
  ('rte-bp-fri-1', 'rtn-bp-fri', (SELECT uuid FROM exercises WHERE title = 'Leg Extension' AND is_hidden = false LIMIT 1), 1),
  ('rte-bp-fri-2', 'rtn-bp-fri', (SELECT uuid FROM exercises WHERE title = 'Donkey Calf' AND is_hidden = false LIMIT 1), 2),
  ('rte-bp-fri-3', 'rtn-bp-fri', (SELECT uuid FROM exercises WHERE title = 'Hip Abduction (Machine)' AND is_hidden = false LIMIT 1), 3)
ON CONFLICT DO NOTHING;

INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index)
SELECT gen_random_uuid()::text, rte.uuid, s.min_r, s.max_r, s.idx
FROM (VALUES
  ('rte-bp-fri-0', 8, 12, 0), ('rte-bp-fri-0', 8, 12, 1), ('rte-bp-fri-0', 8, 12, 2),
  ('rte-bp-fri-1', 8, 12, 0), ('rte-bp-fri-1', 8, 12, 1),
  ('rte-bp-fri-2', 12, 15, 0), ('rte-bp-fri-2', 12, 15, 1), ('rte-bp-fri-2', 12, 15, 2),
  ('rte-bp-fri-3', 15, 20, 0), ('rte-bp-fri-3', 15, 20, 1)
) AS s(rte_uuid, min_r, max_r, idx)
JOIN workout_routine_exercises rte ON rte.uuid = s.rte_uuid;

COMMIT;
