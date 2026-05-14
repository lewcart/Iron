import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/db/local';
import { exerciseFilterPredicate, getExerciseTimePRsLocal } from './useLocalDB';
import type { LocalExercise } from '@/db/local';

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
    image_count: 0,
    youtube_url: null,
    image_urls: null,
    has_sides: false,
    lateral_emphasis: false,
    secondary_weights: null,
    weight_source: null,
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
    excluded_from_pb: false,
    order_index: opts.orderIndex ?? 0,
    _synced: true,
    _updated_at: 0,
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
      is_completed: true, is_pr: false, excluded_from_pb: false, order_index: 1,
      _synced: true, _updated_at: 0, _deleted: true,
    });
    await db.workout_sets.put({
      uuid: 'incomplete',
      workout_exercise_uuid: 'we-1',
      weight: 0, repetitions: 999, duration_seconds: null,
      min_target_reps: null, max_target_reps: null,
      rpe: null, rir: null, tag: null, comment: null,
      is_completed: false, is_pr: false, excluded_from_pb: false, order_index: 2,
      _synced: true, _updated_at: 0, _deleted: false,
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

// Regression: post-migration-026 exercises store canonical slugs (delts,
// lats, quads) — never UI labels (shoulders, back, legs). The Add Exercise
// sheet in /workout passes UI labels straight to useExercises({ muscleGroup }),
// so the filter must expand UI keys to slugs. Before this fix, 5/6 chips
// (back, shoulders, arms, legs, abdominals) showed zero results.
function fakeExercise(opts: Partial<LocalExercise> & { uuid: string; title: string; primary_muscles: string[]; secondary_muscles?: string[] }): LocalExercise {
  return {
    everkinetic_id: 1,
    alias: [],
    description: null,
    secondary_muscles: [],
    equipment: [],
    steps: [],
    tips: [],
    is_custom: false,
    is_hidden: false,
    movement_pattern: null,
    tracking_mode: 'reps' as const,
    image_count: 0,
    youtube_url: null,
    image_urls: null,
    has_sides: false,
    lateral_emphasis: false,
    secondary_weights: null,
    weight_source: null,
    ...opts,
  } as LocalExercise;
}

describe('exerciseFilterPredicate — UI muscle-group keys', () => {
  const overheadPress = fakeExercise({ uuid: 'u1', title: 'Overhead Press', primary_muscles: ['delts'], secondary_muscles: ['triceps'] });
  const pullUp = fakeExercise({ uuid: 'u2', title: 'Pull Up', primary_muscles: ['lats'], secondary_muscles: ['biceps'] });
  const squat = fakeExercise({ uuid: 'u3', title: 'Squat', primary_muscles: ['quads'], secondary_muscles: ['glutes'] });
  const plank = fakeExercise({ uuid: 'u4', title: 'Plank', primary_muscles: ['core'] });
  const curl = fakeExercise({ uuid: 'u5', title: 'Curl', primary_muscles: ['biceps'] });
  const bench = fakeExercise({ uuid: 'u6', title: 'Bench Press', primary_muscles: ['chest', 'triceps'], secondary_muscles: ['delts'] });

  it('expands "shoulders" → delts (was the reported zero-results case)', () => {
    expect(exerciseFilterPredicate(overheadPress, { muscleGroup: 'shoulders' })).toBe(true);
    expect(exerciseFilterPredicate(squat, { muscleGroup: 'shoulders' })).toBe(false);
  });

  it('expands "back" → lats/rhomboids/etc.', () => {
    expect(exerciseFilterPredicate(pullUp, { muscleGroup: 'back' })).toBe(true);
    expect(exerciseFilterPredicate(squat, { muscleGroup: 'back' })).toBe(false);
  });

  it('expands "legs" → quads/glutes/etc.', () => {
    expect(exerciseFilterPredicate(squat, { muscleGroup: 'legs' })).toBe(true);
    expect(exerciseFilterPredicate(curl, { muscleGroup: 'legs' })).toBe(false);
  });

  it('expands "arms" → biceps/triceps/forearms', () => {
    expect(exerciseFilterPredicate(curl, { muscleGroup: 'arms' })).toBe(true);
    expect(exerciseFilterPredicate(squat, { muscleGroup: 'arms' })).toBe(false);
  });

  it('expands "abdominals" → core', () => {
    expect(exerciseFilterPredicate(plank, { muscleGroup: 'abdominals' })).toBe(true);
    expect(exerciseFilterPredicate(squat, { muscleGroup: 'abdominals' })).toBe(false);
  });

  it('matches via secondary muscles too', () => {
    // Bench Press has delts as secondary — should appear under "shoulders".
    expect(exerciseFilterPredicate(bench, { muscleGroup: 'shoulders' })).toBe(true);
  });

  it('still accepts a canonical slug directly', () => {
    expect(exerciseFilterPredicate(overheadPress, { muscleGroup: 'delts' })).toBe(true);
    expect(exerciseFilterPredicate(squat, { muscleGroup: 'delts' })).toBe(false);
  });

  it('hides is_hidden exercises regardless of filter', () => {
    const hidden = fakeExercise({ uuid: 'h1', title: 'Hidden', primary_muscles: ['delts'], is_hidden: true });
    expect(exerciseFilterPredicate(hidden, { muscleGroup: 'shoulders' })).toBe(false);
  });
});
