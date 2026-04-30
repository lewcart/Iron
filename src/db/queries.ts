import { query, queryOne } from './db';
import type {
  Exercise,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  PersonalRecord,
  WorkoutPlan,
  WorkoutRoutine,
  WorkoutRoutineExercise,
  WorkoutRoutineSet,
  BodyweightLog,
  BodySpecLog,
  MeasurementLog,
  NutritionLog,
  NutritionWeekMeal,
  NutritionDayNote,
  HrtProtocol,
  HrtLog,
  WellbeingLog,
  DysphoriaLog,
  ClothesTestLog,
  ProgressPhoto,
  InspoPhoto,
  InbodyScan,
  BodyGoal,
  BodyNormRange,
  BodyBalance,
} from '../types';
import { calculatePRs, estimate1RM } from '../lib/pr';
import { muscleGroupSearchTerms } from '../lib/muscle-groups';

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
    const terms = muscleGroupSearchTerms(options.muscleGroup);
    if (terms.length > 0) {
      const orChunks: string[] = [];
      for (const t of terms) {
        const p1 = ++paramCount;
        const p2 = ++paramCount;
        const v = `%${t}%`;
        params.push(v, v);
        orChunks.push(
          `(primary_muscles::text ILIKE $${p1} OR secondary_muscles::text ILIKE $${p2})`
        );
      }
      sql += ` AND (${orChunks.join(' OR ')})`;
    }
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
  movementPattern?: string;
}): Promise<Exercise> {
  const uuid = randomUUID();

  await query(`
    INSERT INTO exercises (
      uuid, everkinetic_id, title, description,
      primary_muscles, secondary_muscles, equipment,
      steps, tips, is_custom, movement_pattern
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)
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
    data.movementPattern || null,
  ]);

  return (await getExercise(uuid))!;
}

// ===== WORKOUTS =====

export async function startWorkout(routineUuid?: string): Promise<Workout> {
  const uuid = randomUUID();
  const now = new Date().toISOString();

  // End any currently active workout first (unique index enforces single active)
  await query(`UPDATE workouts SET is_current = false, end_time = $1 WHERE is_current = true`, [now]);

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
  isPr?: boolean;
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
  if (data.isPr !== undefined) {
    fields.push(`is_pr = $${++paramCount}`);
    values.push(data.isPr);
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

export async function getHistoricalBestsForExercise(
  exerciseUuid: string,
  excludeWorkoutUuid: string,
): Promise<{ best1RM: number }> {
  const rows = await query<{
    weight: string;
    repetitions: number;
  }>(`
    SELECT ws.weight, ws.repetitions
    FROM workout_sets ws
    JOIN workout_exercises we ON ws.workout_exercise_uuid = we.uuid
    JOIN workouts w ON we.workout_uuid = w.uuid
    WHERE we.exercise_uuid = $1
      AND w.uuid != $2
      AND ws.is_completed = true
      AND ws.weight IS NOT NULL
      AND ws.repetitions IS NOT NULL
  `, [exerciseUuid, excludeWorkoutUuid]);

  let best = 0;
  for (const row of rows) {
    const orm = estimate1RM(parseFloat(row.weight), row.repetitions);
    if (orm > best) best = orm;
  }
  return { best1RM: best };
}

// ===== EXERCISE PROGRESS & PRs =====

export async function getExerciseProgress(exerciseUuid: string, since?: Date): Promise<Array<{
  date: string;
  maxWeight: number;
  totalVolume: number;
  estimated1RM: number;
}>> {
  const params: unknown[] = [exerciseUuid];
  const sinceClause = since ? `AND w.start_time >= $${params.push(since.toISOString())}` : '';

  const rows = await query<{
    date: string;
    max_weight: string;
    total_volume: string;
    max_reps_at_max_weight: number;
  }>(`
    WITH per_workout AS (
      SELECT
        w.uuid AS workout_uuid,
        w.start_time AS date,
        ws.weight,
        ws.repetitions,
        MAX(ws.weight) OVER (PARTITION BY w.uuid) AS workout_max_weight
      FROM workout_sets ws
      JOIN workout_exercises we ON ws.workout_exercise_uuid = we.uuid
      JOIN workouts w ON we.workout_uuid = w.uuid
      WHERE we.exercise_uuid IN (
          SELECT e2.uuid FROM exercises e1
          JOIN exercises e2 ON e2.title = e1.title
          WHERE e1.uuid = $1
        )
        AND ws.is_completed = true
        AND ws.weight IS NOT NULL
        AND ws.repetitions IS NOT NULL
        ${sinceClause}
    )
    SELECT
      date,
      MAX(weight) AS max_weight,
      SUM(weight * repetitions) AS total_volume,
      MAX(repetitions) FILTER (WHERE weight = workout_max_weight) AS max_reps_at_max_weight
    FROM per_workout
    GROUP BY workout_uuid, date
    ORDER BY date ASC
  `, params);

  return rows.map((row) => {
    const maxWeight = parseFloat(row.max_weight) || 0;
    const totalVolume = parseFloat(row.total_volume) || 0;
    const reps = row.max_reps_at_max_weight || 1;
    const estimated1RM = estimate1RM(maxWeight, reps);
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
    WHERE we.exercise_uuid IN (
        SELECT e2.uuid FROM exercises e1
        JOIN exercises e2 ON e2.title = e1.title
        WHERE e1.uuid = $1
      )
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

export async function getExerciseVolumeTrend(exerciseUuid: string, since?: Date): Promise<Array<{
  date: string;
  totalVolume: number;
}>> {
  const params: unknown[] = [exerciseUuid];
  const sinceClause = since ? `AND w.start_time >= $${params.push(since.toISOString())}` : '';

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
    WHERE we.exercise_uuid IN (
        SELECT e2.uuid FROM exercises e1
        JOIN exercises e2 ON e2.title = e1.title
        WHERE e1.uuid = $1
      )
      AND ws.is_completed = true
      AND ws.weight IS NOT NULL
      AND ws.repetitions IS NOT NULL
      ${sinceClause}
    GROUP BY w.uuid, w.start_time
    ORDER BY w.start_time ASC
  `, params);

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
    WHERE we.exercise_uuid IN (
        SELECT e2.uuid FROM exercises e1
        JOIN exercises e2 ON e2.title = e1.title
        WHERE e1.uuid = $1
      )
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

export async function getExercisePBPerSet(
  exerciseUuid: string,
): Promise<Array<{
  orderIndex: number;
  weight: number;
  repetitions: number;
}>> {
  const rows = await query<{
    order_index: number;
    weight: string;
    repetitions: number;
  }>(`
    SELECT DISTINCT ON (ws.order_index)
      ws.order_index,
      ws.weight,
      ws.repetitions
    FROM workout_sets ws
    JOIN workout_exercises we ON ws.workout_exercise_uuid = we.uuid
    WHERE we.exercise_uuid IN (
        SELECT e2.uuid FROM exercises e1
        JOIN exercises e2 ON e2.title = e1.title
        WHERE e1.uuid = $1
      )
      AND ws.is_completed = true
      AND ws.weight IS NOT NULL
      AND ws.repetitions IS NOT NULL
    ORDER BY ws.order_index, ws.weight DESC, ws.repetitions DESC
  `, [exerciseUuid]);

  return rows.map((row) => ({
    orderIndex: row.order_index,
    weight: parseFloat(row.weight),
    repetitions: row.repetitions,
  }));
}

// ===== WORKOUT PLANS =====

export async function listPlans(): Promise<WorkoutPlan[]> {
  const rows = await query<DbRow>('SELECT * FROM workout_plans ORDER BY order_index ASC, created_at ASC');
  return rows.map(parsePlan);
}

export async function getPlan(uuid: string): Promise<WorkoutPlan | undefined> {
  const row = await queryOne<DbRow>('SELECT * FROM workout_plans WHERE uuid = $1', [uuid]);
  return row ? parsePlan(row) : undefined;
}

export async function createPlan(title: string): Promise<WorkoutPlan> {
  const uuid = randomUUID();
  await query('INSERT INTO workout_plans (uuid, title) VALUES ($1, $2)', [uuid, title]);
  return (await getPlan(uuid))!;
}

export async function updatePlan(uuid: string, data: { title?: string; orderIndex?: number }): Promise<WorkoutPlan | undefined> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramCount = 0;

  if (data.title !== undefined) { fields.push(`title = $${++paramCount}`); values.push(data.title); }
  if (data.orderIndex !== undefined) { fields.push(`order_index = $${++paramCount}`); values.push(data.orderIndex); }

  if (fields.length > 0) {
    values.push(uuid);
    await query(`UPDATE workout_plans SET ${fields.join(', ')} WHERE uuid = $${++paramCount}`, values);
  }
  return getPlan(uuid);
}

export async function deletePlan(uuid: string): Promise<void> {
  await query('DELETE FROM workout_plans WHERE uuid = $1', [uuid]);
}

// ===== WORKOUT ROUTINES =====

export async function listRoutines(planUuid: string): Promise<WorkoutRoutine[]> {
  const rows = await query<DbRow>(
    'SELECT * FROM workout_routines WHERE workout_plan_uuid = $1 ORDER BY order_index ASC',
    [planUuid]
  );
  return rows.map(parseRoutine);
}

export async function getRoutine(uuid: string): Promise<WorkoutRoutine | undefined> {
  const row = await queryOne<DbRow>('SELECT * FROM workout_routines WHERE uuid = $1', [uuid]);
  return row ? parseRoutine(row) : undefined;
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

export async function updateRoutine(
  uuid: string,
  data: { title?: string; comment?: string; orderIndex?: number }
): Promise<WorkoutRoutine | undefined> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramCount = 0;

  if (data.title !== undefined) {
    fields.push(`title = $${++paramCount}`);
    values.push(data.title);
  }
  if (data.comment !== undefined) {
    fields.push(`comment = $${++paramCount}`);
    values.push(data.comment);
  }
  if (data.orderIndex !== undefined) {
    fields.push(`order_index = $${++paramCount}`);
    values.push(data.orderIndex);
  }

  if (fields.length > 0) {
    values.push(uuid);
    await query(`UPDATE workout_routines SET ${fields.join(', ')} WHERE uuid = $${++paramCount}`, values);
  }

  return getRoutine(uuid);
}

export async function deleteRoutine(uuid: string): Promise<void> {
  await query('DELETE FROM workout_routines WHERE uuid = $1', [uuid]);
}

// ===== WORKOUT ROUTINE EXERCISES =====

export async function listRoutineExercises(routineUuid: string): Promise<WorkoutRoutineExercise[]> {
  const rows = await query<DbRow>(
    `SELECT wre.*, e.title AS exercise_title
     FROM workout_routine_exercises wre
     LEFT JOIN exercises e ON e.uuid = wre.exercise_uuid
     WHERE wre.workout_routine_uuid = $1
     ORDER BY wre.order_index ASC`,
    [routineUuid]
  );
  return rows.map(parseRoutineExercise);
}

export async function getRoutineExercise(uuid: string): Promise<WorkoutRoutineExercise | undefined> {
  const row = await queryOne<DbRow>('SELECT * FROM workout_routine_exercises WHERE uuid = $1', [uuid]);
  return row ? parseRoutineExercise(row) : undefined;
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
  return (await getRoutineExercise(uuid))!;
}

export async function removeExerciseFromRoutine(uuid: string): Promise<void> {
  await query('DELETE FROM workout_routine_exercises WHERE uuid = $1', [uuid]);
}

export async function updateRoutineExercise(
  uuid: string,
  data: { comment?: string | null }
): Promise<WorkoutRoutineExercise | undefined> {
  if (data.comment !== undefined) {
    await query('UPDATE workout_routine_exercises SET comment = $1 WHERE uuid = $2', [data.comment, uuid]);
  }
  return getRoutineExercise(uuid);
}

// ===== WORKOUT ROUTINE SETS =====

export async function listRoutineSets(routineExerciseUuid: string): Promise<WorkoutRoutineSet[]> {
  const rows = await query<DbRow>(
    'SELECT * FROM workout_routine_sets WHERE workout_routine_exercise_uuid = $1 ORDER BY order_index ASC',
    [routineExerciseUuid]
  );
  return rows.map(parseRoutineSet);
}

export async function getRoutineSet(uuid: string): Promise<WorkoutRoutineSet | undefined> {
  const row = await queryOne<DbRow>('SELECT * FROM workout_routine_sets WHERE uuid = $1', [uuid]);
  return row ? parseRoutineSet(row) : undefined;
}

export async function addRoutineSet(
  routineExerciseUuid: string,
  data: { minRepetitions?: number; maxRepetitions?: number }
): Promise<WorkoutRoutineSet> {
  const uuid = randomUUID();
  const maxOrder = await queryOne<DbRow>(
    'SELECT MAX(order_index) as max FROM workout_routine_sets WHERE workout_routine_exercise_uuid = $1',
    [routineExerciseUuid]
  );
  const orderIndex = (Number(maxOrder?.max ?? -1)) + 1;
  await query(
    'INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index) VALUES ($1, $2, $3, $4, $5)',
    [uuid, routineExerciseUuid, data.minRepetitions ?? null, data.maxRepetitions ?? null, orderIndex]
  );
  return (await getRoutineSet(uuid))!;
}

// ===== REPEAT WORKOUT =====

export async function repeatWorkout(sourceUuid: string): Promise<Workout> {
  // Get source exercises ordered
  const sourceExercises = await query<DbRow>(`
    SELECT * FROM workout_exercises WHERE workout_uuid = $1 ORDER BY order_index
  `, [sourceUuid]);

  const workout = await startWorkout();

  for (const we of sourceExercises) {
    const weUuid = randomUUID();
    await query(
      'INSERT INTO workout_exercises (uuid, workout_uuid, exercise_uuid, order_index) VALUES ($1, $2, $3, $4)',
      [weUuid, workout.uuid, we.exercise_uuid, we.order_index]
    );

    // Get completed sets from source exercise, use weight/reps as targets
    const sourceSets = await query<DbRow>(`
      SELECT * FROM workout_sets WHERE workout_exercise_uuid = $1 AND is_completed = true ORDER BY order_index
    `, [we.uuid as string]);

    const setCount = sourceSets.length > 0 ? sourceSets.length : 3;
    for (let i = 0; i < setCount; i++) {
      const src = sourceSets[i];
      await query(
        'INSERT INTO workout_sets (uuid, workout_exercise_uuid, weight, repetitions, order_index, is_completed) VALUES ($1, $2, $3, $4, $5, false)',
        [
          randomUUID(),
          weUuid,
          src ? src.weight : null,
          src ? src.repetitions : null,
          i,
        ]
      );
    }
  }

  return workout;
}

// ===== EXPORT =====

export async function exportWorkouts(): Promise<Array<{
  uuid: string;
  start_time: string;
  end_time: string | null;
  title: string | null;
  comment: string | null;
  exercises: Array<{
    uuid: string;
    exercise_uuid: string;
    exercise_title: string;
    tracking_mode: 'reps' | 'time';
    order_index: number;
    sets: Array<{
      uuid: string;
      order_index: number;
      weight: number | null;
      repetitions: number | null;
      duration_seconds: number | null;
      rpe: number | null;
      tag: string | null;
      is_completed: boolean;
    }>;
  }>;
}>> {
  const workoutRows = await query<DbRow>(`
    SELECT uuid, start_time, end_time, title, comment
    FROM workouts
    WHERE is_current = false AND end_time IS NOT NULL
    ORDER BY start_time DESC
  `);

  const results = [];
  for (const w of workoutRows) {
    const exerciseRows = await query<DbRow>(`
      SELECT we.uuid, we.exercise_uuid, we.order_index, e.title as exercise_title, e.tracking_mode
      FROM workout_exercises we
      JOIN exercises e ON we.exercise_uuid = e.uuid
      WHERE we.workout_uuid = $1
      ORDER BY we.order_index
    `, [w.uuid as string]);

    const exercises = [];
    for (const we of exerciseRows) {
      const setRows = await query<DbRow>(`
        SELECT uuid, order_index, weight, repetitions, duration_seconds, rpe, tag, is_completed
        FROM workout_sets WHERE workout_exercise_uuid = $1 ORDER BY order_index
      `, [we.uuid as string]);

      exercises.push({
        uuid: we.uuid as string,
        exercise_uuid: we.exercise_uuid as string,
        exercise_title: we.exercise_title as string,
        tracking_mode: (we.tracking_mode === 'time' ? 'time' : 'reps') as 'reps' | 'time',
        order_index: we.order_index as number,
        sets: setRows.map(s => ({
          uuid: s.uuid as string,
          order_index: s.order_index as number,
          weight: s.weight ? parseFloat(s.weight as string) : null,
          repetitions: s.repetitions as number | null,
          duration_seconds: (s.duration_seconds as number | null) ?? null,
          rpe: s.rpe ? parseFloat(s.rpe as string) : null,
          tag: s.tag as string | null,
          is_completed: Boolean(s.is_completed),
        })),
      });
    }

    results.push({
      uuid: w.uuid as string,
      start_time: w.start_time as string,
      end_time: w.end_time as string | null,
      title: w.title as string | null,
      comment: w.comment as string | null,
      exercises,
    });
  }

  return results;
}

// ===== START WORKOUT FROM ROUTINE =====

export interface StartWorkoutResult {
  workout: Workout;
  workout_exercises: WorkoutExercise[];
  workout_sets: WorkoutSet[];
}

export async function startWorkoutFromRoutine(routineUuid: string): Promise<StartWorkoutResult> {
  // Create the workout linked to this routine
  const workout = await startWorkout(routineUuid);

  const allExercises: WorkoutExercise[] = [];
  const allSets: WorkoutSet[] = [];

  // Get all exercises in the routine
  const routineExercises = await listRoutineExercises(routineUuid);

  for (const routineExercise of routineExercises) {
    const weUuid = randomUUID();
    await query(
      'INSERT INTO workout_exercises (uuid, workout_uuid, exercise_uuid, comment, order_index) VALUES ($1, $2, $3, $4, $5)',
      [weUuid, workout.uuid, routineExercise.exercise_uuid, routineExercise.comment ?? null, routineExercise.order_index]
    );
    allExercises.push({
      uuid: weUuid,
      workout_uuid: workout.uuid,
      exercise_uuid: routineExercise.exercise_uuid,
      comment: routineExercise.comment ?? null,
      order_index: routineExercise.order_index,
    });

    // Get sets defined for this routine exercise
    const routineSets = await listRoutineSets(routineExercise.uuid);

    if (routineSets.length > 0) {
      for (const routineSet of routineSets) {
        const setUuid = randomUUID();
        await query(
          'INSERT INTO workout_sets (uuid, workout_exercise_uuid, min_target_reps, max_target_reps, tag, comment, order_index, is_completed) VALUES ($1, $2, $3, $4, $5, $6, $7, false)',
          [setUuid, weUuid, routineSet.min_repetitions, routineSet.max_repetitions, routineSet.tag, routineSet.comment, routineSet.order_index]
        );
        allSets.push({
          uuid: setUuid,
          workout_exercise_uuid: weUuid,
          weight: null,
          repetitions: null,
          min_target_reps: routineSet.min_repetitions ?? null,
          max_target_reps: routineSet.max_repetitions ?? null,
          rpe: null,
          tag: routineSet.tag ?? null,
          comment: routineSet.comment ?? null,
          is_completed: false,
          is_pr: false,
          order_index: routineSet.order_index,
        });
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const setUuid = randomUUID();
        await query(
          'INSERT INTO workout_sets (uuid, workout_exercise_uuid, order_index, is_completed) VALUES ($1, $2, $3, false)',
          [setUuid, weUuid, i]
        );
        allSets.push({
          uuid: setUuid,
          workout_exercise_uuid: weUuid,
          weight: null,
          repetitions: null,
          min_target_reps: null,
          max_target_reps: null,
          rpe: null,
          tag: null,
          comment: null,
          is_completed: false,
          is_pr: false,
          order_index: i,
        });
      }
    }
  }

  return { workout, workout_exercises: allExercises, workout_sets: allSets };
}

// ===== SUMMARY STATS =====

export async function getWeekWorkouts(): Promise<{ uuid: string; start_time: string; end_time: string }[]> {
  const rows = await query<DbRow>(`
    SELECT uuid, start_time, end_time FROM workouts
    WHERE start_time >= date_trunc('week', CURRENT_DATE)
    AND end_time IS NOT NULL
    AND is_current = false
    ORDER BY start_time DESC
  `);
  return rows as { uuid: string; start_time: string; end_time: string }[];
}

export async function getWeekVolume(): Promise<number> {
  const row = await queryOne<DbRow>(`
    SELECT COALESCE(SUM(ws.weight * ws.repetitions), 0) as total_volume
    FROM workout_sets ws
    JOIN workout_exercises we ON ws.workout_exercise_uuid = we.uuid
    JOIN workouts w ON we.workout_uuid = w.uuid
    WHERE w.start_time >= date_trunc('week', CURRENT_DATE)
    AND w.end_time IS NOT NULL AND ws.is_completed = true
  `);
  return row ? Number(row.total_volume) : 0;
}

export async function getWorkoutStreak(): Promise<{ week_start: string }[]> {
  const rows = await query<DbRow>(`
    WITH weekly AS (
      SELECT DISTINCT date_trunc('week', start_time)::date as week_start
      FROM workouts WHERE end_time IS NOT NULL AND is_current = false
    )
    SELECT week_start FROM weekly ORDER BY week_start DESC
  `);
  return rows as { week_start: string }[];
}

export async function getWeekMuscleFrequency(): Promise<{ primary_muscles: string[] | string }[]> {
  const rows = await query<DbRow>(`
    SELECT e.primary_muscles
    FROM workout_exercises we
    JOIN exercises e ON we.exercise_uuid = e.uuid
    JOIN workouts w ON we.workout_uuid = w.uuid
    WHERE w.start_time >= date_trunc('week', CURRENT_DATE)
    AND w.end_time IS NOT NULL
  `);
  return rows as { primary_muscles: string[] | string }[];
}

export async function getLastWorkoutsWithDetails(limit: number = 3): Promise<{
  uuid: string;
  start_time: string;
  end_time: string | null;
  title: string | null;
  exercises: string[];
  volume: number;
}[]> {
  const workoutRows = await query<DbRow>(`
    SELECT uuid, start_time, end_time, title
    FROM workouts
    WHERE is_current = false AND end_time IS NOT NULL
    ORDER BY start_time DESC
    LIMIT $1
  `, [limit]);

  const results = [];
  for (const w of workoutRows) {
    const uuid = w.uuid as string;

    const exerciseRows = await query<DbRow>(`
      SELECT e.title
      FROM workout_exercises we
      JOIN exercises e ON we.exercise_uuid = e.uuid
      WHERE we.workout_uuid = $1
      ORDER BY we.order_index
    `, [uuid]);

    const volumeRow = await queryOne<DbRow>(`
      SELECT COALESCE(SUM(ws.weight * ws.repetitions), 0) as total_volume
      FROM workout_sets ws
      JOIN workout_exercises we ON ws.workout_exercise_uuid = we.uuid
      WHERE we.workout_uuid = $1 AND ws.is_completed = true
    `, [uuid]);

    results.push({
      uuid,
      start_time: w.start_time as string,
      end_time: w.end_time as string | null,
      title: w.title as string | null,
      exercises: exerciseRows.map(r => r.title as string),
      volume: volumeRow ? Number(volumeRow.total_volume) : 0,
    });
  }

  return results;
}

// ===== HELPERS =====

export function parseExercise(row: DbRow): Exercise {
  return {
    uuid: (row.uuid as string).toLowerCase(),
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
    movement_pattern: (row.movement_pattern as string | null) ?? null,
    tracking_mode: (row.tracking_mode === 'time' ? 'time' : 'reps') as 'reps' | 'time',
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
    is_pr: Boolean(row.is_pr),
    order_index: row.order_index as number,
    duration_seconds: (row.duration_seconds as number | null) ?? null,
  };
}

export function parsePlan(row: DbRow): WorkoutPlan {
  return {
    uuid: row.uuid as string,
    title: row.title as string | null,
    order_index: (row.order_index as number) ?? 0,
    is_active: Boolean(row.is_active),
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
    exercise_title: (row.exercise_title as string) ?? undefined,
    comment: row.comment as string | null,
    order_index: row.order_index as number,
  };
}

export function parseRoutineSet(row: DbRow): WorkoutRoutineSet {
  return {
    uuid: row.uuid as string,
    workout_routine_exercise_uuid: row.workout_routine_exercise_uuid as string,
    min_repetitions: row.min_repetitions as number | null,
    max_repetitions: row.max_repetitions as number | null,
    tag: row.tag as 'dropSet' | null,
    comment: row.comment as string | null,
    order_index: row.order_index as number,
    target_duration_seconds: (row.target_duration_seconds as number | null) ?? null,
  };
}

// ===== BODYWEIGHT =====

export function parseBodyweightLog(row: DbRow): BodyweightLog {
  return {
    uuid: row.uuid as string,
    weight_kg: parseFloat(row.weight_kg as string),
    logged_at: row.logged_at as string,
    note: row.note as string | null,
    dedupe_key: (row.dedupe_key as string) ?? null,
  };
}

/** Manual log (no import dedupe). */
export async function createBodyweightLog(data: {
  weight_kg: number;
  note?: string | null;
  logged_at?: string;
}): Promise<BodyweightLog> {
  const uuid = randomUUID();
  const row = await queryOne(
    `INSERT INTO bodyweight_logs (uuid, weight_kg, note, logged_at)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW())) RETURNING *`,
    [uuid, data.weight_kg, data.note ?? null, data.logged_at ?? null],
  );
  return parseBodyweightLog(row!);
}

export async function logBodyweight(weight_kg: number, note?: string): Promise<BodyweightLog> {
  return createBodyweightLog({ weight_kg, note, logged_at: new Date().toISOString() });
}

export async function listBodyweightLogs(limit = 90): Promise<BodyweightLog[]> {
  const rows = await query(
    `SELECT * FROM bodyweight_logs ORDER BY logged_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(parseBodyweightLog);
}

export async function getLatestBodyweight(): Promise<BodyweightLog | null> {
  const row = await queryOne(
    `SELECT * FROM bodyweight_logs ORDER BY logged_at DESC LIMIT 1`,
    [],
  );
  return row ? parseBodyweightLog(row) : null;
}

export async function deleteBodyweightLog(uuid: string): Promise<void> {
  await query(`DELETE FROM bodyweight_logs WHERE uuid = $1`, [uuid]);
}

// ===== BODY SPEC (Module 2) =====

function parseBodySpecLog(row: DbRow): BodySpecLog {
  return {
    uuid: row.uuid as string,
    height_cm: row.height_cm != null ? parseFloat(row.height_cm as string) : null,
    weight_kg: row.weight_kg != null ? parseFloat(row.weight_kg as string) : null,
    body_fat_pct: row.body_fat_pct != null ? parseFloat(row.body_fat_pct as string) : null,
    lean_mass_kg: row.lean_mass_kg != null ? parseFloat(row.lean_mass_kg as string) : null,
    notes: row.notes as string | null,
    measured_at: row.measured_at as string,
  };
}

export async function createBodySpecLog(data: Omit<BodySpecLog, 'uuid' | 'measured_at'> & { measured_at?: string }): Promise<BodySpecLog> {
  const uuid = randomUUID();
  const row = await queryOne(
    `INSERT INTO body_spec_logs (uuid, height_cm, weight_kg, body_fat_pct, lean_mass_kg, notes, measured_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::TIMESTAMP, NOW())) RETURNING *`,
    [uuid, data.height_cm ?? null, data.weight_kg ?? null, data.body_fat_pct ?? null, data.lean_mass_kg ?? null, data.notes ?? null, data.measured_at ?? null],
  );
  return parseBodySpecLog(row!);
}

export async function listBodySpecLogs(limit = 90): Promise<BodySpecLog[]> {
  const rows = await query(`SELECT * FROM body_spec_logs ORDER BY measured_at DESC LIMIT $1`, [limit]);
  return rows.map(parseBodySpecLog);
}

export async function getBodySpecLog(uuid: string): Promise<BodySpecLog | null> {
  const row = await queryOne(`SELECT * FROM body_spec_logs WHERE uuid = $1`, [uuid]);
  return row ? parseBodySpecLog(row) : null;
}

export async function updateBodySpecLog(uuid: string, data: Partial<Omit<BodySpecLog, 'uuid'>>): Promise<BodySpecLog | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(data)) {
    fields.push(`${key} = $${i++}`);
    params.push(val);
  }
  if (fields.length === 0) return getBodySpecLog(uuid);
  params.push(uuid);
  const row = await queryOne(
    `UPDATE body_spec_logs SET ${fields.join(', ')} WHERE uuid = $${i} RETURNING *`,
    params,
  );
  return row ? parseBodySpecLog(row) : null;
}

export async function deleteBodySpecLog(uuid: string): Promise<void> {
  await query(`DELETE FROM body_spec_logs WHERE uuid = $1`, [uuid]);
}

// ===== MEASUREMENTS (Module 3) =====

function parseMeasurementLog(row: DbRow): MeasurementLog {
  return {
    uuid: row.uuid as string,
    site: row.site as string,
    value_cm: parseFloat(row.value_cm as string),
    notes: row.notes as string | null,
    measured_at: row.measured_at as string,
    source: (row.source as string) ?? null,
    source_ref: (row.source_ref as string) ?? null,
  };
}

export async function createMeasurementLog(
  data: Omit<MeasurementLog, 'uuid' | 'measured_at' | 'source' | 'source_ref'>
    & { measured_at?: string; source?: string | null; source_ref?: string | null }
): Promise<MeasurementLog> {
  const uuid = randomUUID();
  const row = await queryOne(
    `INSERT INTO measurement_logs (uuid, site, value_cm, notes, measured_at, source, source_ref)
     VALUES ($1, $2, $3, $4, COALESCE($5::TIMESTAMP, NOW()), $6, $7) RETURNING *`,
    [uuid, data.site, data.value_cm, data.notes ?? null, data.measured_at ?? null, data.source ?? null, data.source_ref ?? null],
  );
  return parseMeasurementLog(row!);
}

export async function listMeasurementLogs(options: { limit?: number; site?: string } = {}): Promise<MeasurementLog[]> {
  const { limit = 90, site } = options;
  if (site) {
    const rows = await query(
      `SELECT * FROM measurement_logs WHERE site = $1 ORDER BY measured_at DESC LIMIT $2`,
      [site, limit],
    );
    return rows.map(parseMeasurementLog);
  }
  const rows = await query(`SELECT * FROM measurement_logs ORDER BY measured_at DESC LIMIT $1`, [limit]);
  return rows.map(parseMeasurementLog);
}

export async function getMeasurementLog(uuid: string): Promise<MeasurementLog | null> {
  const row = await queryOne(`SELECT * FROM measurement_logs WHERE uuid = $1`, [uuid]);
  return row ? parseMeasurementLog(row) : null;
}

export async function updateMeasurementLog(uuid: string, data: Partial<Omit<MeasurementLog, 'uuid'>>): Promise<MeasurementLog | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(data)) {
    fields.push(`${key} = $${i++}`);
    params.push(val);
  }
  if (fields.length === 0) return getMeasurementLog(uuid);
  params.push(uuid);
  const row = await queryOne(
    `UPDATE measurement_logs SET ${fields.join(', ')} WHERE uuid = $${i} RETURNING *`,
    params,
  );
  return row ? parseMeasurementLog(row) : null;
}

export async function deleteMeasurementLog(uuid: string): Promise<void> {
  await query(`DELETE FROM measurement_logs WHERE uuid = $1`, [uuid]);
}

// ===== NUTRITION (Module 4) =====

function parseNutritionLog(row: DbRow): NutritionLog {
  return {
    uuid: row.uuid as string,
    logged_at: row.logged_at as string,
    meal_type: row.meal_type as NutritionLog['meal_type'],
    calories: row.calories != null ? parseFloat(row.calories as string) : null,
    protein_g: row.protein_g != null ? parseFloat(row.protein_g as string) : null,
    carbs_g: row.carbs_g != null ? parseFloat(row.carbs_g as string) : null,
    fat_g: row.fat_g != null ? parseFloat(row.fat_g as string) : null,
    notes: row.notes as string | null,
    meal_name: row.meal_name as string | null,
    template_meal_id: row.template_meal_id as string | null,
    status: row.status as NutritionLog['status'],
    external_ref: (row.external_ref as string) ?? null,
  };
}

export async function createNutritionLog(
  data: Omit<NutritionLog, 'uuid' | 'logged_at'> & { logged_at?: string },
): Promise<NutritionLog> {
  const uuid = randomUUID();
  const row = await queryOne(
    `INSERT INTO nutrition_logs (uuid, logged_at, meal_type, calories, protein_g, carbs_g, fat_g, notes, meal_name, template_meal_id, status, external_ref)
     VALUES ($1, COALESCE($2::TIMESTAMP, NOW()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      uuid,
      data.logged_at ?? null,
      data.meal_type ?? null,
      data.calories ?? null,
      data.protein_g ?? null,
      data.carbs_g ?? null,
      data.fat_g ?? null,
      data.notes ?? null,
      data.meal_name ?? null,
      data.template_meal_id ?? null,
      data.status ?? null,
      data.external_ref ?? null,
    ],
  );
  return parseNutritionLog(row!);
}

export async function listNutritionLogs(options: { limit?: number; from?: string; to?: string } = {}): Promise<NutritionLog[]> {
  const { limit = 90, from, to } = options;
  const params: unknown[] = [];
  let sql = 'SELECT * FROM nutrition_logs WHERE 1=1';
  if (from) { sql += ` AND logged_at >= $${params.length + 1}`; params.push(from); }
  if (to) { sql += ` AND logged_at <= $${params.length + 1}`; params.push(to); }
  sql += ` ORDER BY logged_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  const rows = await query(sql, params);
  return rows.map(parseNutritionLog);
}

export async function getNutritionLog(uuid: string): Promise<NutritionLog | null> {
  const row = await queryOne(`SELECT * FROM nutrition_logs WHERE uuid = $1`, [uuid]);
  return row ? parseNutritionLog(row) : null;
}

export async function updateNutritionLog(uuid: string, data: Partial<Omit<NutritionLog, 'uuid'>>): Promise<NutritionLog | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(data)) {
    fields.push(`${key} = $${i++}`);
    params.push(val);
  }
  if (fields.length === 0) return getNutritionLog(uuid);
  params.push(uuid);
  const row = await queryOne(
    `UPDATE nutrition_logs SET ${fields.join(', ')} WHERE uuid = $${i} RETURNING *`,
    params,
  );
  return row ? parseNutritionLog(row) : null;
}

export async function deleteNutritionLog(uuid: string): Promise<void> {
  await query(`DELETE FROM nutrition_logs WHERE uuid = $1`, [uuid]);
}

// ===== NUTRITION WEEK MEALS =====

function parseNutritionWeekMeal(row: DbRow): NutritionWeekMeal {
  return {
    uuid: row.uuid as string,
    day_of_week: row.day_of_week as number,
    meal_slot: row.meal_slot as string,
    meal_name: row.meal_name as string,
    protein_g: row.protein_g != null ? parseFloat(row.protein_g as string) : null,
    calories: row.calories != null ? parseFloat(row.calories as string) : null,
    quality_rating: row.quality_rating != null ? parseInt(row.quality_rating as string, 10) : null,
    sort_order: row.sort_order as number,
  };
}

export async function createNutritionWeekMeal(data: Omit<NutritionWeekMeal, 'uuid'>): Promise<NutritionWeekMeal> {
  const uuid = randomUUID();
  const row = await queryOne(
    `INSERT INTO nutrition_week_meals (uuid, day_of_week, meal_slot, meal_name, protein_g, calories, quality_rating, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [uuid, data.day_of_week, data.meal_slot, data.meal_name, data.protein_g ?? null, data.calories ?? null, data.quality_rating ?? null, data.sort_order ?? 0],
  );
  return parseNutritionWeekMeal(row!);
}

export async function listNutritionWeekMeals(day_of_week?: number): Promise<NutritionWeekMeal[]> {
  if (day_of_week != null) {
    const rows = await query(`SELECT * FROM nutrition_week_meals WHERE day_of_week = $1 ORDER BY sort_order ASC, created_at ASC`, [day_of_week]);
    return rows.map(parseNutritionWeekMeal);
  }
  const rows = await query(`SELECT * FROM nutrition_week_meals ORDER BY day_of_week ASC, sort_order ASC, created_at ASC`, []);
  return rows.map(parseNutritionWeekMeal);
}

export async function updateNutritionWeekMeal(uuid: string, data: Partial<Omit<NutritionWeekMeal, 'uuid'>>): Promise<NutritionWeekMeal | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(data)) {
    fields.push(`${key} = $${i++}`);
    params.push(val);
  }
  if (fields.length === 0) {
    const row = await queryOne(`SELECT * FROM nutrition_week_meals WHERE uuid = $1`, [uuid]);
    return row ? parseNutritionWeekMeal(row) : null;
  }
  params.push(uuid);
  const row = await queryOne(
    `UPDATE nutrition_week_meals SET ${fields.join(', ')} WHERE uuid = $${i} RETURNING *`,
    params,
  );
  return row ? parseNutritionWeekMeal(row) : null;
}

export async function deleteNutritionWeekMeal(uuid: string): Promise<void> {
  await query(`DELETE FROM nutrition_week_meals WHERE uuid = $1`, [uuid]);
}

// ===== NUTRITION DAY NOTES =====

function parseNutritionDayNote(row: DbRow): NutritionDayNote {
  return {
    uuid: row.uuid as string,
    date: row.date as string,
    hydration_ml: row.hydration_ml != null ? parseInt(row.hydration_ml as string, 10) : null,
    notes: row.notes as string | null,
    updated_at: row.updated_at as string,
  };
}

export async function getNutritionDayNote(date: string): Promise<NutritionDayNote | null> {
  const row = await queryOne(`SELECT * FROM nutrition_day_notes WHERE date = $1`, [date]);
  return row ? parseNutritionDayNote(row) : null;
}

export async function upsertNutritionDayNote(date: string, data: { hydration_ml?: number | null; notes?: string | null }): Promise<NutritionDayNote> {
  const uuid = randomUUID();
  const row = await queryOne(
    `INSERT INTO nutrition_day_notes (uuid, date, hydration_ml, notes, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (date) DO UPDATE SET
       hydration_ml = COALESCE(EXCLUDED.hydration_ml, nutrition_day_notes.hydration_ml),
       notes = COALESCE(EXCLUDED.notes, nutrition_day_notes.notes),
       updated_at = NOW()
     RETURNING *`,
    [uuid, date, data.hydration_ml ?? null, data.notes ?? null],
  );
  return parseNutritionDayNote(row!);
}

// ===== HRT (Module 5) =====

function parseHrtLog(row: DbRow): HrtLog {
  return {
    uuid: row.uuid as string,
    logged_at: row.logged_at as string,
    medication: row.medication as string,
    dose_mg: row.dose_mg != null ? parseFloat(row.dose_mg as string) : null,
    route: row.route as HrtLog['route'],
    notes: row.notes as string | null,
    taken: row.taken === true || row.taken === 't',
    protocol_uuid: row.protocol_uuid as string | null,
  };
}

export async function createHrtLog(data: Omit<HrtLog, 'uuid' | 'logged_at'> & { logged_at?: string }): Promise<HrtLog> {
  const uuid = randomUUID();
  const row = await queryOne(
    `INSERT INTO hrt_logs (uuid, logged_at, medication, dose_mg, route, notes, taken, protocol_uuid)
     VALUES ($1, COALESCE($2::TIMESTAMP, NOW()), $3, $4, $5, $6, $7, $8) RETURNING *`,
    [uuid, data.logged_at ?? null, data.medication, data.dose_mg ?? null, data.route ?? null, data.notes ?? null, data.taken ?? false, data.protocol_uuid ?? null],
  );
  return parseHrtLog(row!);
}

export async function listHrtLogs(limit = 90): Promise<HrtLog[]> {
  const rows = await query(`SELECT * FROM hrt_logs ORDER BY logged_at DESC LIMIT $1`, [limit]);
  return rows.map(parseHrtLog);
}

export async function getHrtLog(uuid: string): Promise<HrtLog | null> {
  const row = await queryOne(`SELECT * FROM hrt_logs WHERE uuid = $1`, [uuid]);
  return row ? parseHrtLog(row) : null;
}

export async function updateHrtLog(uuid: string, data: Partial<Omit<HrtLog, 'uuid'>>): Promise<HrtLog | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(data)) {
    fields.push(`${key} = $${i++}`);
    params.push(val);
  }
  if (fields.length === 0) return getHrtLog(uuid);
  params.push(uuid);
  const row = await queryOne(
    `UPDATE hrt_logs SET ${fields.join(', ')} WHERE uuid = $${i} RETURNING *`,
    params,
  );
  return row ? parseHrtLog(row) : null;
}

export async function deleteHrtLog(uuid: string): Promise<void> {
  await query(`DELETE FROM hrt_logs WHERE uuid = $1`, [uuid]);
}

// ===== HRT PROTOCOLS =====

function parseHrtProtocol(row: DbRow): HrtProtocol {
  return {
    uuid: row.uuid as string,
    medication: row.medication as string,
    dose_description: row.dose_description as string,
    form: row.form as HrtProtocol['form'],
    started_at: row.started_at as string,
    ended_at: row.ended_at as string | null,
    includes_blocker: row.includes_blocker === true || row.includes_blocker === 't',
    blocker_name: row.blocker_name as string | null,
    notes: row.notes as string | null,
    created_at: row.created_at as string,
  };
}

export async function createHrtProtocol(data: Omit<HrtProtocol, 'uuid' | 'created_at'>): Promise<HrtProtocol> {
  const uuid = randomUUID();
  const row = await queryOne(
    `INSERT INTO hrt_protocols (uuid, medication, dose_description, form, started_at, ended_at, includes_blocker, blocker_name, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [uuid, data.medication, data.dose_description, data.form, data.started_at, data.ended_at ?? null, data.includes_blocker ?? false, data.blocker_name ?? null, data.notes ?? null],
  );
  return parseHrtProtocol(row!);
}

export async function listHrtProtocols(): Promise<HrtProtocol[]> {
  const rows = await query(`SELECT * FROM hrt_protocols ORDER BY started_at DESC`);
  return rows.map(parseHrtProtocol);
}

export async function getHrtProtocol(uuid: string): Promise<HrtProtocol | null> {
  const row = await queryOne(`SELECT * FROM hrt_protocols WHERE uuid = $1`, [uuid]);
  return row ? parseHrtProtocol(row) : null;
}

export async function updateHrtProtocol(uuid: string, data: Partial<Omit<HrtProtocol, 'uuid' | 'created_at'>>): Promise<HrtProtocol | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(data)) {
    fields.push(`${key} = $${i++}`);
    params.push(val);
  }
  if (fields.length === 0) return getHrtProtocol(uuid);
  params.push(uuid);
  const row = await queryOne(
    `UPDATE hrt_protocols SET ${fields.join(', ')} WHERE uuid = $${i} RETURNING *`,
    params,
  );
  return row ? parseHrtProtocol(row) : null;
}

export async function deleteHrtProtocol(uuid: string): Promise<void> {
  await query(`DELETE FROM hrt_protocols WHERE uuid = $1`, [uuid]);
}

// ===== WELLBEING (Module 6) =====

function parseWellbeingLog(row: DbRow): WellbeingLog {
  return {
    uuid: row.uuid as string,
    logged_at: row.logged_at as string,
    mood: row.mood != null ? parseInt(row.mood as string, 10) : null,
    energy: row.energy != null ? parseInt(row.energy as string, 10) : null,
    sleep_hours: row.sleep_hours != null ? parseFloat(row.sleep_hours as string) : null,
    sleep_quality: row.sleep_quality != null ? parseInt(row.sleep_quality as string, 10) : null,
    stress: row.stress != null ? parseInt(row.stress as string, 10) : null,
    notes: row.notes as string | null,
  };
}

export async function createWellbeingLog(data: Omit<WellbeingLog, 'uuid' | 'logged_at'> & { logged_at?: string }): Promise<WellbeingLog> {
  const uuid = randomUUID();
  const row = await queryOne(
    `INSERT INTO wellbeing_logs (uuid, logged_at, mood, energy, sleep_hours, sleep_quality, stress, notes)
     VALUES ($1, COALESCE($2::TIMESTAMP, NOW()), $3, $4, $5, $6, $7, $8) RETURNING *`,
    [uuid, data.logged_at ?? null, data.mood ?? null, data.energy ?? null, data.sleep_hours ?? null, data.sleep_quality ?? null, data.stress ?? null, data.notes ?? null],
  );
  return parseWellbeingLog(row!);
}

export async function listWellbeingLogs(limit = 90): Promise<WellbeingLog[]> {
  const rows = await query(`SELECT * FROM wellbeing_logs ORDER BY logged_at DESC LIMIT $1`, [limit]);
  return rows.map(parseWellbeingLog);
}

export async function getWellbeingLog(uuid: string): Promise<WellbeingLog | null> {
  const row = await queryOne(`SELECT * FROM wellbeing_logs WHERE uuid = $1`, [uuid]);
  return row ? parseWellbeingLog(row) : null;
}

export async function updateWellbeingLog(uuid: string, data: Partial<Omit<WellbeingLog, 'uuid'>>): Promise<WellbeingLog | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(data)) {
    fields.push(`${key} = $${i++}`);
    params.push(val);
  }
  if (fields.length === 0) return getWellbeingLog(uuid);
  params.push(uuid);
  const row = await queryOne(
    `UPDATE wellbeing_logs SET ${fields.join(', ')} WHERE uuid = $${i} RETURNING *`,
    params,
  );
  return row ? parseWellbeingLog(row) : null;
}

export async function deleteWellbeingLog(uuid: string): Promise<void> {
  await query(`DELETE FROM wellbeing_logs WHERE uuid = $1`, [uuid]);
}

// ===== MOTIVATION CORRELATION =====

export interface MotivationCorrelation {
  avg_mood: number | null;
  avg_energy: number | null;
  workout_count: number;
  date_from: string;
  date_to: string;
}

export async function getMotivationCorrelation(days = 30): Promise<MotivationCorrelation> {
  const [wellbeingRow, workoutRow] = await Promise.all([
    queryOne<DbRow>(
      `SELECT AVG(mood) as avg_mood, AVG(energy) as avg_energy
       FROM wellbeing_logs
       WHERE logged_at >= NOW() - INTERVAL '${days} days'`,
      [],
    ),
    queryOne<DbRow>(
      `SELECT COUNT(*) as workout_count
       FROM workouts
       WHERE is_current = false AND start_time >= NOW() - INTERVAL '${days} days'`,
      [],
    ),
  ]);
  const dateFrom = new Date(Date.now() - days * 86400000).toISOString();
  const dateTo = new Date().toISOString();
  return {
    avg_mood: wellbeingRow?.avg_mood != null ? parseFloat(wellbeingRow.avg_mood as string) : null,
    avg_energy: wellbeingRow?.avg_energy != null ? parseFloat(wellbeingRow.avg_energy as string) : null,
    workout_count: workoutRow?.workout_count != null ? parseInt(workoutRow.workout_count as string, 10) : 0,
    date_from: dateFrom,
    date_to: dateTo,
  };
}

// ===== DYSPHORIA JOURNAL (Module 10) =====

function parseDysphoriaLog(row: DbRow): DysphoriaLog {
  return {
    uuid: row.uuid as string,
    logged_at: row.logged_at as string,
    scale: parseInt(row.scale as string, 10),
    note: row.note as string | null,
  };
}

export async function createDysphoriaLog(data: Omit<DysphoriaLog, 'uuid' | 'logged_at'> & { logged_at?: string }): Promise<DysphoriaLog> {
  const uuid = randomUUID();
  const row = await queryOne(
    `INSERT INTO dysphoria_logs (uuid, logged_at, scale, note)
     VALUES ($1, COALESCE($2::TIMESTAMP, NOW()), $3, $4) RETURNING *`,
    [uuid, data.logged_at ?? null, data.scale, data.note ?? null],
  );
  return parseDysphoriaLog(row!);
}

export async function listDysphoriaLogs(limit = 90): Promise<DysphoriaLog[]> {
  const rows = await query(`SELECT * FROM dysphoria_logs ORDER BY logged_at DESC LIMIT $1`, [limit]);
  return rows.map(parseDysphoriaLog);
}

export async function getDysphoriaLog(uuid: string): Promise<DysphoriaLog | null> {
  const row = await queryOne(`SELECT * FROM dysphoria_logs WHERE uuid = $1`, [uuid]);
  return row ? parseDysphoriaLog(row) : null;
}

export async function updateDysphoriaLog(uuid: string, data: Partial<Omit<DysphoriaLog, 'uuid'>>): Promise<DysphoriaLog | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(data)) {
    fields.push(`${key} = $${i++}`);
    params.push(val);
  }
  if (fields.length === 0) return getDysphoriaLog(uuid);
  params.push(uuid);
  const row = await queryOne(
    `UPDATE dysphoria_logs SET ${fields.join(', ')} WHERE uuid = $${i} RETURNING *`,
    params,
  );
  return row ? parseDysphoriaLog(row) : null;
}

export async function deleteDysphoriaLog(uuid: string): Promise<void> {
  await query(`DELETE FROM dysphoria_logs WHERE uuid = $1`, [uuid]);
}

// ===== CLOTHES TEST LOG (Module 10) =====

function parseClothesTestLog(row: DbRow): ClothesTestLog {
  return {
    uuid: row.uuid as string,
    logged_at: row.logged_at as string,
    outfit_description: row.outfit_description as string,
    photo_url: row.photo_url as string | null,
    comfort_rating: row.comfort_rating != null ? parseInt(row.comfort_rating as string, 10) : null,
    euphoria_rating: row.euphoria_rating != null ? parseInt(row.euphoria_rating as string, 10) : null,
    notes: row.notes as string | null,
  };
}

export async function createClothesTestLog(data: Omit<ClothesTestLog, 'uuid' | 'logged_at'> & { logged_at?: string }): Promise<ClothesTestLog> {
  const uuid = randomUUID();
  const row = await queryOne(
    `INSERT INTO clothes_test_logs (uuid, logged_at, outfit_description, photo_url, comfort_rating, euphoria_rating, notes)
     VALUES ($1, COALESCE($2::TIMESTAMP, NOW()), $3, $4, $5, $6, $7) RETURNING *`,
    [uuid, data.logged_at ?? null, data.outfit_description, data.photo_url ?? null, data.comfort_rating ?? null, data.euphoria_rating ?? null, data.notes ?? null],
  );
  return parseClothesTestLog(row!);
}

export async function listClothesTestLogs(limit = 50): Promise<ClothesTestLog[]> {
  const rows = await query(`SELECT * FROM clothes_test_logs ORDER BY logged_at DESC LIMIT $1`, [limit]);
  return rows.map(parseClothesTestLog);
}

export async function getClothesTestLog(uuid: string): Promise<ClothesTestLog | null> {
  const row = await queryOne(`SELECT * FROM clothes_test_logs WHERE uuid = $1`, [uuid]);
  return row ? parseClothesTestLog(row) : null;
}

export async function updateClothesTestLog(uuid: string, data: Partial<Omit<ClothesTestLog, 'uuid'>>): Promise<ClothesTestLog | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(data)) {
    fields.push(`${key} = $${i++}`);
    params.push(val);
  }
  if (fields.length === 0) return getClothesTestLog(uuid);
  params.push(uuid);
  const row = await queryOne(
    `UPDATE clothes_test_logs SET ${fields.join(', ')} WHERE uuid = $${i} RETURNING *`,
    params,
  );
  return row ? parseClothesTestLog(row) : null;
}

export async function deleteClothesTestLog(uuid: string): Promise<void> {
  await query(`DELETE FROM clothes_test_logs WHERE uuid = $1`, [uuid]);
}

// ===== PROGRESS PHOTOS (Module 7) =====

function parseProgressPhoto(row: DbRow): ProgressPhoto {
  return {
    uuid: row.uuid as string,
    blob_url: row.blob_url as string,
    pose: row.pose as ProgressPhoto['pose'],
    notes: row.notes as string | null,
    taken_at: row.taken_at as string,
  };
}

export async function createProgressPhoto(data: {
  blob_url: string;
  pose: string;
  notes?: string | null;
  taken_at?: string;
}): Promise<ProgressPhoto> {
  const uuid = randomUUID();
  const row = await queryOne(
    `INSERT INTO progress_photos (uuid, blob_url, pose, notes, taken_at)
     VALUES ($1, $2, $3, $4, COALESCE($5::TIMESTAMP, NOW())) RETURNING *`,
    [uuid, data.blob_url, data.pose, data.notes ?? null, data.taken_at ?? null],
  );
  return parseProgressPhoto(row!);
}

export async function listProgressPhotos(limit = 50): Promise<ProgressPhoto[]> {
  const rows = await query(
    `SELECT * FROM progress_photos ORDER BY taken_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(parseProgressPhoto);
}

export async function deleteProgressPhoto(uuid: string): Promise<void> {
  await query(`DELETE FROM progress_photos WHERE uuid = $1`, [uuid]);
}

// ===== INSPO PHOTOS =====

function parseInspoPhoto(row: DbRow): InspoPhoto {
  return {
    uuid: row.uuid as string,
    blob_url: row.blob_url as string,
    notes: row.notes as string | null,
    taken_at: row.taken_at as string,
    burst_group_id: row.burst_group_id as string | null,
  };
}

export async function createInspoPhoto(data: {
  blob_url: string;
  notes?: string | null;
  taken_at?: string;
  burst_group_id?: string | null;
}): Promise<InspoPhoto> {
  const uuid = randomUUID();
  const row = await queryOne(
    `INSERT INTO inspo_photos (uuid, blob_url, notes, taken_at, burst_group_id)
     VALUES ($1, $2, $3, COALESCE($4::TIMESTAMP, NOW()), $5) RETURNING *`,
    [uuid, data.blob_url, data.notes ?? null, data.taken_at ?? null, data.burst_group_id ?? null],
  );
  return parseInspoPhoto(row!);
}

export async function listInspoPhotos(limit = 50): Promise<InspoPhoto[]> {
  const rows = await query(
    `SELECT * FROM inspo_photos ORDER BY taken_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(parseInspoPhoto);
}

export async function deleteInspoPhoto(uuid: string): Promise<void> {
  await query(`DELETE FROM inspo_photos WHERE uuid = $1`, [uuid]);
}

export { importFitbeeExport } from './fitbee-import';

// ===== MCP SERVER QUERIES =====

// ── Active plan ───────────────────────────────────────────────────────────────

export async function getActivePlan(): Promise<WorkoutPlan & { is_active: boolean } | null> {
  const row = await queryOne<DbRow>(`SELECT * FROM workout_plans WHERE is_active = true LIMIT 1`);
  if (!row) return null;
  return { ...parsePlan(row), is_active: true };
}

export async function getActivePlanWithRoutines(): Promise<{
  plan: WorkoutPlan & { is_active: boolean };
  routines: Array<WorkoutRoutine & { exercises: Array<WorkoutRoutineExercise & { sets: WorkoutRoutineSet[] }> }>;
} | null> {
  const plan = await getActivePlan();
  if (!plan) return null;

  const routines = await listRoutines(plan.uuid);
  const routinesWithExercises = await Promise.all(
    routines.map(async (routine) => {
      const exercises = await listRoutineExercises(routine.uuid);
      const exercisesWithSets = await Promise.all(
        exercises.map(async (ex) => {
          const sets = await listRoutineSets(ex.uuid);
          return { ...ex, sets };
        })
      );
      return { ...routine, exercises: exercisesWithSets };
    })
  );

  return { plan, routines: routinesWithExercises };
}

export async function activatePlan(uuid: string): Promise<void> {
  // Deactivate all plans, then activate the specified one
  await query(`UPDATE workout_plans SET is_active = false WHERE is_active = true`);
  await query(`UPDATE workout_plans SET is_active = true WHERE uuid = $1`, [uuid]);
}

// ── Routine set updates ───────────────────────────────────────────────────────

export async function updateRoutineSet(
  uuid: string,
  data: { min_repetitions?: number | null; max_repetitions?: number | null }
): Promise<WorkoutRoutineSet | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let p = 0;

  if (data.min_repetitions !== undefined) {
    fields.push(`min_repetitions = $${++p}`);
    params.push(data.min_repetitions);
  }
  if (data.max_repetitions !== undefined) {
    fields.push(`max_repetitions = $${++p}`);
    params.push(data.max_repetitions);
  }

  if (fields.length === 0) return (await getRoutineSet(uuid)) ?? null;

  params.push(uuid);
  await query(
    `UPDATE workout_routine_sets SET ${fields.join(', ')} WHERE uuid = $${++p}`,
    params
  );
  return (await getRoutineSet(uuid)) ?? null;
}

export async function deleteRoutineSet(uuid: string): Promise<void> {
  await query('DELETE FROM workout_routine_sets WHERE uuid = $1', [uuid]);
}

// ── Exercise swap ─────────────────────────────────────────────────────────────

export async function swapExerciseInPlan(
  planUuid: string,
  fromExerciseUuid: string,
  toExerciseUuid: string
): Promise<number> {
  // Update all routine exercises within the given plan that use fromExerciseUuid
  const result = await query<DbRow>(`
    UPDATE workout_routine_exercises wre
    SET exercise_uuid = $1
    FROM workout_routines wr
    WHERE wre.workout_routine_uuid = wr.uuid
      AND wr.workout_plan_uuid = $2
      AND wre.exercise_uuid = $3
    RETURNING wre.uuid
  `, [toExerciseUuid, planUuid, fromExerciseUuid]);
  return result.length;
}

// ── Nutrition plan replace ────────────────────────────────────────────────────

export interface NutritionWeekMealInput {
  day_of_week: number;  // 0=Sun … 6=Sat
  meal_slot: string;    // 'breakfast' | 'lunch' | 'dinner' | 'snack'
  meal_name: string;
  protein_g?: number | null;
  calories?: number | null;
  quality_rating?: number | null;
  sort_order?: number;
}

export async function replaceNutritionWeekPlan(meals: NutritionWeekMealInput[]): Promise<NutritionWeekMeal[]> {
  // Full transactional replace: delete all existing week meals, insert new ones
  await query(`DELETE FROM nutrition_week_meals`);

  const inserted: NutritionWeekMeal[] = [];
  for (const meal of meals) {
    const m = await createNutritionWeekMeal({
      day_of_week: meal.day_of_week,
      meal_slot: meal.meal_slot,
      meal_name: meal.meal_name,
      protein_g: meal.protein_g ?? null,
      calories: meal.calories ?? null,
      quality_rating: meal.quality_rating ?? null,
      sort_order: meal.sort_order ?? 0,
    });
    inserted.push(m);
  }
  return inserted;
}

// ── Training blocks ───────────────────────────────────────────────────────────
// Column names match migration 006: name, goal (enum), started_at, ended_at

export interface TrainingBlock {
  uuid: string;
  name: string;
  goal: string;
  workout_plan_uuid: string | null;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  created_at: string;
}

function parseTrainingBlock(row: DbRow): TrainingBlock {
  return {
    uuid: row.uuid as string,
    name: row.name as string,
    goal: row.goal as string,
    workout_plan_uuid: row.workout_plan_uuid as string | null,
    started_at: row.started_at as string,
    ended_at: row.ended_at as string | null,
    notes: row.notes as string | null,
    created_at: row.created_at as string,
  };
}

export async function listTrainingBlocks(): Promise<TrainingBlock[]> {
  const rows = await query<DbRow>(`SELECT * FROM training_blocks ORDER BY started_at DESC`);
  return rows.map(parseTrainingBlock);
}

export async function createTrainingBlock(data: {
  name: string;
  goal: string;
  workout_plan_uuid?: string | null;
  started_at: string;
  ended_at?: string | null;
  notes?: string | null;
}): Promise<TrainingBlock> {
  const uuid = randomUUID();
  const row = await queryOne<DbRow>(
    `INSERT INTO training_blocks (uuid, name, goal, workout_plan_uuid, started_at, ended_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [uuid, data.name, data.goal, data.workout_plan_uuid ?? null, data.started_at, data.ended_at ?? null, data.notes ?? null]
  );
  return parseTrainingBlock(row!);
}

export async function updateTrainingBlock(
  uuid: string,
  data: { name?: string; goal?: string; started_at?: string; ended_at?: string | null; notes?: string | null; workout_plan_uuid?: string | null }
): Promise<TrainingBlock | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let p = 0;

  if (data.name !== undefined) { fields.push(`name = $${++p}`); params.push(data.name); }
  if (data.goal !== undefined) { fields.push(`goal = $${++p}`); params.push(data.goal); }
  if (data.started_at !== undefined) { fields.push(`started_at = $${++p}`); params.push(data.started_at); }
  if (data.ended_at !== undefined) { fields.push(`ended_at = $${++p}`); params.push(data.ended_at); }
  if (data.notes !== undefined) { fields.push(`notes = $${++p}`); params.push(data.notes); }
  if (data.workout_plan_uuid !== undefined) { fields.push(`workout_plan_uuid = $${++p}`); params.push(data.workout_plan_uuid); }

  if (fields.length === 0) {
    const row = await queryOne<DbRow>(`SELECT * FROM training_blocks WHERE uuid = $1`, [uuid]);
    return row ? parseTrainingBlock(row) : null;
  }

  params.push(uuid);
  const row = await queryOne<DbRow>(
    `UPDATE training_blocks SET ${fields.join(', ')} WHERE uuid = $${++p} RETURNING *`,
    params
  );
  return row ? parseTrainingBlock(row) : null;
}

export async function deleteTrainingBlock(uuid: string): Promise<void> {
  await query(`DELETE FROM training_blocks WHERE uuid = $1`, [uuid]);
}

// ── Coaching notes ────────────────────────────────────────────────────────────
// Column names match migration 006: note, context (enum), pinned

export interface CoachingNote {
  uuid: string;
  note: string;
  context: string | null;
  pinned: boolean;
  created_at: string;
}

function parseCoachingNote(row: DbRow): CoachingNote {
  return {
    uuid: row.uuid as string,
    note: row.note as string,
    context: row.context as string | null,
    pinned: Boolean(row.pinned),
    created_at: row.created_at as string,
  };
}

export async function listCoachingNotes(options: {
  pinned_only?: boolean;
  context?: string;
  limit?: number;
} = {}): Promise<CoachingNote[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let p = 0;

  if (options.pinned_only) conditions.push('pinned = true');
  if (options.context) { conditions.push(`context = $${++p}`); params.push(options.context); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 50;
  params.push(limit);

  const rows = await query<DbRow>(
    `SELECT * FROM coaching_notes ${where} ORDER BY pinned DESC, created_at DESC LIMIT $${++p}`,
    params
  );
  return rows.map(parseCoachingNote);
}

export async function createCoachingNote(data: {
  note: string;
  pinned?: boolean;
  context?: string | null;
}): Promise<CoachingNote> {
  const uuid = randomUUID();
  const row = await queryOne<DbRow>(
    `INSERT INTO coaching_notes (uuid, note, context, pinned) VALUES ($1, $2, $3, $4) RETURNING *`,
    [uuid, data.note, data.context ?? null, data.pinned ?? false]
  );
  return parseCoachingNote(row!);
}

export async function updateCoachingNote(
  uuid: string,
  data: { note?: string; pinned?: boolean; context?: string | null }
): Promise<CoachingNote | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let p = 0;

  if (data.note !== undefined) { fields.push(`note = $${++p}`); params.push(data.note); }
  if (data.pinned !== undefined) { fields.push(`pinned = $${++p}`); params.push(data.pinned); }
  if (data.context !== undefined) { fields.push(`context = $${++p}`); params.push(data.context); }

  if (fields.length === 0) {
    const row = await queryOne<DbRow>(`SELECT * FROM coaching_notes WHERE uuid = $1`, [uuid]);
    return row ? parseCoachingNote(row) : null;
  }

  params.push(uuid);
  const row = await queryOne<DbRow>(
    `UPDATE coaching_notes SET ${fields.join(', ')} WHERE uuid = $${++p} RETURNING *`,
    params
  );
  return row ? parseCoachingNote(row) : null;
}

export async function deleteCoachingNote(uuid: string): Promise<void> {
  await query(`DELETE FROM coaching_notes WHERE uuid = $1`, [uuid]);
}

// ===== INBODY SCAN CATALOG =====

/** All numeric-valued columns on inbody_scans (used for compare_inbody_scans). */
export const INBODY_NUMERIC_COLUMNS = [
  'height_cm',
  'weight_kg',
  'total_body_water_l', 'intracellular_water_l', 'extracellular_water_l',
  'protein_kg', 'minerals_kg', 'bone_mineral_kg',
  'body_fat_mass_kg', 'smm_kg', 'soft_lean_mass_kg', 'fat_free_mass_kg',
  'bmi', 'pbf_pct', 'whr', 'inbody_score', 'visceral_fat_level',
  'bmr_kcal', 'body_cell_mass_kg', 'ecw_ratio',
  'seg_lean_right_arm_kg', 'seg_lean_right_arm_pct',
  'seg_lean_left_arm_kg', 'seg_lean_left_arm_pct',
  'seg_lean_trunk_kg', 'seg_lean_trunk_pct',
  'seg_lean_right_leg_kg', 'seg_lean_right_leg_pct',
  'seg_lean_left_leg_kg', 'seg_lean_left_leg_pct',
  'seg_fat_right_arm_kg', 'seg_fat_right_arm_pct',
  'seg_fat_left_arm_kg', 'seg_fat_left_arm_pct',
  'seg_fat_trunk_kg', 'seg_fat_trunk_pct',
  'seg_fat_right_leg_kg', 'seg_fat_right_leg_pct',
  'seg_fat_left_leg_kg', 'seg_fat_left_leg_pct',
  'circ_neck_cm', 'circ_chest_cm', 'circ_abdomen_cm', 'circ_hip_cm',
  'circ_right_arm_cm', 'circ_left_arm_cm',
  'circ_right_thigh_cm', 'circ_left_thigh_cm',
  'arm_muscle_circumference_cm',
  'target_weight_kg', 'weight_control_kg', 'fat_control_kg', 'muscle_control_kg',
] as const;

/** All writable columns excluding uuid / created_at / updated_at. */
const INBODY_WRITABLE_COLUMNS = [
  'scanned_at', 'device', 'venue', 'age_at_scan',
  ...INBODY_NUMERIC_COLUMNS,
  'balance_upper', 'balance_lower', 'balance_upper_lower',
  'impedance', 'notes', 'raw_json',
] as const;

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseJsonObj(v: unknown): Record<string, unknown> {
  if (!v) return {};
  if (typeof v === 'object') return v as Record<string, unknown>;
  try { return JSON.parse(String(v)); } catch { return {}; }
}

export function parseInbodyScan(row: DbRow): InbodyScan {
  return {
    uuid: row.uuid as string,
    scanned_at: row.scanned_at instanceof Date
      ? (row.scanned_at as Date).toISOString()
      : String(row.scanned_at),
    device: (row.device as string) ?? 'InBody 570',
    venue: (row.venue as string) ?? null,
    age_at_scan: int(row.age_at_scan),
    height_cm: num(row.height_cm),
    weight_kg: num(row.weight_kg),
    total_body_water_l: num(row.total_body_water_l),
    intracellular_water_l: num(row.intracellular_water_l),
    extracellular_water_l: num(row.extracellular_water_l),
    protein_kg: num(row.protein_kg),
    minerals_kg: num(row.minerals_kg),
    bone_mineral_kg: num(row.bone_mineral_kg),
    body_fat_mass_kg: num(row.body_fat_mass_kg),
    smm_kg: num(row.smm_kg),
    soft_lean_mass_kg: num(row.soft_lean_mass_kg),
    fat_free_mass_kg: num(row.fat_free_mass_kg),
    bmi: num(row.bmi),
    pbf_pct: num(row.pbf_pct),
    whr: num(row.whr),
    inbody_score: int(row.inbody_score),
    visceral_fat_level: int(row.visceral_fat_level),
    bmr_kcal: int(row.bmr_kcal),
    body_cell_mass_kg: num(row.body_cell_mass_kg),
    ecw_ratio: num(row.ecw_ratio),
    seg_lean_right_arm_kg: num(row.seg_lean_right_arm_kg),
    seg_lean_right_arm_pct: num(row.seg_lean_right_arm_pct),
    seg_lean_left_arm_kg: num(row.seg_lean_left_arm_kg),
    seg_lean_left_arm_pct: num(row.seg_lean_left_arm_pct),
    seg_lean_trunk_kg: num(row.seg_lean_trunk_kg),
    seg_lean_trunk_pct: num(row.seg_lean_trunk_pct),
    seg_lean_right_leg_kg: num(row.seg_lean_right_leg_kg),
    seg_lean_right_leg_pct: num(row.seg_lean_right_leg_pct),
    seg_lean_left_leg_kg: num(row.seg_lean_left_leg_kg),
    seg_lean_left_leg_pct: num(row.seg_lean_left_leg_pct),
    seg_fat_right_arm_kg: num(row.seg_fat_right_arm_kg),
    seg_fat_right_arm_pct: num(row.seg_fat_right_arm_pct),
    seg_fat_left_arm_kg: num(row.seg_fat_left_arm_kg),
    seg_fat_left_arm_pct: num(row.seg_fat_left_arm_pct),
    seg_fat_trunk_kg: num(row.seg_fat_trunk_kg),
    seg_fat_trunk_pct: num(row.seg_fat_trunk_pct),
    seg_fat_right_leg_kg: num(row.seg_fat_right_leg_kg),
    seg_fat_right_leg_pct: num(row.seg_fat_right_leg_pct),
    seg_fat_left_leg_kg: num(row.seg_fat_left_leg_kg),
    seg_fat_left_leg_pct: num(row.seg_fat_left_leg_pct),
    circ_neck_cm: num(row.circ_neck_cm),
    circ_chest_cm: num(row.circ_chest_cm),
    circ_abdomen_cm: num(row.circ_abdomen_cm),
    circ_hip_cm: num(row.circ_hip_cm),
    circ_right_arm_cm: num(row.circ_right_arm_cm),
    circ_left_arm_cm: num(row.circ_left_arm_cm),
    circ_right_thigh_cm: num(row.circ_right_thigh_cm),
    circ_left_thigh_cm: num(row.circ_left_thigh_cm),
    arm_muscle_circumference_cm: num(row.arm_muscle_circumference_cm),
    target_weight_kg: num(row.target_weight_kg),
    weight_control_kg: num(row.weight_control_kg),
    fat_control_kg: num(row.fat_control_kg),
    muscle_control_kg: num(row.muscle_control_kg),
    balance_upper: (row.balance_upper as BodyBalance | null) ?? null,
    balance_lower: (row.balance_lower as BodyBalance | null) ?? null,
    balance_upper_lower: (row.balance_upper_lower as BodyBalance | null) ?? null,
    impedance: parseJsonObj(row.impedance) as Record<string, Record<string, number>>,
    notes: (row.notes as string) ?? null,
    raw_json: parseJsonObj(row.raw_json),
    created_at: row.created_at instanceof Date
      ? (row.created_at as Date).toISOString()
      : String(row.created_at),
    updated_at: row.updated_at instanceof Date
      ? (row.updated_at as Date).toISOString()
      : String(row.updated_at),
  };
}

export type InbodyScanInput = Partial<Omit<InbodyScan, 'uuid' | 'created_at' | 'updated_at'>> & {
  scanned_at: string;
};

function normaliseInbodyValue(col: string, val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (col === 'impedance' || col === 'raw_json') {
    return typeof val === 'string' ? val : JSON.stringify(val);
  }
  return val;
}

export async function createInbodyScan(data: InbodyScanInput): Promise<InbodyScan> {
  if (!data.scanned_at) throw new Error('scanned_at is required');
  const uuid = randomUUID();
  const cols: string[] = ['uuid'];
  const params: unknown[] = [uuid];
  const placeholders: string[] = ['$1'];
  let i = 2;
  for (const col of INBODY_WRITABLE_COLUMNS) {
    const val = (data as Record<string, unknown>)[col];
    if (val === undefined) continue;
    cols.push(col);
    params.push(normaliseInbodyValue(col, val));
    placeholders.push(`$${i++}`);
  }
  const row = await queryOne(
    `INSERT INTO inbody_scans (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    params,
  );
  return parseInbodyScan(row!);
}

export async function listInbodyScans(options: { limit?: number; from?: string; to?: string } = {}): Promise<InbodyScan[]> {
  const { limit = 90, from, to } = options;
  const params: unknown[] = [];
  let sql = 'SELECT * FROM inbody_scans WHERE 1=1';
  if (from) { sql += ` AND scanned_at >= $${params.length + 1}`; params.push(from); }
  if (to)   { sql += ` AND scanned_at <= $${params.length + 1}`; params.push(to); }
  sql += ` ORDER BY scanned_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  const rows = await query(sql, params);
  return rows.map(parseInbodyScan);
}

export async function getInbodyScan(uuid: string): Promise<InbodyScan | null> {
  const row = await queryOne(`SELECT * FROM inbody_scans WHERE uuid = $1`, [uuid]);
  return row ? parseInbodyScan(row) : null;
}

export async function getLatestInbodyScan(): Promise<InbodyScan | null> {
  const row = await queryOne(`SELECT * FROM inbody_scans ORDER BY scanned_at DESC LIMIT 1`, []);
  return row ? parseInbodyScan(row) : null;
}

export async function updateInbodyScan(uuid: string, data: Partial<InbodyScanInput>): Promise<InbodyScan | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const col of INBODY_WRITABLE_COLUMNS) {
    const val = (data as Record<string, unknown>)[col];
    if (val === undefined) continue;
    fields.push(`${col} = $${i++}`);
    params.push(normaliseInbodyValue(col, val));
  }
  if (fields.length === 0) return getInbodyScan(uuid);
  params.push(uuid);
  const row = await queryOne(
    `UPDATE inbody_scans SET ${fields.join(', ')} WHERE uuid = $${i} RETURNING *`,
    params,
  );
  return row ? parseInbodyScan(row) : null;
}

export async function deleteInbodyScan(uuid: string): Promise<void> {
  // Cascade-cleanup: also remove any measurement_logs rows tagged as auto-inserts
  // from this scan (source_ref = uuid) so deleting a scan cleans its derived data.
  await query(`DELETE FROM measurement_logs WHERE source = $1 AND source_ref = $2`, ['inbody_scan', uuid]);
  await query(`DELETE FROM inbody_scans WHERE uuid = $1`, [uuid]);
}

// ===== BODY GOALS (Me reference) =====

export function parseBodyGoal(row: DbRow): BodyGoal {
  return {
    metric_key: row.metric_key as string,
    target_value: parseFloat(row.target_value as string),
    unit: row.unit as string,
    direction: row.direction as BodyGoal['direction'],
    notes: (row.notes as string) ?? null,
    updated_at: row.updated_at instanceof Date
      ? (row.updated_at as Date).toISOString()
      : String(row.updated_at),
  };
}

export async function getBodyGoals(): Promise<Record<string, BodyGoal>> {
  const rows = await query(`SELECT * FROM body_goals ORDER BY metric_key ASC`, []);
  const out: Record<string, BodyGoal> = {};
  for (const r of rows) {
    const g = parseBodyGoal(r);
    out[g.metric_key] = g;
  }
  return out;
}

export async function upsertBodyGoal(
  metric_key: string,
  data: { target_value: number; unit: string; direction: BodyGoal['direction']; notes?: string | null }
): Promise<BodyGoal> {
  const row = await queryOne(
    `INSERT INTO body_goals (metric_key, target_value, unit, direction, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (metric_key) DO UPDATE SET
       target_value = EXCLUDED.target_value,
       unit = EXCLUDED.unit,
       direction = EXCLUDED.direction,
       notes = EXCLUDED.notes,
       updated_at = NOW()
     RETURNING *`,
    [metric_key, data.target_value, data.unit, data.direction, data.notes ?? null],
  );
  return parseBodyGoal(row!);
}

export async function deleteBodyGoal(metric_key: string): Promise<void> {
  await query(`DELETE FROM body_goals WHERE metric_key = $1`, [metric_key]);
}

// ===== BODY NORM RANGES =====

export function parseBodyNormRange(row: DbRow): BodyNormRange {
  return {
    id: Number(row.id),
    sex: row.sex as 'M' | 'F',
    metric_key: row.metric_key as string,
    age_min: row.age_min == null ? null : Number(row.age_min),
    age_max: row.age_max == null ? null : Number(row.age_max),
    height_min_cm: row.height_min_cm == null ? null : parseFloat(row.height_min_cm as string),
    height_max_cm: row.height_max_cm == null ? null : parseFloat(row.height_max_cm as string),
    low: parseFloat(row.low as string),
    high: parseFloat(row.high as string),
    source: (row.source as string) ?? null,
    notes: (row.notes as string) ?? null,
  };
}

export async function getBodyNormRanges(sex: 'M' | 'F'): Promise<Record<string, BodyNormRange[]>> {
  const rows = await query(`SELECT * FROM body_norm_ranges WHERE sex = $1 ORDER BY metric_key ASC, id ASC`, [sex]);
  const out: Record<string, BodyNormRange[]> = {};
  for (const r of rows) {
    const range = parseBodyNormRange(r);
    (out[range.metric_key] ??= []).push(range);
  }
  return out;
}
