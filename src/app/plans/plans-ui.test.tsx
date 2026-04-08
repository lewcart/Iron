import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parsePlan,
  parseRoutine,
  parseRoutineExercise,
  listPlans,
  createPlan,
  listRoutines,
  createRoutine,
  listRoutineExercises,
  addExerciseToRoutine,
} from '@/db/queries';
import type { DbRow } from '@/db/queries';
import { formatSetsReps } from './utils';
import type { WorkoutRoutineSet } from '@/types';

// ─── Mock DB ──────────────────────────────────────────────────────────────────

vi.mock('@/db/db.js', () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

// ─── parsePlan ────────────────────────────────────────────────────────────────

describe('parsePlan', () => {
  const baseRow: DbRow = {
    uuid: 'plan-uuid-1',
    title: 'My 5-Day Split',
  };

  it('maps uuid and title', () => {
    const result = parsePlan(baseRow);
    expect(result.uuid).toBe('plan-uuid-1');
    expect(result.title).toBe('My 5-Day Split');
  });

  it('handles null title', () => {
    const row: DbRow = { ...baseRow, title: null };
    expect(parsePlan(row).title).toBeNull();
  });
});

// ─── parseRoutine ─────────────────────────────────────────────────────────────

describe('parseRoutine', () => {
  const baseRow: DbRow = {
    uuid: 'routine-uuid-1',
    workout_plan_uuid: 'plan-uuid-1',
    title: 'Push Day',
    comment: null,
    order_index: 0,
  };

  it('maps all fields', () => {
    const result = parseRoutine(baseRow);
    expect(result.uuid).toBe('routine-uuid-1');
    expect(result.workout_plan_uuid).toBe('plan-uuid-1');
    expect(result.title).toBe('Push Day');
    expect(result.comment).toBeNull();
    expect(result.order_index).toBe(0);
  });

  it('handles null title', () => {
    const row: DbRow = { ...baseRow, title: null };
    expect(parseRoutine(row).title).toBeNull();
  });

  it('maps comment when present', () => {
    const row: DbRow = { ...baseRow, comment: 'Monday workout' };
    expect(parseRoutine(row).comment).toBe('Monday workout');
  });

  it('maps order_index correctly', () => {
    const row: DbRow = { ...baseRow, order_index: 3 };
    expect(parseRoutine(row).order_index).toBe(3);
  });
});

// ─── parseRoutineExercise ─────────────────────────────────────────────────────

describe('parseRoutineExercise', () => {
  const baseRow: DbRow = {
    uuid: 're-uuid-1',
    workout_routine_uuid: 'routine-uuid-1',
    exercise_uuid: 'ex-uuid-1',
    comment: null,
    order_index: 0,
  };

  it('maps all fields', () => {
    const result = parseRoutineExercise(baseRow);
    expect(result.uuid).toBe('re-uuid-1');
    expect(result.workout_routine_uuid).toBe('routine-uuid-1');
    expect(result.exercise_uuid).toBe('ex-uuid-1');
    expect(result.comment).toBeNull();
    expect(result.order_index).toBe(0);
  });

  it('maps comment when present', () => {
    const row: DbRow = { ...baseRow, comment: 'Focus on form' };
    expect(parseRoutineExercise(row).comment).toBe('Focus on form');
  });
});

// ─── listPlans (SQL building with mocked db) ──────────────────────────────────

describe('listPlans', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@/db/db.js');
    vi.mocked(db.query).mockResolvedValue([]);
    vi.mocked(db.queryOne).mockResolvedValue(null);
  });

  it('queries workout_plans table', async () => {
    const db = await import('@/db/db.js');
    await listPlans();
    const [sql] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('workout_plans');
  });

  it('orders by created_at DESC', async () => {
    const db = await import('@/db/db.js');
    await listPlans();
    const [sql] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('ORDER BY');
  });

  it('returns empty array when no plans', async () => {
    const result = await listPlans();
    expect(result).toEqual([]);
  });

  it('maps rows to WorkoutPlan objects', async () => {
    const db = await import('@/db/db.js');
    vi.mocked(db.query).mockResolvedValueOnce([
      { uuid: 'plan-1', title: 'Push/Pull/Legs' },
    ]);
    const result = await listPlans();
    expect(result).toHaveLength(1);
    expect(result[0].uuid).toBe('plan-1');
    expect(result[0].title).toBe('Push/Pull/Legs');
  });
});

// ─── createPlan ───────────────────────────────────────────────────────────────

describe('createPlan', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@/db/db.js');
    vi.mocked(db.query).mockResolvedValue([]);
    vi.mocked(db.queryOne).mockResolvedValue({ uuid: 'new-plan-uuid', title: 'New Plan' });
  });

  it('inserts into workout_plans', async () => {
    const db = await import('@/db/db.js');
    await createPlan('New Plan');
    const [sql] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('INSERT INTO workout_plans');
  });

  it('passes title to insert', async () => {
    const db = await import('@/db/db.js');
    await createPlan('My Split');
    const [, params] = vi.mocked(db.query).mock.calls[0];
    expect(params).toContain('My Split');
  });
});

// ─── listRoutines ─────────────────────────────────────────────────────────────

describe('listRoutines', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@/db/db.js');
    vi.mocked(db.query).mockResolvedValue([]);
    vi.mocked(db.queryOne).mockResolvedValue(null);
  });

  it('queries workout_routines table', async () => {
    const db = await import('@/db/db.js');
    await listRoutines('plan-uuid-1');
    const [sql] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('workout_routines');
  });

  it('filters by plan uuid', async () => {
    const db = await import('@/db/db.js');
    await listRoutines('plan-uuid-1');
    const [, params] = vi.mocked(db.query).mock.calls[0];
    expect(params).toContain('plan-uuid-1');
  });

  it('orders by order_index', async () => {
    const db = await import('@/db/db.js');
    await listRoutines('plan-uuid-1');
    const [sql] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('order_index');
  });

  it('returns empty array when no routines', async () => {
    const result = await listRoutines('plan-uuid-1');
    expect(result).toEqual([]);
  });

  it('maps rows to WorkoutRoutine objects', async () => {
    const db = await import('@/db/db.js');
    vi.mocked(db.query).mockResolvedValueOnce([
      {
        uuid: 'routine-1',
        workout_plan_uuid: 'plan-uuid-1',
        title: 'Push Day',
        comment: null,
        order_index: 0,
      },
    ]);
    const result = await listRoutines('plan-uuid-1');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Push Day');
    expect(result[0].order_index).toBe(0);
  });
});

// ─── createRoutine ────────────────────────────────────────────────────────────

describe('createRoutine', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@/db/db.js');
    vi.mocked(db.query).mockResolvedValue([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce({ max: 1 }).mockResolvedValueOnce({
      uuid: 'new-routine-uuid',
      workout_plan_uuid: 'plan-uuid-1',
      title: 'Pull Day',
      comment: null,
      order_index: 2,
    });
  });

  it('inserts into workout_routines', async () => {
    const db = await import('@/db/db.js');
    await createRoutine('plan-uuid-1', 'Pull Day');
    const insertCall = vi.mocked(db.query).mock.calls.find(([sql]) =>
      (sql as string).includes('INSERT INTO workout_routines')
    );
    expect(insertCall).toBeDefined();
  });

  it('passes planUuid and title to insert', async () => {
    const db = await import('@/db/db.js');
    await createRoutine('plan-uuid-1', 'Pull Day');
    const insertCall = vi.mocked(db.query).mock.calls.find(([sql]) =>
      (sql as string).includes('INSERT INTO workout_routines')
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1];
    expect(params).toContain('plan-uuid-1');
    expect(params).toContain('Pull Day');
  });
});

// ─── listRoutineExercises ─────────────────────────────────────────────────────

describe('listRoutineExercises', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@/db/db.js');
    vi.mocked(db.query).mockResolvedValue([]);
    vi.mocked(db.queryOne).mockResolvedValue(null);
  });

  it('queries workout_routine_exercises table', async () => {
    const db = await import('@/db/db.js');
    await listRoutineExercises('routine-uuid-1');
    const [sql] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('workout_routine_exercises');
  });

  it('filters by routine uuid', async () => {
    const db = await import('@/db/db.js');
    await listRoutineExercises('routine-uuid-1');
    const [, params] = vi.mocked(db.query).mock.calls[0];
    expect(params).toContain('routine-uuid-1');
  });

  it('returns empty array when no exercises', async () => {
    const result = await listRoutineExercises('routine-uuid-1');
    expect(result).toEqual([]);
  });

  it('maps rows to WorkoutRoutineExercise objects', async () => {
    const db = await import('@/db/db.js');
    vi.mocked(db.query).mockResolvedValueOnce([
      {
        uuid: 're-1',
        workout_routine_uuid: 'routine-uuid-1',
        exercise_uuid: 'ex-uuid-1',
        comment: null,
        order_index: 0,
      },
    ]);
    const result = await listRoutineExercises('routine-uuid-1');
    expect(result).toHaveLength(1);
    expect(result[0].exercise_uuid).toBe('ex-uuid-1');
  });
});

// ─── addExerciseToRoutine ─────────────────────────────────────────────────────

describe('addExerciseToRoutine', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@/db/db.js');
    vi.mocked(db.query).mockResolvedValue([]);
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ max: 0 }) // max order
      .mockResolvedValueOnce({           // getRoutineExercise
        uuid: 'new-re-uuid',
        workout_routine_uuid: 'routine-uuid-1',
        exercise_uuid: 'ex-uuid-1',
        comment: null,
        order_index: 1,
      });
  });

  it('inserts into workout_routine_exercises', async () => {
    const db = await import('@/db/db.js');
    await addExerciseToRoutine('routine-uuid-1', 'ex-uuid-1');
    const insertCall = vi.mocked(db.query).mock.calls.find(([sql]) =>
      (sql as string).includes('INSERT INTO workout_routine_exercises')
    );
    expect(insertCall).toBeDefined();
  });

  it('passes routineUuid and exerciseUuid', async () => {
    const db = await import('@/db/db.js');
    await addExerciseToRoutine('routine-uuid-1', 'ex-uuid-1');
    const insertCall = vi.mocked(db.query).mock.calls.find(([sql]) =>
      (sql as string).includes('INSERT INTO workout_routine_exercises')
    );
    const params = insertCall![1];
    expect(params).toContain('routine-uuid-1');
    expect(params).toContain('ex-uuid-1');
  });
});

// ─── formatSetsReps ───────────────────────────────────────────────────────────

function makeSet(min: number | null, max: number | null): WorkoutRoutineSet {
  return {
    uuid: 'set-uuid',
    workout_routine_exercise_uuid: 're-uuid',
    min_repetitions: min,
    max_repetitions: max,
    tag: null,
    comment: null,
    order_index: 0,
  };
}

describe('formatSetsReps', () => {
  it('returns null for empty sets array', () => {
    expect(formatSetsReps([])).toBeNull();
  });

  it('shows set count only when no reps defined', () => {
    const sets = [makeSet(null, null), makeSet(null, null)];
    expect(formatSetsReps(sets)).toBe('2 sets');
  });

  it('shows singular "set" for one set with no reps', () => {
    expect(formatSetsReps([makeSet(null, null)])).toBe('1 set');
  });

  it('shows count × reps when min equals max', () => {
    const sets = [makeSet(10, 10), makeSet(10, 10), makeSet(10, 10)];
    expect(formatSetsReps(sets)).toBe('3 × 10');
  });

  it('shows count × range when reps vary', () => {
    const sets = [makeSet(8, 12), makeSet(8, 12), makeSet(8, 12)];
    expect(formatSetsReps(sets)).toBe('3 × 8–12');
  });

  it('spans across different set configurations', () => {
    const sets = [makeSet(6, 8), makeSet(8, 10), makeSet(10, 12)];
    expect(formatSetsReps(sets)).toBe('3 × 6–12');
  });

  it('handles mix of null and defined reps', () => {
    const sets = [makeSet(null, null), makeSet(8, 12)];
    expect(formatSetsReps(sets)).toBe('2 × 8–12');
  });
});
