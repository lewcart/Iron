import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parsePlan,
  parseRoutine,
  parseRoutineExercise,
  parseRoutineSet,
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  listRoutines,
  createRoutine,
  updateRoutine,
  deleteRoutine,
  listRoutineExercises,
  addExerciseToRoutine,
  removeExerciseFromRoutine,
  listRoutineSets,
  addRoutineSet,
  startWorkoutFromRoutine,
} from '@/db/queries';
import type { DbRow } from '@/db/queries';

// Mock the DB module
vi.mock('@/db/db.js', () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

// Mock crypto.randomUUID for predictable UUIDs in tests
vi.mock('crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('test-uuid'),
}));

// ===== parsePlan =====

describe('parsePlan', () => {
  it('maps uuid and title', () => {
    const row: DbRow = { uuid: 'plan-1', title: 'Push Pull Legs' };
    const result = parsePlan(row);
    expect(result.uuid).toBe('plan-1');
    expect(result.title).toBe('Push Pull Legs');
  });

  it('handles null title', () => {
    const row: DbRow = { uuid: 'plan-1', title: null };
    expect(parsePlan(row).title).toBeNull();
  });
});

// ===== parseRoutine =====

describe('parseRoutine', () => {
  const baseRow: DbRow = {
    uuid: 'routine-1',
    workout_plan_uuid: 'plan-1',
    title: 'Push Day',
    comment: 'Upper body push',
    order_index: 0,
  };

  it('maps all fields correctly', () => {
    const result = parseRoutine(baseRow);
    expect(result.uuid).toBe('routine-1');
    expect(result.workout_plan_uuid).toBe('plan-1');
    expect(result.title).toBe('Push Day');
    expect(result.comment).toBe('Upper body push');
    expect(result.order_index).toBe(0);
  });

  it('handles null comment', () => {
    const row: DbRow = { ...baseRow, comment: null };
    expect(parseRoutine(row).comment).toBeNull();
  });

  it('handles null title', () => {
    const row: DbRow = { ...baseRow, title: null };
    expect(parseRoutine(row).title).toBeNull();
  });
});

// ===== parseRoutineExercise =====

describe('parseRoutineExercise', () => {
  const baseRow: DbRow = {
    uuid: 're-1',
    workout_routine_uuid: 'routine-1',
    exercise_uuid: 'ex-1',
    comment: null,
    order_index: 0,
  };

  it('maps all fields correctly', () => {
    const result = parseRoutineExercise(baseRow);
    expect(result.uuid).toBe('re-1');
    expect(result.workout_routine_uuid).toBe('routine-1');
    expect(result.exercise_uuid).toBe('ex-1');
    expect(result.comment).toBeNull();
    expect(result.order_index).toBe(0);
  });

  it('maps comment when present', () => {
    const row: DbRow = { ...baseRow, comment: 'Superset with rows' };
    expect(parseRoutineExercise(row).comment).toBe('Superset with rows');
  });
});

// ===== parseRoutineSet =====

describe('parseRoutineSet', () => {
  const baseRow: DbRow = {
    uuid: 'rs-1',
    workout_routine_exercise_uuid: 're-1',
    min_repetitions: 8,
    max_repetitions: 12,
    tag: null,
    comment: null,
    order_index: 0,
  };

  it('maps all fields correctly', () => {
    const result = parseRoutineSet(baseRow);
    expect(result.uuid).toBe('rs-1');
    expect(result.workout_routine_exercise_uuid).toBe('re-1');
    expect(result.min_repetitions).toBe(8);
    expect(result.max_repetitions).toBe(12);
    expect(result.tag).toBeNull();
    expect(result.comment).toBeNull();
    expect(result.order_index).toBe(0);
  });

  it('maps dropSet tag', () => {
    const row: DbRow = { ...baseRow, tag: 'dropSet' };
    expect(parseRoutineSet(row).tag).toBe('dropSet');
  });

  it('handles null repetition values', () => {
    const row: DbRow = { ...baseRow, min_repetitions: null, max_repetitions: null };
    const result = parseRoutineSet(row);
    expect(result.min_repetitions).toBeNull();
    expect(result.max_repetitions).toBeNull();
  });
});

// ===== DB query functions with mocked DB =====

describe('plan query functions', () => {
  let db: { query: ReturnType<typeof vi.fn>; queryOne: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = await import('@/db/db.js') as typeof db;
    db.query.mockResolvedValue([]);
    db.queryOne.mockResolvedValue(null);
  });

  describe('listPlans', () => {
    it('queries workout_plans table', async () => {
      await listPlans();
      const [sql] = db.query.mock.calls[0];
      expect(sql).toContain('workout_plans');
    });

    it('returns empty array when no rows', async () => {
      const result = await listPlans();
      expect(result).toEqual([]);
    });

    it('parses rows into WorkoutPlan objects', async () => {
      db.query.mockResolvedValueOnce([{ uuid: 'plan-1', title: 'PPL' }]);
      const result = await listPlans();
      expect(result).toHaveLength(1);
      expect(result[0].uuid).toBe('plan-1');
      expect(result[0].title).toBe('PPL');
    });
  });

  describe('getPlan', () => {
    it('queries by uuid', async () => {
      await getPlan('plan-abc');
      const [sql, params] = db.queryOne.mock.calls[0];
      expect(sql).toContain('workout_plans');
      expect(params).toContain('plan-abc');
    });

    it('returns undefined when not found', async () => {
      const result = await getPlan('missing');
      expect(result).toBeUndefined();
    });

    it('returns parsed plan when found', async () => {
      db.queryOne.mockResolvedValueOnce({ uuid: 'plan-1', title: 'Strength' });
      const result = await getPlan('plan-1');
      expect(result?.uuid).toBe('plan-1');
      expect(result?.title).toBe('Strength');
    });
  });

  describe('createPlan', () => {
    it('inserts into workout_plans', async () => {
      db.queryOne.mockResolvedValueOnce({ uuid: 'test-uuid', title: 'New Plan' });
      await createPlan('New Plan');
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('INSERT');
      expect(sql).toContain('workout_plans');
      expect(params).toContain('New Plan');
    });

    it('returns the created plan', async () => {
      db.queryOne.mockResolvedValueOnce({ uuid: 'test-uuid', title: 'New Plan' });
      const result = await createPlan('New Plan');
      expect(result.title).toBe('New Plan');
    });
  });

  describe('updatePlan', () => {
    it('updates title in workout_plans', async () => {
      db.queryOne.mockResolvedValueOnce({ uuid: 'plan-1', title: 'Updated' });
      await updatePlan('plan-1', { title: 'Updated' });
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('UPDATE');
      expect(sql).toContain('workout_plans');
      expect(params).toContain('Updated');
      expect(params).toContain('plan-1');
    });

    it('returns undefined when plan not found', async () => {
      db.queryOne.mockResolvedValueOnce(null);
      const result = await updatePlan('missing', { title: 'Title' });
      expect(result).toBeUndefined();
    });
  });

  describe('deletePlan', () => {
    it('deletes from workout_plans by uuid', async () => {
      await deletePlan('plan-1');
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('DELETE');
      expect(sql).toContain('workout_plans');
      expect(params).toContain('plan-1');
    });
  });
});

describe('routine query functions', () => {
  let db: { query: ReturnType<typeof vi.fn>; queryOne: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = await import('@/db/db.js') as typeof db;
    db.query.mockResolvedValue([]);
    db.queryOne.mockResolvedValue(null);
  });

  describe('listRoutines', () => {
    it('queries workout_routines by plan uuid', async () => {
      await listRoutines('plan-1');
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('workout_routines');
      expect(params).toContain('plan-1');
    });

    it('returns empty array when no rows', async () => {
      const result = await listRoutines('plan-1');
      expect(result).toEqual([]);
    });

    it('parses rows into WorkoutRoutine objects', async () => {
      db.query.mockResolvedValueOnce([{
        uuid: 'r-1',
        workout_plan_uuid: 'plan-1',
        title: 'Push',
        comment: null,
        order_index: 0,
      }]);
      const result = await listRoutines('plan-1');
      expect(result).toHaveLength(1);
      expect(result[0].uuid).toBe('r-1');
    });
  });

  describe('createRoutine', () => {
    it('inserts into workout_routines', async () => {
      db.queryOne
        .mockResolvedValueOnce({ max: 0 }) // for order_index query
        .mockResolvedValueOnce({ uuid: 'test-uuid', workout_plan_uuid: 'plan-1', title: 'Push', comment: null, order_index: 1 });
      await createRoutine('plan-1', 'Push');
      const insertCall = db.query.mock.calls[0];
      expect(insertCall[0]).toContain('INSERT');
      expect(insertCall[0]).toContain('workout_routines');
      expect(insertCall[1]).toContain('plan-1');
      expect(insertCall[1]).toContain('Push');
    });

    it('computes order_index from max + 1', async () => {
      db.queryOne
        .mockResolvedValueOnce({ max: 2 })
        .mockResolvedValueOnce({ uuid: 'test-uuid', workout_plan_uuid: 'plan-1', title: 'Legs', comment: null, order_index: 3 });
      await createRoutine('plan-1', 'Legs');
      const insertCall = db.query.mock.calls[0];
      expect(insertCall[1]).toContain(3); // order_index = max(2) + 1 = 3
    });

    it('defaults to order_index 0 when no existing routines', async () => {
      db.queryOne
        .mockResolvedValueOnce({ max: null })
        .mockResolvedValueOnce({ uuid: 'test-uuid', workout_plan_uuid: 'plan-1', title: 'Pull', comment: null, order_index: 0 });
      await createRoutine('plan-1', 'Pull');
      const insertCall = db.query.mock.calls[0];
      expect(insertCall[1]).toContain(0);
    });
  });

  describe('updateRoutine', () => {
    it('updates specified fields', async () => {
      db.queryOne.mockResolvedValueOnce({
        uuid: 'r-1', workout_plan_uuid: 'plan-1', title: 'Updated Push', comment: null, order_index: 0
      });
      await updateRoutine('r-1', { title: 'Updated Push' });
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('UPDATE');
      expect(sql).toContain('workout_routines');
      expect(params).toContain('Updated Push');
    });

    it('updates comment field', async () => {
      db.queryOne.mockResolvedValueOnce({
        uuid: 'r-1', workout_plan_uuid: 'plan-1', title: 'Push', comment: 'New comment', order_index: 0
      });
      await updateRoutine('r-1', { comment: 'New comment' });
      const [sql, params] = db.query.mock.calls[0];
      expect(params).toContain('New comment');
      expect(sql).toContain('comment');
    });

    it('updates orderIndex field', async () => {
      db.queryOne.mockResolvedValueOnce({
        uuid: 'r-1', workout_plan_uuid: 'plan-1', title: 'Push', comment: null, order_index: 2
      });
      await updateRoutine('r-1', { orderIndex: 2 });
      const [sql, params] = db.query.mock.calls[0];
      expect(params).toContain(2);
      expect(sql).toContain('order_index');
    });

    it('skips query when no fields provided', async () => {
      db.queryOne.mockResolvedValueOnce({
        uuid: 'r-1', workout_plan_uuid: 'plan-1', title: 'Push', comment: null, order_index: 0
      });
      await updateRoutine('r-1', {});
      expect(db.query.mock.calls).toHaveLength(0);
    });

    it('returns undefined when routine not found', async () => {
      db.queryOne.mockResolvedValueOnce(null);
      const result = await updateRoutine('missing', { title: 'X' });
      expect(result).toBeUndefined();
    });
  });

  describe('deleteRoutine', () => {
    it('deletes from workout_routines by uuid', async () => {
      await deleteRoutine('r-1');
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('DELETE');
      expect(sql).toContain('workout_routines');
      expect(params).toContain('r-1');
    });
  });
});

describe('routine exercise query functions', () => {
  let db: { query: ReturnType<typeof vi.fn>; queryOne: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = await import('@/db/db.js') as typeof db;
    db.query.mockResolvedValue([]);
    db.queryOne.mockResolvedValue(null);
  });

  describe('listRoutineExercises', () => {
    it('queries by routine uuid', async () => {
      await listRoutineExercises('routine-1');
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('workout_routine_exercises');
      expect(params).toContain('routine-1');
    });

    it('returns empty array when no rows', async () => {
      const result = await listRoutineExercises('routine-1');
      expect(result).toEqual([]);
    });
  });

  describe('addExerciseToRoutine', () => {
    it('inserts into workout_routine_exercises', async () => {
      db.queryOne
        .mockResolvedValueOnce({ max: null })
        .mockResolvedValueOnce({
          uuid: 'test-uuid', workout_routine_uuid: 'routine-1',
          exercise_uuid: 'ex-1', comment: null, order_index: 0
        });
      await addExerciseToRoutine('routine-1', 'ex-1');
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('INSERT');
      expect(sql).toContain('workout_routine_exercises');
      expect(params).toContain('routine-1');
      expect(params).toContain('ex-1');
    });
  });

  describe('removeExerciseFromRoutine', () => {
    it('deletes from workout_routine_exercises by uuid', async () => {
      await removeExerciseFromRoutine('re-1');
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('DELETE');
      expect(sql).toContain('workout_routine_exercises');
      expect(params).toContain('re-1');
    });
  });
});

describe('routine set query functions', () => {
  let db: { query: ReturnType<typeof vi.fn>; queryOne: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = await import('@/db/db.js') as typeof db;
    db.query.mockResolvedValue([]);
    db.queryOne.mockResolvedValue(null);
  });

  describe('listRoutineSets', () => {
    it('queries by routine exercise uuid', async () => {
      await listRoutineSets('re-1');
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('workout_routine_sets');
      expect(params).toContain('re-1');
    });

    it('returns empty array when no rows', async () => {
      const result = await listRoutineSets('re-1');
      expect(result).toEqual([]);
    });
  });

  describe('addRoutineSet', () => {
    it('inserts into workout_routine_sets with repetition data', async () => {
      db.queryOne
        .mockResolvedValueOnce({ max: null })
        .mockResolvedValueOnce({
          uuid: 'test-uuid', workout_routine_exercise_uuid: 're-1',
          min_repetitions: 8, max_repetitions: 12, tag: null, comment: null, order_index: 0
        });
      await addRoutineSet('re-1', { minRepetitions: 8, maxRepetitions: 12 });
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('INSERT');
      expect(sql).toContain('workout_routine_sets');
      expect(params).toContain('re-1');
      expect(params).toContain(8);
      expect(params).toContain(12);
    });

    it('inserts null for missing repetition data', async () => {
      db.queryOne
        .mockResolvedValueOnce({ max: null })
        .mockResolvedValueOnce({
          uuid: 'test-uuid', workout_routine_exercise_uuid: 're-1',
          min_repetitions: null, max_repetitions: null, tag: null, comment: null, order_index: 0
        });
      await addRoutineSet('re-1', {});
      const [, params] = db.query.mock.calls[0];
      expect(params).toContain(null);
    });
  });
});

// ===== startWorkoutFromRoutine =====

describe('startWorkoutFromRoutine', () => {
  let db: { query: ReturnType<typeof vi.fn>; queryOne: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = await import('@/db/db.js') as typeof db;
    db.query.mockResolvedValue([]);
    db.queryOne.mockResolvedValue(null);
  });

  it('creates a workout linked to the routine', async () => {
    // startWorkout -> INSERT workouts, then getWorkout
    db.queryOne.mockResolvedValueOnce({
      uuid: 'workout-1', start_time: '2026-03-16T10:00:00Z',
      end_time: null, title: null, comment: null, is_current: true,
    });
    // listRoutineExercises -> returns empty array
    db.query.mockResolvedValueOnce([]);

    const workout = await startWorkoutFromRoutine('routine-1');
    expect(workout.uuid).toBe('workout-1');

    // Check that workouts INSERT was called with routine uuid
    const insertCall = db.query.mock.calls[0];
    expect(insertCall[0]).toContain('INSERT');
    expect(insertCall[0]).toContain('workouts');
    expect(insertCall[1]).toContain('routine-1');
  });

  it('copies exercises and routine sets to the workout', async () => {
    // startWorkout INSERT
    db.query.mockResolvedValueOnce([]);
    // getWorkout
    db.queryOne.mockResolvedValueOnce({
      uuid: 'workout-1', start_time: '2026-03-16T10:00:00Z',
      end_time: null, title: null, comment: null, is_current: true,
    });
    // listRoutineExercises
    db.query.mockResolvedValueOnce([{
      uuid: 're-1', workout_routine_uuid: 'routine-1',
      exercise_uuid: 'ex-1', comment: null, order_index: 0
    }]);
    // INSERT workout_exercise (no return needed)
    db.query.mockResolvedValueOnce([]);
    // listRoutineSets for re-1
    db.query.mockResolvedValueOnce([{
      uuid: 'rs-1', workout_routine_exercise_uuid: 're-1',
      min_repetitions: 8, max_repetitions: 12, tag: null, comment: null, order_index: 0
    }]);
    // INSERT workout_set
    db.query.mockResolvedValueOnce([]);

    await startWorkoutFromRoutine('routine-1');

    // Check workout_exercises insert was called
    const exerciseInsert = db.query.mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT') && sql.includes('workout_exercises')
    );
    expect(exerciseInsert).toBeDefined();
    expect(exerciseInsert![1]).toContain('workout-1');
    expect(exerciseInsert![1]).toContain('ex-1');

    // Check workout_sets insert was called with target reps
    const setInsert = db.query.mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT') && sql.includes('workout_sets')
    );
    expect(setInsert).toBeDefined();
    expect(setInsert![1]).toContain(8);
    expect(setInsert![1]).toContain(12);
  });

  it('creates 3 default sets when routine has no sets defined', async () => {
    // startWorkout INSERT
    db.query.mockResolvedValueOnce([]);
    // getWorkout
    db.queryOne.mockResolvedValueOnce({
      uuid: 'workout-1', start_time: '2026-03-16T10:00:00Z',
      end_time: null, title: null, comment: null, is_current: true,
    });
    // listRoutineExercises - one exercise
    db.query.mockResolvedValueOnce([{
      uuid: 're-1', workout_routine_uuid: 'routine-1',
      exercise_uuid: 'ex-1', comment: null, order_index: 0
    }]);
    // INSERT workout_exercise
    db.query.mockResolvedValueOnce([]);
    // listRoutineSets - empty
    db.query.mockResolvedValueOnce([]);
    // 3x INSERT workout_sets (default)
    db.query.mockResolvedValue([]);

    await startWorkoutFromRoutine('routine-1');

    const setInserts = db.query.mock.calls.filter(
      ([sql]: [string]) => sql.includes('INSERT') && sql.includes('workout_sets')
    );
    expect(setInserts).toHaveLength(3);
  });

  it('handles routine with no exercises', async () => {
    // startWorkout INSERT
    db.query.mockResolvedValueOnce([]);
    // getWorkout
    db.queryOne.mockResolvedValueOnce({
      uuid: 'workout-1', start_time: '2026-03-16T10:00:00Z',
      end_time: null, title: null, comment: null, is_current: true,
    });
    // listRoutineExercises - empty
    db.query.mockResolvedValueOnce([]);

    const workout = await startWorkoutFromRoutine('routine-1');
    expect(workout.uuid).toBe('workout-1');

    const setInserts = db.query.mock.calls.filter(
      ([sql]: [string]) => sql.includes('INSERT') && sql.includes('workout_sets')
    );
    expect(setInserts).toHaveLength(0);
  });
});
