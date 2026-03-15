import { query, queryOne } from './db';
import type {
  Exercise,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  WorkoutPlan,
  WorkoutRoutine,
  WorkoutRoutineExercise,
} from '../types';

export type DbRow = Record<string, unknown>;
import { randomUUID } from 'crypto';

// ===== EXERCISES =====

export async function listExercises(options: {
  search?: string;
  muscleGroup?: string;
  includeHidden?: boolean;
} = {}): Promise<Exercise[]> {
  let sql = 'SELECT * FROM exercises WHERE 1=1';
  const params: unknown[] = [];
  let paramCount = 0;

  if (!options.includeHidden) {
    sql += ' AND is_hidden = false';
  }

  if (options.search) {
    sql += ` AND (title ILIKE $${++paramCount} OR alias::text ILIKE $${++paramCount})`;
    const searchTerm = `%${options.search}%`;
    params.push(searchTerm, searchTerm);
  }

  if (options.muscleGroup) {
    sql += ` AND (primary_muscles::text ILIKE $${++paramCount} OR secondary_muscles::text ILIKE $${++paramCount})`;
    const muscleTerm = `%${options.muscleGroup}%`;
    params.push(muscleTerm, muscleTerm);
  }

  sql += ' ORDER BY is_custom ASC, title ASC';

  const rows = await query<DbRow>(sql, params);
  return rows.map(parseExercise);
}

export async function getExercise(uuid: string): Promise<Exercise | null> {
  const row = await queryOne<DbRow>('SELECT * FROM exercises WHERE uuid = $1', [uuid]);
  return row ? parseExercise(row) : null;
}

export async function createCustomExercise(data: {
  title: string;
  description?: string;
  primaryMuscles: string[];
  secondaryMuscles?: string[];
  equipment?: string[];
  steps?: string[];
  tips?: string[];
}): Promise<Exercise> {
  const uuid = randomUUID();

  await query(`
    INSERT INTO exercises (
      uuid, everkinetic_id, title, description,
      primary_muscles, secondary_muscles, equipment,
      steps, tips, is_custom
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
  `, [
    uuid,
    10000 + Date.now(),
    data.title,
    data.description || null,
    JSON.stringify(data.primaryMuscles),
    JSON.stringify(data.secondaryMuscles || []),
    JSON.stringify(data.equipment || []),
    JSON.stringify(data.steps || []),
    JSON.stringify(data.tips || []),
  ]);

  return (await getExercise(uuid))!;
}

// ===== WORKOUTS =====

export async function startWorkout(routineUuid?: string): Promise<Workout> {
  const uuid = randomUUID();
  const now = new Date().toISOString();

  await query(`
    INSERT INTO workouts (uuid, start_time, is_current, workout_routine_uuid)
    VALUES ($1, $2, true, $3)
  `, [uuid, now, routineUuid || null]);

  return (await getWorkout(uuid))!;
}

export async function getCurrentWorkout(): Promise<Workout | null> {
  const row = await queryOne<DbRow>('SELECT * FROM workouts WHERE is_current = true');
  return row ? parseWorkout(row) : null;
}

export async function getWorkout(uuid: string): Promise<Workout | null> {
  const row = await queryOne<DbRow>('SELECT * FROM workouts WHERE uuid = $1', [uuid]);
  return row ? parseWorkout(row) : null;
}

export async function listWorkouts(options: {
  limit?: number;
  offset?: number;
  since?: Date;
} = {}): Promise<Workout[]> {
  let sql = 'SELECT * FROM workouts WHERE is_current = false ORDER BY start_time DESC';
  const params: unknown[] = [];
  let paramCount = 0;

  if (options.since) {
    sql = sql.replace('WHERE', `WHERE start_time >= $${++paramCount} AND`);
    params.push(options.since.toISOString());
  }

  if (options.limit) {
    sql += ` LIMIT $${++paramCount}`;
    params.push(options.limit);
  }

  if (options.offset) {
    sql += ` OFFSET $${++paramCount}`;
    params.push(options.offset);
  }

  const rows = await query<DbRow>(sql, params);
  return rows.map(parseWorkout);
}

export async function finishWorkout(uuid: string): Promise<Workout> {
  const now = new Date().toISOString();

  // Clean up exercises with no completed sets
  await query(`
    DELETE FROM workout_exercises
    WHERE workout_uuid = $1
    AND uuid NOT IN (
      SELECT DISTINCT workout_exercise_uuid
      FROM workout_sets
      WHERE is_completed = true
    )
  `, [uuid]);

  // Mark workout as complete
  await query(`
    UPDATE workouts
    SET end_time = $1, is_current = false
    WHERE uuid = $2
  `, [now, uuid]);

  return (await getWorkout(uuid))!;
}

export async function cancelWorkout(uuid: string): Promise<void> {
  await query('DELETE FROM workouts WHERE uuid = $1', [uuid]);
}

// ===== WORKOUT EXERCISES =====

export async function addExerciseToWorkout(
  workoutUuid: string,
  exerciseUuid: string
): Promise<WorkoutExercise> {
  const uuid = randomUUID();

  // Get next order index
  const maxOrder = await queryOne<DbRow>(`
    SELECT MAX(order_index) as max FROM workout_exercises WHERE workout_uuid = $1
  `, [workoutUuid]);
  const orderIndex = (Number(maxOrder?.max ?? -1)) + 1;

  await query(`
    INSERT INTO workout_exercises (uuid, workout_uuid, exercise_uuid, order_index)
    VALUES ($1, $2, $3, $4)
  `, [uuid, workoutUuid, exerciseUuid, orderIndex]);

  // Guess number of sets from history (median of last 3 workouts)
  const historySets = await query<DbRow>(`
    SELECT COUNT(*) as set_count
    FROM workout_sets ws
    JOIN workout_exercises we ON ws.workout_exercise_uuid = we.uuid
    WHERE we.exercise_uuid = $1
    GROUP BY we.uuid
    ORDER BY we.created_at DESC
    LIMIT 3
  `, [exerciseUuid]);

  const defaultSets = historySets.length > 0
    ? Math.round(historySets.reduce((sum, r) => sum + Number(r.set_count), 0) / historySets.length)
    : 3; // Default 3 sets

  // Create empty sets
  for (let i = 0; i < defaultSets; i++) {
    await query(`
      INSERT INTO workout_sets (uuid, workout_exercise_uuid, order_index, is_completed)
      VALUES ($1, $2, $3, false)
    `, [randomUUID(), uuid, i]);
  }

  return (await getWorkoutExercise(uuid))!;
}

export async function getWorkoutExercise(uuid: string): Promise<WorkoutExercise | null> {
  const row = await queryOne<DbRow>('SELECT * FROM workout_exercises WHERE uuid = $1', [uuid]);
  return row ? parseWorkoutExercise(row) : null;
}

export async function listWorkoutExercises(workoutUuid: string): Promise<WorkoutExercise[]> {
  const rows = await query<DbRow>(`
    SELECT * FROM workout_exercises WHERE workout_uuid = $1 ORDER BY order_index
  `, [workoutUuid]);
  return rows.map(parseWorkoutExercise);
}

// ===== WORKOUT SETS =====

export async function logSet(data: {
  workoutExerciseUuid: string;
  weight: number;
  repetitions: number;
  rpe?: number;
  tag?: 'dropSet' | 'failure';
  orderIndex?: number;
}): Promise<WorkoutSet> {
  const uuid = randomUUID();

  // Get next order index if not specified
  let orderIndex = data.orderIndex;
  if (orderIndex === undefined) {
    const maxOrder = await queryOne<DbRow>(`
      SELECT MAX(order_index) as max FROM workout_sets WHERE workout_exercise_uuid = $1
    `, [data.workoutExerciseUuid]);
    orderIndex = (Number(maxOrder?.max ?? -1)) + 1;
  }

  await query(`
    INSERT INTO workout_sets (
      uuid, workout_exercise_uuid, weight, repetitions, rpe, tag, order_index, is_completed
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
  `, [
    uuid,
    data.workoutExerciseUuid,
    data.weight,
    data.repetitions,
    data.rpe || null,
    data.tag || null,
    orderIndex,
  ]);

  return (await getWorkoutSet(uuid))!;
}

export async function updateSet(uuid: string, data: {
  weight?: number;
  repetitions?: number;
  rpe?: number;
  tag?: 'dropSet' | 'failure' | null;
  isCompleted?: boolean;
}): Promise<WorkoutSet> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramCount = 0;

  if (data.weight !== undefined) {
    fields.push(`weight = $${++paramCount}`);
    values.push(data.weight);
  }
  if (data.repetitions !== undefined) {
    fields.push(`repetitions = $${++paramCount}`);
    values.push(data.repetitions);
  }
  if (data.rpe !== undefined) {
    fields.push(`rpe = $${++paramCount}`);
    values.push(data.rpe);
  }
  if (data.tag !== undefined) {
    fields.push(`tag = $${++paramCount}`);
    values.push(data.tag);
  }
  if (data.isCompleted !== undefined) {
    fields.push(`is_completed = $${++paramCount}`);
    values.push(data.isCompleted);
  }

  if (fields.length > 0) {
    values.push(uuid);
    await query(`UPDATE workout_sets SET ${fields.join(', ')} WHERE uuid = $${++paramCount}`, values);
  }

  return (await getWorkoutSet(uuid))!;
}

export async function getWorkoutSet(uuid: string): Promise<WorkoutSet | null> {
  const row = await queryOne<DbRow>('SELECT * FROM workout_sets WHERE uuid = $1', [uuid]);
  return row ? parseWorkoutSet(row) : null;
}

export async function listWorkoutSets(workoutExerciseUuid: string): Promise<WorkoutSet[]> {
  const rows = await query<DbRow>(`
    SELECT * FROM workout_sets WHERE workout_exercise_uuid = $1 ORDER BY order_index
  `, [workoutExerciseUuid]);
  return rows.map(parseWorkoutSet);
}

// ===== WORKOUT PLANS =====

export async function listPlans(): Promise<WorkoutPlan[]> {
  const rows = await query<DbRow>('SELECT * FROM workout_plans ORDER BY created_at DESC');
  return rows.map(parsePlan);
}

export async function getPlan(uuid: string): Promise<WorkoutPlan | null> {
  const row = await queryOne<DbRow>('SELECT * FROM workout_plans WHERE uuid = $1', [uuid]);
  return row ? parsePlan(row) : null;
}

export async function createPlan(title: string): Promise<WorkoutPlan> {
  const uuid = randomUUID();
  await query('INSERT INTO workout_plans (uuid, title) VALUES ($1, $2)', [uuid, title]);
  return (await getPlan(uuid))!;
}

export async function updatePlan(uuid: string, title: string): Promise<WorkoutPlan> {
  await query('UPDATE workout_plans SET title = $1 WHERE uuid = $2', [title, uuid]);
  return (await getPlan(uuid))!;
}

export async function deletePlan(uuid: string): Promise<void> {
  await query('DELETE FROM workout_plans WHERE uuid = $1', [uuid]);
}

// ===== WORKOUT ROUTINES =====

export async function listRoutines(planUuid: string): Promise<WorkoutRoutine[]> {
  const rows = await query<DbRow>(
    'SELECT * FROM workout_routines WHERE workout_plan_uuid = $1 ORDER BY order_index',
    [planUuid]
  );
  return rows.map(parseRoutine);
}

export async function getRoutine(uuid: string): Promise<WorkoutRoutine | null> {
  const row = await queryOne<DbRow>('SELECT * FROM workout_routines WHERE uuid = $1', [uuid]);
  return row ? parseRoutine(row) : null;
}

export async function createRoutine(planUuid: string, title: string): Promise<WorkoutRoutine> {
  const uuid = randomUUID();
  const maxOrder = await queryOne<DbRow>(
    'SELECT MAX(order_index) as max FROM workout_routines WHERE workout_plan_uuid = $1',
    [planUuid]
  );
  const orderIndex = (Number(maxOrder?.max ?? -1)) + 1;
  await query(
    'INSERT INTO workout_routines (uuid, workout_plan_uuid, title, order_index) VALUES ($1, $2, $3, $4)',
    [uuid, planUuid, title, orderIndex]
  );
  return (await getRoutine(uuid))!;
}

export async function updateRoutine(uuid: string, title: string): Promise<WorkoutRoutine> {
  await query('UPDATE workout_routines SET title = $1 WHERE uuid = $2', [title, uuid]);
  return (await getRoutine(uuid))!;
}

export async function deleteRoutine(uuid: string): Promise<void> {
  await query('DELETE FROM workout_routines WHERE uuid = $1', [uuid]);
}

// ===== WORKOUT ROUTINE EXERCISES =====

export async function listRoutineExercises(routineUuid: string): Promise<WorkoutRoutineExercise[]> {
  const rows = await query<DbRow>(
    'SELECT * FROM workout_routine_exercises WHERE workout_routine_uuid = $1 ORDER BY order_index',
    [routineUuid]
  );
  return rows.map(parseRoutineExercise);
}

export async function addExerciseToRoutine(
  routineUuid: string,
  exerciseUuid: string
): Promise<WorkoutRoutineExercise> {
  const uuid = randomUUID();
  const maxOrder = await queryOne<DbRow>(
    'SELECT MAX(order_index) as max FROM workout_routine_exercises WHERE workout_routine_uuid = $1',
    [routineUuid]
  );
  const orderIndex = (Number(maxOrder?.max ?? -1)) + 1;
  await query(
    'INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index) VALUES ($1, $2, $3, $4)',
    [uuid, routineUuid, exerciseUuid, orderIndex]
  );
  const row = await queryOne<DbRow>('SELECT * FROM workout_routine_exercises WHERE uuid = $1', [uuid]);
  return parseRoutineExercise(row!);
}

export async function removeExerciseFromRoutine(
  routineUuid: string,
  exerciseUuid: string
): Promise<void> {
  await query(
    'DELETE FROM workout_routine_exercises WHERE workout_routine_uuid = $1 AND exercise_uuid = $2',
    [routineUuid, exerciseUuid]
  );
}

export async function startWorkoutFromRoutine(routineUuid: string): Promise<Workout> {
  const workoutUuid = randomUUID();
  const now = new Date().toISOString();

  await query(`
    INSERT INTO workouts (uuid, start_time, is_current, workout_routine_uuid)
    VALUES ($1, $2, true, $3)
  `, [workoutUuid, now, routineUuid]);

  // Copy exercises from routine
  const routineExercises = await listRoutineExercises(routineUuid);
  for (const re of routineExercises) {
    const weUuid = randomUUID();
    await query(`
      INSERT INTO workout_exercises (uuid, workout_uuid, exercise_uuid, order_index)
      VALUES ($1, $2, $3, $4)
    `, [weUuid, workoutUuid, re.exercise_uuid, re.order_index]);

    // Default 3 sets per exercise
    for (let i = 0; i < 3; i++) {
      await query(`
        INSERT INTO workout_sets (uuid, workout_exercise_uuid, order_index, is_completed)
        VALUES ($1, $2, $3, false)
      `, [randomUUID(), weUuid, i]);
    }
  }

  return (await getWorkout(workoutUuid))!;
}

// ===== HELPERS =====

export function parseExercise(row: DbRow): Exercise {
  return {
    uuid: row.uuid as string,
    everkinetic_id: row.everkinetic_id as number,
    title: row.title as string,
    alias: Array.isArray(row.alias) ? row.alias as string[] : JSON.parse(row.alias as string || '[]'),
    description: row.description as string | null,
    primary_muscles: Array.isArray(row.primary_muscles) ? row.primary_muscles as string[] : JSON.parse(row.primary_muscles as string || '[]'),
    secondary_muscles: Array.isArray(row.secondary_muscles) ? row.secondary_muscles as string[] : JSON.parse(row.secondary_muscles as string || '[]'),
    equipment: Array.isArray(row.equipment) ? row.equipment as string[] : JSON.parse(row.equipment as string || '[]'),
    steps: Array.isArray(row.steps) ? row.steps as string[] : JSON.parse(row.steps as string || '[]'),
    tips: Array.isArray(row.tips) ? row.tips as string[] : JSON.parse(row.tips as string || '[]'),
    is_custom: Boolean(row.is_custom),
    is_hidden: Boolean(row.is_hidden),
  };
}

export function parseWorkout(row: DbRow): Workout {
  return {
    uuid: row.uuid as string,
    start_time: row.start_time as string,
    end_time: row.end_time as string | null,
    title: row.title as string | null,
    comment: row.comment as string | null,
    is_current: Boolean(row.is_current),
  };
}

export function parseWorkoutExercise(row: DbRow): WorkoutExercise {
  return {
    uuid: row.uuid as string,
    workout_uuid: row.workout_uuid as string,
    exercise_uuid: row.exercise_uuid as string,
    comment: row.comment as string | null,
    order_index: row.order_index as number,
  };
}

export function parseWorkoutSet(row: DbRow): WorkoutSet {
  return {
    uuid: row.uuid as string,
    workout_exercise_uuid: row.workout_exercise_uuid as string,
    weight: row.weight ? parseFloat(row.weight as string) : null,
    repetitions: row.repetitions as number | null,
    min_target_reps: row.min_target_reps as number | null,
    max_target_reps: row.max_target_reps as number | null,
    rpe: row.rpe ? parseFloat(row.rpe as string) : null,
    tag: row.tag as 'dropSet' | 'failure' | null,
    comment: row.comment as string | null,
    is_completed: Boolean(row.is_completed),
    order_index: row.order_index as number,
  };
}

export function parsePlan(row: DbRow): WorkoutPlan {
  return {
    uuid: row.uuid as string,
    title: row.title as string | null,
  };
}

export function parseRoutine(row: DbRow): WorkoutRoutine {
  return {
    uuid: row.uuid as string,
    workout_plan_uuid: row.workout_plan_uuid as string,
    title: row.title as string | null,
    comment: row.comment as string | null,
    order_index: row.order_index as number,
  };
}

export function parseRoutineExercise(row: DbRow): WorkoutRoutineExercise {
  return {
    uuid: row.uuid as string,
    workout_routine_uuid: row.workout_routine_uuid as string,
    exercise_uuid: row.exercise_uuid as string,
    comment: row.comment as string | null,
    order_index: row.order_index as number,
  };
}
