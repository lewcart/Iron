import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/db/local';
import { getExerciseTimePRsLocal } from './useLocalDB';

// Regression: when an exercise is flipped to time mode, the local PR/chart
// pipeline must reinterpret historical reps-mode sets as held duration. Per
// migration 022, mode is freely mutable and historical sets are reinterpreted
// under the new mode. Lou's workaround pre-feature was to enter seconds in the
// reps field; the read path must honor that translation so the PB and graph
// don't disappear after a mode flip.

const PLANK_UUID = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';

async function seedTimeModeExercise() {
  await db.exercises.put({
    uuid: PLANK_UUID,
    everkinetic_id: 12345,
    title: 'Plank',
    alias: [],
    description: null,
    primary_muscles: [],
    secondary_muscles: [],
    equipment: [],
    steps: [],
    tips: [],
    is_custom: false,
    is_hidden: false,
    movement_pattern: null,
    tracking_mode: 'time',
  });
}

async function seedSet(opts: {
  setUuid: string;
  weUuid: string;
  workoutUuid: string;
  startTime: string;
  weight: number | null;
  repetitions: number | null;
  duration_seconds: number | null;
  orderIndex?: number;
}) {
  await db.workouts.put({
    uuid: opts.workoutUuid,
    start_time: opts.startTime,
    end_time: null,
    title: null,
    comment: null,
    is_current: false,
    _synced: true,
    _deleted: false,
  });
  await db.workout_exercises.put({
    uuid: opts.weUuid,
    workout_uuid: opts.workoutUuid,
    exercise_uuid: PLANK_UUID,
    order_index: 0,
    notes: null,
    _synced: true,
    _deleted: false,
  });
  await db.workout_sets.put({
    uuid: opts.setUuid,
    workout_exercise_uuid: opts.weUuid,
    weight: opts.weight,
    repetitions: opts.repetitions,
    duration_seconds: opts.duration_seconds,
    min_target_reps: null,
    max_target_reps: null,
    rpe: null,
    rir: null,
    tag: null,
    comment: null,
    is_completed: true,
    is_pr: false,
    order_index: opts.orderIndex ?? 0,
    _synced: true,
    _deleted: false,
  });
}

describe('getExerciseTimePRsLocal — retroactive interpretation after mode flip', () => {
  beforeEach(async () => {
    await Promise.all([
      db.exercises.clear(),
      db.workouts.clear(),
      db.workout_exercises.clear(),
      db.workout_sets.clear(),
    ]);
    await seedTimeModeExercise();
  });

  it('treats reps-only historical sets as held seconds when mode is time', async () => {
    // Lou logged "30 reps" before flipping copenhagen to time mode — those
    // reps were really seconds. After the flip, they must show up as PB.
    await seedSet({
      setUuid: 'set-1', weUuid: 'we-1', workoutUuid: 'wo-1',
      startTime: '2026-04-20T10:00:00Z',
      weight: 10, repetitions: 30, duration_seconds: null,
    });

    const result = await getExerciseTimePRsLocal(PLANK_UUID);

    expect(result.longestHold).not.toBeNull();
    expect(result.longestHold!.duration_seconds).toBe(30);
    expect(result.totalSeconds).toBe(30);
    expect(result.progress).toHaveLength(1);
    expect(result.progress[0].longestHold).toBe(30);
  });

  it('preserves weight on the longest-hold record', async () => {
    // Loaded planks must retain their weight dimension. Earlier AI work
    // dropped weight from time-mode reads even though the workout entry
    // captured it.
    await seedSet({
      setUuid: 'set-1', weUuid: 'we-1', workoutUuid: 'wo-1',
      startTime: '2026-04-20T10:00:00Z',
      weight: 22.5, repetitions: null, duration_seconds: 60,
    });

    const result = await getExerciseTimePRsLocal(PLANK_UUID);

    expect(result.longestHold!.duration_seconds).toBe(60);
    expect(result.longestHold!.weight).toBe(22.5);
    expect(result.progress[0].maxWeight).toBe(22.5);
  });

  it('prefers duration_seconds when both fields are populated', async () => {
    // A set logged after the mode flip carries duration_seconds. Reps that
    // somehow remained on the row are ignored — duration is authoritative.
    await seedSet({
      setUuid: 'set-1', weUuid: 'we-1', workoutUuid: 'wo-1',
      startTime: '2026-04-20T10:00:00Z',
      weight: null, repetitions: 99, duration_seconds: 45,
    });

    const result = await getExerciseTimePRsLocal(PLANK_UUID);
    expect(result.longestHold!.duration_seconds).toBe(45);
  });

  it('mixes pre-flip and post-flip sets correctly', async () => {
    // Pre-flip set: 25 reps (= 25 seconds reinterpreted)
    await seedSet({
      setUuid: 'old-1', weUuid: 'we-old', workoutUuid: 'wo-old',
      startTime: '2026-04-01T10:00:00Z',
      weight: 0, repetitions: 25, duration_seconds: null,
    });
    // Post-flip set: 60 second hold
    await seedSet({
      setUuid: 'new-1', weUuid: 'we-new', workoutUuid: 'wo-new',
      startTime: '2026-05-01T10:00:00Z',
      weight: 0, repetitions: null, duration_seconds: 60,
    });

    const result = await getExerciseTimePRsLocal(PLANK_UUID);

    expect(result.longestHold!.duration_seconds).toBe(60);
    expect(result.totalSeconds).toBe(85);
    expect(result.progress).toHaveLength(2);
  });

  it('skips deleted and incomplete sets', async () => {
    await seedSet({
      setUuid: 'good', weUuid: 'we-1', workoutUuid: 'wo-1',
      startTime: '2026-04-20T10:00:00Z',
      weight: 0, repetitions: 30, duration_seconds: null,
    });
    // Manually mark a second set as deleted.
    await db.workout_sets.put({
      uuid: 'deleted',
      workout_exercise_uuid: 'we-1',
      weight: 0, repetitions: 999, duration_seconds: null,
      min_target_reps: null, max_target_reps: null,
      rpe: null, rir: null, tag: null, comment: null,
      is_completed: true, is_pr: false, order_index: 1,
      _synced: true, _deleted: true,
    });
    await db.workout_sets.put({
      uuid: 'incomplete',
      workout_exercise_uuid: 'we-1',
      weight: 0, repetitions: 999, duration_seconds: null,
      min_target_reps: null, max_target_reps: null,
      rpe: null, rir: null, tag: null, comment: null,
      is_completed: false, is_pr: false, order_index: 2,
      _synced: true, _deleted: false,
    });

    const result = await getExerciseTimePRsLocal(PLANK_UUID);
    expect(result.longestHold!.duration_seconds).toBe(30);
  });

  it('returns empty when no usable sets exist', async () => {
    // Set with both repetitions and duration_seconds null → unusable.
    await seedSet({
      setUuid: 'set-1', weUuid: 'we-1', workoutUuid: 'wo-1',
      startTime: '2026-04-20T10:00:00Z',
      weight: 0, repetitions: null, duration_seconds: null,
    });

    const result = await getExerciseTimePRsLocal(PLANK_UUID);
    expect(result.longestHold).toBeNull();
    expect(result.progress).toHaveLength(0);
  });
});
