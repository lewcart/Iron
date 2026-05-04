// Named test fixtures for the E2E bridge. Each fixture mutates Dexie to a
// known state. Add new fixtures as flows need them — bridge.seed(name)
// dispatches here.

import { db } from '@/db/local';

export async function applyFixture(name: string): Promise<void> {
  switch (name) {
    case 'empty':
      // No-op; bridge.reset() already left Dexie empty.
      return;
    case 'workout-with-3-sets':
      await applyWorkoutWith3Sets();
      return;
    default:
      throw new Error(`test-fixtures: unknown fixture "${name}"`);
  }
}

// Seeds a single in-progress workout (`is_current: true`) with one
// exercise and three completed sets. Unlocks workout-reps-input,
// modal-back, and tabbar-during-modal flows.
async function applyWorkoutWith3Sets(): Promise<void> {
  // Pick any exercise from the local catalog — workouts only need a valid
  // uuid reference, and the catalog is hydrated on first launch via
  // hydrateExercises(). If the catalog is empty (cold start before sync),
  // seed a minimal stub.
  let exerciseUuid: string;
  const firstExercise = await db.exercises.toCollection().first();
  if (firstExercise) {
    exerciseUuid = firstExercise.uuid;
  } else {
    exerciseUuid = '00000000-0000-0000-0000-000000000001';
    await db.exercises.put({
      uuid: exerciseUuid,
      title: 'E2E Test Exercise',
      primary_muscles: ['chest'],
      secondary_muscles: [],
      equipment: [],
      mode: 'reps',
      has_sides: false,
      _synced: false,
      _updated_at: Date.now(),
      _deleted: false,
    } as never);
  }

  const now = Date.now();
  const workoutUuid = 'e2e-fixture-workout-001';
  const weUuid = 'e2e-fixture-we-001';

  await db.workouts.put({
    uuid: workoutUuid,
    start_time: new Date(now).toISOString(),
    end_time: null,
    title: 'E2E Workout',
    comment: null,
    is_current: true,
    workout_routine_uuid: null,
    _synced: false,
    _updated_at: now,
    _deleted: false,
  } as never);

  await db.workout_exercises.put({
    uuid: weUuid,
    workout_uuid: workoutUuid,
    exercise_uuid: exerciseUuid,
    comment: null,
    order_index: 0,
    _synced: false,
    _updated_at: now,
    _deleted: false,
  } as never);

  for (let i = 0; i < 3; i++) {
    await db.workout_sets.put({
      uuid: `e2e-fixture-set-${i + 1}`,
      workout_exercise_uuid: weUuid,
      weight: 50 + i * 5,
      repetitions: 10 - i,
      min_target_reps: 8,
      max_target_reps: 12,
      rpe: null,
      rir: null,
      tag: null,
      comment: null,
      is_completed: true,
      is_pr: false,
      excluded_from_pb: false,
      duration_seconds: null,
      order_index: i,
      _synced: false,
      _updated_at: now,
      _deleted: false,
    } as never);
  }
}
