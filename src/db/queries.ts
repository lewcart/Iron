import { getDb } from './db';
import type {
  Exercise,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  WorkoutPlan,
  WorkoutRoutine,
} from '../types';
import { randomUUID } from 'crypto';

// ===== EXERCISES =====

export function listExercises(options: {
  search?: string;
  muscleGroup?: string;
  includeHidden?: boolean;
} = {}): Exercise[] {
  const db = getDb();
  let sql = 'SELECT * FROM exercises WHERE 1=1';
  const params: any[] = [];

  if (!options.includeHidden) {
    sql += ' AND is_hidden = 0';
  }

  if (options.search) {
    sql += ' AND (title LIKE ? OR alias LIKE ?)';
    const searchTerm = `%${options.search}%`;
    params.push(searchTerm, searchTerm);
  }

  if (options.muscleGroup) {
    sql += ' AND (primary_muscles LIKE ? OR secondary_muscles LIKE ?)';
    const muscleTerm = `%${options.muscleGroup}%`;
    params.push(muscleTerm, muscleTerm);
  }

  sql += ' ORDER BY is_custom ASC, title ASC';

  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(parseExercise);
}

export function getExercise(uuid: string): Exercise | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM exercises WHERE uuid = ?').get(uuid) as any;
  return row ? parseExercise(row) : null;
}

export function createCustomExercise(data: {
  title: string;
  description?: string;
  primaryMuscles: string[];
  secondaryMuscles?: string[];
  equipment?: string[];
  steps?: string[];
  tips?: string[];
}): Exercise {
  const db = getDb();
  const uuid = randomUUID();

  db.prepare(`
    INSERT INTO exercises (
      uuid, everkinetic_id, title, description,
      primary_muscles, secondary_muscles, equipment,
      steps, tips, is_custom
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    uuid,
    10000 + Date.now(), // Custom exercises have IDs >= 10000
    data.title,
    data.description || null,
    JSON.stringify(data.primaryMuscles),
    JSON.stringify(data.secondaryMuscles || []),
    JSON.stringify(data.equipment || []),
    JSON.stringify(data.steps || []),
    JSON.stringify(data.tips || [])
  );

  return getExercise(uuid)!;
}

// ===== WORKOUTS =====

export function startWorkout(routineUuid?: string): Workout {
  const db = getDb();
  const uuid = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO workouts (uuid, start_time, is_current, workout_routine_uuid)
    VALUES (?, ?, 1, ?)
  `).run(uuid, now, routineUuid || null);

  return getWorkout(uuid)!;
}

export function getCurrentWorkout(): Workout | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM workouts WHERE is_current = 1').get() as any;
  return row ? parseWorkout(row) : null;
}

export function getWorkout(uuid: string): Workout | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM workouts WHERE uuid = ?').get(uuid) as any;
  return row ? parseWorkout(row) : null;
}

export function listWorkouts(options: {
  limit?: number;
  offset?: number;
  since?: Date;
} = {}): Workout[] {
  const db = getDb();
  let sql = 'SELECT * FROM workouts WHERE is_current = 0 ORDER BY start_time DESC';
  const params: any[] = [];

  if (options.since) {
    sql = sql.replace('WHERE', 'WHERE start_time >= ? AND');
    params.push(options.since.toISOString());
  }

  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  if (options.offset) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(parseWorkout);
}

export function finishWorkout(uuid: string): Workout {
  const db = getDb();
  const now = new Date().toISOString();

  // Clean up exercises with no completed sets
  db.prepare(`
    DELETE FROM workout_exercises
    WHERE workout_uuid = ?
    AND uuid NOT IN (
      SELECT DISTINCT workout_exercise_uuid
      FROM workout_sets
      WHERE is_completed = 1
    )
  `).run(uuid);

  // Mark workout as complete
  db.prepare(`
    UPDATE workouts
    SET end_time = ?, is_current = 0
    WHERE uuid = ?
  `).run(now, uuid);

  return getWorkout(uuid)!;
}

export function cancelWorkout(uuid: string): void {
  const db = getDb();
  db.prepare('DELETE FROM workouts WHERE uuid = ?').run(uuid);
}

// ===== WORKOUT EXERCISES =====

export function addExerciseToWorkout(
  workoutUuid: string,
  exerciseUuid: string
): WorkoutExercise {
  const db = getDb();
  const uuid = randomUUID();

  // Get next order index
  const maxOrder = db.prepare(`
    SELECT MAX(order_index) as max FROM workout_exercises WHERE workout_uuid = ?
  `).get(workoutUuid) as any;
  const orderIndex = (maxOrder?.max ?? -1) + 1;

  db.prepare(`
    INSERT INTO workout_exercises (uuid, workout_uuid, exercise_uuid, order_index)
    VALUES (?, ?, ?, ?)
  `).run(uuid, workoutUuid, exerciseUuid, orderIndex);

  // Guess number of sets from history (median of last 3 workouts)
  const historySets = db.prepare(`
    SELECT COUNT(*) as set_count
    FROM workout_sets ws
    JOIN workout_exercises we ON ws.workout_exercise_uuid = we.uuid
    WHERE we.exercise_uuid = ?
    GROUP BY we.uuid
    ORDER BY we.created_at DESC
    LIMIT 3
  `).all(exerciseUuid) as any[];

  const defaultSets = historySets.length > 0
    ? Math.round(historySets.reduce((sum, r) => sum + r.set_count, 0) / historySets.length)
    : 3; // Default 3 sets

  // Create empty sets
  for (let i = 0; i < defaultSets; i++) {
    db.prepare(`
      INSERT INTO workout_sets (uuid, workout_exercise_uuid, order_index, is_completed)
      VALUES (?, ?, ?, 0)
    `).run(randomUUID(), uuid, i);
  }

  return getWorkoutExercise(uuid)!;
}

export function getWorkoutExercise(uuid: string): WorkoutExercise | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM workout_exercises WHERE uuid = ?').get(uuid) as any;
  return row ? parseWorkoutExercise(row) : null;
}

export function listWorkoutExercises(workoutUuid: string): WorkoutExercise[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM workout_exercises WHERE workout_uuid = ? ORDER BY order_index
  `).all(workoutUuid) as any[];
  return rows.map(parseWorkoutExercise);
}

// ===== WORKOUT SETS =====

export function logSet(data: {
  workoutExerciseUuid: string;
  weight: number;
  repetitions: number;
  rpe?: number;
  tag?: 'dropSet' | 'failure';
  orderIndex?: number;
}): WorkoutSet {
  const db = getDb();
  const uuid = randomUUID();

  // Get next order index if not specified
  let orderIndex = data.orderIndex;
  if (orderIndex === undefined) {
    const maxOrder = db.prepare(`
      SELECT MAX(order_index) as max FROM workout_sets WHERE workout_exercise_uuid = ?
    `).get(data.workoutExerciseUuid) as any;
    orderIndex = (maxOrder?.max ?? -1) + 1;
  }

  db.prepare(`
    INSERT INTO workout_sets (
      uuid, workout_exercise_uuid, weight, repetitions, rpe, tag, order_index, is_completed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    uuid,
    data.workoutExerciseUuid,
    data.weight,
    data.repetitions,
    data.rpe || null,
    data.tag || null,
    orderIndex
  );

  return getWorkoutSet(uuid)!;
}

export function updateSet(uuid: string, data: {
  weight?: number;
  repetitions?: number;
  rpe?: number;
  tag?: 'dropSet' | 'failure' | null;
  isCompleted?: boolean;
}): WorkoutSet {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (data.weight !== undefined) {
    fields.push('weight = ?');
    values.push(data.weight);
  }
  if (data.repetitions !== undefined) {
    fields.push('repetitions = ?');
    values.push(data.repetitions);
  }
  if (data.rpe !== undefined) {
    fields.push('rpe = ?');
    values.push(data.rpe);
  }
  if (data.tag !== undefined) {
    fields.push('tag = ?');
    values.push(data.tag);
  }
  if (data.isCompleted !== undefined) {
    fields.push('is_completed = ?');
    values.push(data.isCompleted ? 1 : 0);
  }

  if (fields.length > 0) {
    values.push(uuid);
    db.prepare(`UPDATE workout_sets SET ${fields.join(', ')} WHERE uuid = ?`).run(...values);
  }

  return getWorkoutSet(uuid)!;
}

export function getWorkoutSet(uuid: string): WorkoutSet | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM workout_sets WHERE uuid = ?').get(uuid) as any;
  return row ? parseWorkoutSet(row) : null;
}

export function listWorkoutSets(workoutExerciseUuid: string): WorkoutSet[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM workout_sets WHERE workout_exercise_uuid = ? ORDER BY order_index
  `).all(workoutExerciseUuid) as any[];
  return rows.map(parseWorkoutSet);
}

// ===== HELPERS =====

function parseExercise(row: any): Exercise {
  return {
    uuid: row.uuid,
    everkinetic_id: row.everkinetic_id,
    title: row.title,
    alias: JSON.parse(row.alias || '[]'),
    description: row.description,
    primary_muscles: JSON.parse(row.primary_muscles || '[]'),
    secondary_muscles: JSON.parse(row.secondary_muscles || '[]'),
    equipment: JSON.parse(row.equipment || '[]'),
    steps: JSON.parse(row.steps || '[]'),
    tips: JSON.parse(row.tips || '[]'),
    is_custom: Boolean(row.is_custom),
    is_hidden: Boolean(row.is_hidden),
  };
}

function parseWorkout(row: any): Workout {
  return {
    uuid: row.uuid,
    start_time: row.start_time,
    end_time: row.end_time,
    title: row.title,
    comment: row.comment,
    is_current: Boolean(row.is_current),
  };
}

function parseWorkoutExercise(row: any): WorkoutExercise {
  return {
    uuid: row.uuid,
    workout_uuid: row.workout_uuid,
    exercise_uuid: row.exercise_uuid,
    comment: row.comment,
    order_index: row.order_index,
  };
}

function parseWorkoutSet(row: any): WorkoutSet {
  return {
    uuid: row.uuid,
    workout_exercise_uuid: row.workout_exercise_uuid,
    weight: row.weight,
    repetitions: row.repetitions,
    min_target_reps: row.min_target_reps,
    max_target_reps: row.max_target_reps,
    rpe: row.rpe,
    tag: row.tag,
    comment: row.comment,
    is_completed: Boolean(row.is_completed),
    order_index: row.order_index,
  };
}
