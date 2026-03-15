import { query, queryOne } from './db';
import type {
  Exercise,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  PersonalRecord,
} from '../types';
import { calculatePRs } from '../lib/pr';

export type DbRow = Record<string, unknown>;
import { randomUUID } from 'crypto';

// ===== EXERCISES =====

export async function listExercises(options: {
  search?: string;
  muscleGroup?: string;
  equipment?: string;
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

  if (options.equipment) {
    sql += ` AND equipment::text ILIKE $${++paramCount}`;
    params.push(`%${options.equipment}%`);
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

export interface WorkoutSummary extends Workout {
  exercise_count: number;
  total_volume: number;
}

export async function listWorkouts(options: {
  limit?: number;
  offset?: number;
  since?: Date;
  from?: string;
  to?: string;
  exerciseUuid?: string;
} = {}): Promise<WorkoutSummary[]> {
  const conditions: string[] = ['w.is_current = false'];
  const params: unknown[] = [];
  let paramCount = 0;

  if (options.since) {
    conditions.push(`w.start_time >= $${++paramCount}`);
    params.push(options.since.toISOString());
  }

  if (options.from) {
    conditions.push(`w.start_time >= $${++paramCount}`);
    params.push(options.from);
  }

  if (options.to) {
    // Include the full "to" day by going to end of day
    conditions.push(`w.start_time < ($${++paramCount}::date + INTERVAL '1 day')`);
    params.push(options.to);
  }

  if (options.exerciseUuid) {
    conditions.push(`w.uuid IN (
      SELECT DISTINCT we.workout_uuid
      FROM workout_exercises we
      WHERE we.exercise_uuid = $${++paramCount}
    )`);
    params.push(options.exerciseUuid);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  let sql = `
    SELECT
      w.*,
      COUNT(DISTINCT we.uuid) AS exercise_count,
      COALESCE(SUM(CASE WHEN ws.is_completed THEN ws.weight * ws.repetitions ELSE 0 END), 0) AS total_volume
    FROM workouts w
    LEFT JOIN workout_exercises we ON we.workout_uuid = w.uuid
    LEFT JOIN workout_sets ws ON ws.workout_exercise_uuid = we.uuid
    ${whereClause}
    GROUP BY w.uuid
    ORDER BY w.start_time DESC
  `;

  if (options.limit) {
    sql += ` LIMIT $${++paramCount}`;
    params.push(options.limit);
  }

  if (options.offset) {
    sql += ` OFFSET $${++paramCount}`;
    params.push(options.offset);
  }

  const rows = await query<DbRow>(sql, params);
  return rows.map(parseWorkoutWithStats);
}

export function parseWorkoutWithStats(row: DbRow): WorkoutSummary {
  return {
    ...parseWorkout(row),
    exercise_count: Number(row.exercise_count ?? 0),
    total_volume: parseFloat((row.total_volume as string | number | null) as string ?? '0') || 0,
  };
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

// ===== EXERCISE PROGRESS & PRs =====

export async function getExerciseProgress(exerciseUuid: string): Promise<Array<{
  date: string;
  maxWeight: number;
  totalVolume: number;
  estimated1RM: number;
}>> {
  const rows = await query<{
    date: string;
    max_weight: string;
    total_volume: string;
    max_reps_at_max_weight: number;
  }>(`
    SELECT
      w.start_time AS date,
      MAX(ws.weight) AS max_weight,
      SUM(ws.weight * ws.repetitions) AS total_volume,
      MAX(ws.repetitions) FILTER (WHERE ws.weight = MAX(ws.weight) OVER (PARTITION BY w.uuid)) AS max_reps_at_max_weight
    FROM workout_sets ws
    JOIN workout_exercises we ON ws.workout_exercise_uuid = we.uuid
    JOIN workouts w ON we.workout_uuid = w.uuid
    WHERE we.exercise_uuid = $1
      AND ws.is_completed = true
      AND ws.weight IS NOT NULL
      AND ws.repetitions IS NOT NULL
    GROUP BY w.uuid, w.start_time
    ORDER BY w.start_time ASC
  `, [exerciseUuid]);

  return rows.map((row) => {
    const maxWeight = parseFloat(row.max_weight) || 0;
    const totalVolume = parseFloat(row.total_volume) || 0;
    const reps = row.max_reps_at_max_weight || 1;
    const estimated1RM = maxWeight * (1 + reps / 30);
    return {
      date: row.date,
      maxWeight,
      totalVolume,
      estimated1RM,
    };
  });
}

export async function getExercisePRs(exerciseUuid: string): Promise<{
  estimated1RM: PersonalRecord | null;
  heaviestWeight: PersonalRecord | null;
  mostReps: PersonalRecord | null;
}> {
  const rows = await query<{
    date: string;
    weight: string;
    repetitions: number;
    workout_uuid: string;
  }>(`
    SELECT
      w.start_time AS date,
      ws.weight,
      ws.repetitions,
      w.uuid AS workout_uuid
    FROM workout_sets ws
    JOIN workout_exercises we ON ws.workout_exercise_uuid = we.uuid
    JOIN workouts w ON we.workout_uuid = w.uuid
    WHERE we.exercise_uuid = $1
      AND ws.is_completed = true
      AND ws.weight IS NOT NULL
      AND ws.repetitions IS NOT NULL
    ORDER BY w.start_time ASC
  `, [exerciseUuid]);

  const sets = rows.map((row) => ({
    weight: parseFloat(row.weight),
    repetitions: row.repetitions,
    date: row.date,
    workout_uuid: row.workout_uuid,
    exercise_uuid: exerciseUuid,
  }));

  return calculatePRs(sets);
}

export async function getExerciseVolumeTrend(exerciseUuid: string): Promise<Array<{
  date: string;
  totalVolume: number;
}>> {
  const rows = await query<{
    date: string;
    total_volume: string;
  }>(`
    SELECT
      w.start_time AS date,
      SUM(ws.weight * ws.repetitions) AS total_volume
    FROM workout_sets ws
    JOIN workout_exercises we ON ws.workout_exercise_uuid = we.uuid
    JOIN workouts w ON we.workout_uuid = w.uuid
    WHERE we.exercise_uuid = $1
      AND ws.is_completed = true
      AND ws.weight IS NOT NULL
      AND ws.repetitions IS NOT NULL
    GROUP BY w.uuid, w.start_time
    ORDER BY w.start_time ASC
  `, [exerciseUuid]);

  return rows.map((row) => ({
    date: row.date,
    totalVolume: parseFloat(row.total_volume) || 0,
  }));
}

export async function getExerciseRecentSets(
  exerciseUuid: string,
  limit = 20,
): Promise<Array<{
  date: string;
  weight: number;
  repetitions: number;
  rpe: number | null;
  workoutUuid: string;
}>> {
  const rows = await query<{
    date: string;
    weight: string;
    repetitions: number;
    rpe: string | null;
    workout_uuid: string;
  }>(`
    SELECT
      w.start_time AS date,
      ws.weight,
      ws.repetitions,
      ws.rpe,
      w.uuid AS workout_uuid
    FROM workout_sets ws
    JOIN workout_exercises we ON ws.workout_exercise_uuid = we.uuid
    JOIN workouts w ON we.workout_uuid = w.uuid
    WHERE we.exercise_uuid = $1
      AND ws.is_completed = true
      AND ws.weight IS NOT NULL
      AND ws.repetitions IS NOT NULL
    ORDER BY w.start_time DESC, ws.order_index ASC
    LIMIT $2
  `, [exerciseUuid, limit]);

  return rows.map((row) => ({
    date: row.date,
    weight: parseFloat(row.weight),
    repetitions: row.repetitions,
    rpe: row.rpe ? parseFloat(row.rpe) : null,
    workoutUuid: row.workout_uuid,
  }));
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
