'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import type { LocalWorkout, LocalWorkoutExercise, LocalWorkoutSet, LocalBodyweightLog } from '@/db/local';
import { uuid as genUUID } from '@/lib/uuid';
import { saveWorkoutToHealthKit } from '@/lib/healthkit';

function now() {
  return Date.now();
}

function syncMeta() {
  return { _synced: false as const, _updated_at: now(), _deleted: false as const };
}

// ─── Workouts ──────────────────────────────────────────────────────────────────

export async function startWorkout(opts: {
  title?: string;
  workout_routine_uuid?: string;
} = {}): Promise<string> {
  // End any currently active workout first
  const current = await db.workouts.filter(w => w.is_current === true).first();
  if (current) {
    await db.workouts.update(current.uuid, {
      is_current: false,
      end_time: new Date().toISOString(),
      ...syncMeta(),
    });
  }

  const id = genUUID();
  const workout: LocalWorkout = {
    uuid: id,
    start_time: new Date().toISOString(),
    end_time: null,
    title: opts.title ?? null,
    comment: null,
    is_current: true,
    workout_routine_uuid: opts.workout_routine_uuid ?? null,
    ...syncMeta(),
  };
  await db.workouts.add(workout);
  syncEngine.schedulePush();
  return id;
}

export async function finishWorkout(uuid: string): Promise<void> {
  const workout = await db.workouts.get(uuid);
  const endTime = new Date().toISOString();

  await db.workouts.update(uuid, {
    is_current: false,
    end_time: endTime,
    ...syncMeta(),
  });
  syncEngine.schedulePush();

  if (workout?.start_time) {
    saveWorkoutToHealthKit({
      uuid,
      startTime: workout.start_time,
      endTime,
      title: workout.title,
    });
  }
}

export async function deleteWorkout(uuid: string): Promise<void> {
  // Cascade: mark exercises and sets as deleted too
  const exercises = await db.workout_exercises.where('workout_uuid').equals(uuid).toArray();
  for (const ex of exercises) {
    await db.workout_sets
      .where('workout_exercise_uuid')
      .equals(ex.uuid)
      .modify({ _deleted: true, _synced: false, _updated_at: now() });
  }
  await db.workout_exercises
    .where('workout_uuid')
    .equals(uuid)
    .modify({ _deleted: true, _synced: false, _updated_at: now() });
  await db.workouts.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

export async function updateWorkoutTitle(uuid: string, title: string): Promise<void> {
  await db.workouts.update(uuid, { title, ...syncMeta() });
  syncEngine.schedulePush();
}

// ─── Workout exercises ─────────────────────────────────────────────────────────

export async function addExerciseToWorkout(
  workout_uuid: string,
  exercise_uuid: string,
  order_index: number,
): Promise<string> {
  const id = genUUID();
  const row: LocalWorkoutExercise = {
    uuid: id,
    workout_uuid,
    exercise_uuid,
    comment: null,
    order_index,
    ...syncMeta(),
  };
  await db.workout_exercises.add(row);
  syncEngine.schedulePush();
  return id;
}

export async function removeExerciseFromWorkout(uuid: string): Promise<void> {
  await db.workout_sets
    .where('workout_exercise_uuid')
    .equals(uuid)
    .modify({ _deleted: true, _synced: false, _updated_at: now() });
  await db.workout_exercises.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── Workout sets ──────────────────────────────────────────────────────────────

export async function addSet(
  workout_exercise_uuid: string,
  data: Partial<Pick<LocalWorkoutSet, 'weight' | 'repetitions' | 'min_target_reps' | 'max_target_reps' | 'rpe' | 'rir' | 'tag'>>,
  order_index: number,
): Promise<string> {
  const id = genUUID();
  const row: LocalWorkoutSet = {
    uuid: id,
    workout_exercise_uuid,
    weight: data.weight ?? null,
    repetitions: data.repetitions ?? null,
    min_target_reps: data.min_target_reps ?? null,
    max_target_reps: data.max_target_reps ?? null,
    rpe: data.rpe ?? null,
    rir: data.rir ?? null,
    tag: data.tag ?? null,
    comment: null,
    is_completed: false,
    is_pr: false,
    excluded_from_pb: false,
    order_index,
    duration_seconds: null,
    ...syncMeta(),
  };
  await db.workout_sets.add(row);
  syncEngine.schedulePush();
  return id;
}

export async function updateSet(
  uuid: string,
  changes: Partial<Omit<LocalWorkoutSet, 'uuid' | 'workout_exercise_uuid' | '_synced' | '_updated_at' | '_deleted'>>,
): Promise<void> {
  await db.workout_sets.update(uuid, { ...changes, ...syncMeta() });
  syncEngine.schedulePush();
}

export async function deleteSet(uuid: string): Promise<void> {
  await db.workout_sets.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── Bodyweight logs ───────────────────────────────────────────────────────────

export async function logBodyweight(weight_kg: number, note?: string): Promise<string> {
  const id = genUUID();
  const row: LocalBodyweightLog = {
    uuid: id,
    weight_kg,
    logged_at: new Date().toISOString(),
    note: note ?? null,
    ...syncMeta(),
  };
  await db.bodyweight_logs.add(row);
  syncEngine.schedulePush();
  return id;
}

export async function deleteBodyweightLog(uuid: string): Promise<void> {
  await db.bodyweight_logs.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── Exercise reordering ──────────────────────────────────────────────────────

export async function reorderExercises(orderedUuids: string[]): Promise<void> {
  await Promise.all(
    orderedUuids.map((uuid, index) =>
      db.workout_exercises.update(uuid, {
        order_index: index,
        ...syncMeta(),
      }),
    ),
  );
  syncEngine.schedulePush();
}
