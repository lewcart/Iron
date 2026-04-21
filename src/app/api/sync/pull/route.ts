import { NextResponse } from 'next/server';
import { query } from '@/db/db';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const since = searchParams.get('since');

    const pulledAt = new Date().toISOString();

    if (!since) {
      // Full pull — return everything (initial sync). Exercises ship in the same
      // envelope so the local catalog is always consistent with the exercise_uuids
      // referenced by workout_exercises — no independent hydration window.
      const [workouts, workout_exercises, workout_sets, bodyweight_logs, exercises] = await Promise.all([
        query<Record<string, unknown>>('SELECT * FROM workouts ORDER BY start_time DESC LIMIT 200'),
        query<Record<string, unknown>>('SELECT * FROM workout_exercises'),
        query<Record<string, unknown>>('SELECT * FROM workout_sets'),
        query<Record<string, unknown>>('SELECT * FROM bodyweight_logs ORDER BY logged_at DESC LIMIT 500'),
        query<Record<string, unknown>>('SELECT * FROM exercises WHERE is_hidden = false'),
      ]);

      return NextResponse.json({
        workouts: workouts.map(mapWorkout),
        workout_exercises: workout_exercises.map(mapWorkoutExercise),
        workout_sets: workout_sets.map(mapWorkoutSet),
        bodyweight_logs: bodyweight_logs.map(mapBodyweightLog),
        exercises: exercises.map(mapExercise),
        deleted: { workouts: [], workout_exercises: [], workout_sets: [], bodyweight_logs: [] },
        pulled_at: pulledAt,
      });
    }

    // Incremental pull — only rows updated since `since`
    const [workouts, workout_exercises, workout_sets, bodyweight_logs, exercises] = await Promise.all([
      query<Record<string, unknown>>('SELECT * FROM workouts WHERE updated_at > $1', [since]),
      query<Record<string, unknown>>('SELECT * FROM workout_exercises WHERE updated_at > $1', [since]),
      query<Record<string, unknown>>('SELECT * FROM workout_sets WHERE updated_at > $1', [since]),
      query<Record<string, unknown>>('SELECT * FROM bodyweight_logs WHERE updated_at > $1', [since]),
      query<Record<string, unknown>>('SELECT * FROM exercises WHERE is_hidden = false AND updated_at > $1', [since]),
    ]);

    return NextResponse.json({
      workouts: workouts.map(mapWorkout),
      workout_exercises: workout_exercises.map(mapWorkoutExercise),
      workout_sets: workout_sets.map(mapWorkoutSet),
      bodyweight_logs: bodyweight_logs.map(mapBodyweightLog),
      exercises: exercises.map(mapExercise),
      // Hard-deletes are tracked via push; no server-side soft-delete tracking yet
      deleted: { workouts: [], workout_exercises: [], workout_sets: [], bodyweight_logs: [] },
      pulled_at: pulledAt,
    });
  } catch (err) {
    console.error('sync/pull error:', err);
    return NextResponse.json({ error: 'Pull failed' }, { status: 500 });
  }
}

// ─── Map DB rows to local schema format ────────────────────────────────────────

function mapWorkout(r: Record<string, unknown>) {
  return {
    uuid: r.uuid,
    start_time: (r.start_time as Date)?.toISOString?.() ?? r.start_time,
    end_time: r.end_time ? (r.end_time as Date)?.toISOString?.() ?? r.end_time : null,
    title: r.title ?? null,
    comment: r.comment ?? null,
    is_current: Boolean(r.is_current),
    workout_routine_uuid: r.workout_routine_uuid ?? null,
    _synced: true,
    _updated_at: r.updated_at ? new Date(r.updated_at as string).getTime() : Date.now(),
    _deleted: false,
  };
}

function mapWorkoutExercise(r: Record<string, unknown>) {
  return {
    uuid: r.uuid,
    workout_uuid: r.workout_uuid,
    exercise_uuid: (r.exercise_uuid as string).toLowerCase(),
    comment: r.comment ?? null,
    order_index: Number(r.order_index),
    _synced: true,
    _updated_at: r.updated_at ? new Date(r.updated_at as string).getTime() : Date.now(),
    _deleted: false,
  };
}

function mapWorkoutSet(r: Record<string, unknown>) {
  return {
    uuid: r.uuid,
    workout_exercise_uuid: r.workout_exercise_uuid,
    weight: r.weight !== null ? Number(r.weight) : null,
    repetitions: r.repetitions !== null ? Number(r.repetitions) : null,
    min_target_reps: r.min_target_reps !== null ? Number(r.min_target_reps) : null,
    max_target_reps: r.max_target_reps !== null ? Number(r.max_target_reps) : null,
    rpe: r.rpe !== null ? Number(r.rpe) : null,
    tag: r.tag ?? null,
    comment: r.comment ?? null,
    is_completed: Boolean(r.is_completed),
    is_pr: Boolean(r.is_pr),
    order_index: Number(r.order_index),
    _synced: true,
    _updated_at: r.updated_at ? new Date(r.updated_at as string).getTime() : Date.now(),
    _deleted: false,
  };
}

function mapBodyweightLog(r: Record<string, unknown>) {
  return {
    uuid: r.uuid,
    weight_kg: Number(r.weight_kg),
    logged_at: (r.logged_at as Date)?.toISOString?.() ?? r.logged_at,
    note: r.note ?? null,
    _synced: true,
    _updated_at: r.updated_at ? new Date(r.updated_at as string).getTime() : Date.now(),
    _deleted: false,
  };
}

// Shape must match LocalExercise in src/db/local.ts. uuid is lowercased so client
// lookups (which lowercase too) can never miss on case.
function mapExercise(r: Record<string, unknown>) {
  const parseJsonOrArray = (v: unknown, fallback: unknown[] = []): unknown[] =>
    Array.isArray(v) ? v : JSON.parse((v as string) || '[]') || fallback;
  return {
    uuid: (r.uuid as string).toLowerCase(),
    everkinetic_id: r.everkinetic_id as number,
    title: r.title as string,
    alias: parseJsonOrArray(r.alias) as string[],
    description: (r.description as string | null) ?? null,
    primary_muscles: parseJsonOrArray(r.primary_muscles) as string[],
    secondary_muscles: parseJsonOrArray(r.secondary_muscles) as string[],
    equipment: parseJsonOrArray(r.equipment) as string[],
    steps: parseJsonOrArray(r.steps) as string[],
    tips: parseJsonOrArray(r.tips) as string[],
    is_custom: Boolean(r.is_custom),
    is_hidden: Boolean(r.is_hidden),
    movement_pattern: (r.movement_pattern as string | null) ?? null,
  };
}
