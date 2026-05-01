import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseExercise,
  parseWorkout,
  parseWorkoutExercise,
  parseWorkoutSet,
  listExercises,
  getExercise,
  createCustomExercise,
  startWorkout,
  getCurrentWorkout,
  getWorkout,
  listWorkouts,
  finishWorkout,
  cancelWorkout,
  addExerciseToWorkout,
  getWorkoutExercise,
  listWorkoutExercises,
  logSet,
  updateSet,
  getWorkoutSet,
  listWorkoutSets,
  createInbodyScan,
  listInbodyScans,
  getInbodyScan,
  getLatestInbodyScan,
  updateInbodyScan,
  deleteInbodyScan,
  parseInbodyScan,
} from './queries';
import type { DbRow } from './queries';

// ===== parseExercise =====

describe('parseExercise', () => {
  const baseRow: DbRow = {
    uuid: 'ex-uuid-1',
    everkinetic_id: 42,
    title: 'Bench Press',
    alias: '["Chest Press"]',
    description: 'A compound chest exercise',
    primary_muscles: '["chest"]',
    secondary_muscles: '["shoulders","triceps"]',
    equipment: '["barbell","bench"]',
    steps: '["Lie on bench","Grip bar","Press up"]',
    tips: '["Keep back flat"]',
    is_custom: false,
    is_hidden: false,
  };

  it('maps all string fields correctly', () => {
    const result = parseExercise(baseRow);
    expect(result.uuid).toBe('ex-uuid-1');
    expect(result.everkinetic_id).toBe(42);
    expect(result.title).toBe('Bench Press');
    expect(result.description).toBe('A compound chest exercise');
  });

  it('parses JSON string arrays', () => {
    const result = parseExercise(baseRow);
    expect(result.alias).toEqual(['Chest Press']);
    expect(result.primary_muscles).toEqual(['chest']);
    expect(result.secondary_muscles).toEqual(['shoulders', 'triceps']);
    expect(result.equipment).toEqual(['barbell', 'bench']);
    expect(result.steps).toEqual(['Lie on bench', 'Grip bar', 'Press up']);
    expect(result.tips).toEqual(['Keep back flat']);
  });

  it('accepts already-parsed arrays (Neon returns arrays directly)', () => {
    const row: DbRow = {
      ...baseRow,
      alias: ['Chest Press'],
      primary_muscles: ['chest'],
      secondary_muscles: ['shoulders', 'triceps'],
      equipment: ['barbell', 'bench'],
      steps: ['Lie on bench'],
      tips: ['Keep back flat'],
    };
    const result = parseExercise(row);
    expect(result.primary_muscles).toEqual(['chest']);
    expect(result.alias).toEqual(['Chest Press']);
  });

  it('handles empty JSON string arrays', () => {
    const row: DbRow = { ...baseRow, alias: '[]', secondary_muscles: '[]', equipment: '[]', steps: '[]', tips: '[]' };
    const result = parseExercise(row);
    expect(result.alias).toEqual([]);
    expect(result.secondary_muscles).toEqual([]);
  });

  it('casts is_custom and is_hidden to boolean', () => {
    const result = parseExercise(baseRow);
    expect(result.is_custom).toBe(false);
    expect(result.is_hidden).toBe(false);
  });

  it('casts truthy values for is_custom and is_hidden', () => {
    const row: DbRow = { ...baseRow, is_custom: 1, is_hidden: 1 };
    const result = parseExercise(row);
    expect(result.is_custom).toBe(true);
    expect(result.is_hidden).toBe(true);
  });

  it('handles null description', () => {
    const row: DbRow = { ...baseRow, description: null };
    expect(parseExercise(row).description).toBeNull();
  });
});

// ===== parseWorkout =====

describe('parseWorkout', () => {
  const baseRow: DbRow = {
    uuid: 'wo-uuid-1',
    start_time: '2026-03-15T10:00:00.000Z',
    end_time: '2026-03-15T11:00:00.000Z',
    title: 'Monday Push',
    comment: 'Felt strong',
    is_current: false,
  };

  it('maps all fields correctly', () => {
    const result = parseWorkout(baseRow);
    expect(result.uuid).toBe('wo-uuid-1');
    expect(result.start_time).toBe('2026-03-15T10:00:00.000Z');
    expect(result.end_time).toBe('2026-03-15T11:00:00.000Z');
    expect(result.title).toBe('Monday Push');
    expect(result.comment).toBe('Felt strong');
    expect(result.is_current).toBe(false);
  });

  it('handles null end_time', () => {
    const row: DbRow = { ...baseRow, end_time: null };
    expect(parseWorkout(row).end_time).toBeNull();
  });

  it('handles null title and comment', () => {
    const row: DbRow = { ...baseRow, title: null, comment: null };
    const result = parseWorkout(row);
    expect(result.title).toBeNull();
    expect(result.comment).toBeNull();
  });

  it('casts is_current to boolean', () => {
    const row: DbRow = { ...baseRow, is_current: 1 };
    expect(parseWorkout(row).is_current).toBe(true);
  });
});

// ===== parseWorkoutExercise =====

describe('parseWorkoutExercise', () => {
  const baseRow: DbRow = {
    uuid: 'we-uuid-1',
    workout_uuid: 'wo-uuid-1',
    exercise_uuid: 'ex-uuid-1',
    comment: null,
    order_index: 0,
  };

  it('maps all fields correctly', () => {
    const result = parseWorkoutExercise(baseRow);
    expect(result.uuid).toBe('we-uuid-1');
    expect(result.workout_uuid).toBe('wo-uuid-1');
    expect(result.exercise_uuid).toBe('ex-uuid-1');
    expect(result.comment).toBeNull();
    expect(result.order_index).toBe(0);
  });

  it('maps comment when present', () => {
    const row: DbRow = { ...baseRow, comment: 'Superset with curls' };
    expect(parseWorkoutExercise(row).comment).toBe('Superset with curls');
  });
});

// ===== parseWorkoutSet =====

describe('parseWorkoutSet', () => {
  const baseRow: DbRow = {
    uuid: 'ws-uuid-1',
    workout_exercise_uuid: 'we-uuid-1',
    weight: '100.5',
    repetitions: 8,
    min_target_reps: null,
    max_target_reps: null,
    rpe: '8.5',
    tag: null,
    comment: null,
    is_completed: true,
    order_index: 0,
  };

  it('maps all fields correctly', () => {
    const result = parseWorkoutSet(baseRow);
    expect(result.uuid).toBe('ws-uuid-1');
    expect(result.workout_exercise_uuid).toBe('we-uuid-1');
    expect(result.weight).toBe(100.5);
    expect(result.repetitions).toBe(8);
    expect(result.rpe).toBe(8.5);
    expect(result.is_completed).toBe(true);
    expect(result.order_index).toBe(0);
  });

  it('parses weight as float', () => {
    const row: DbRow = { ...baseRow, weight: '75.25' };
    expect(parseWorkoutSet(row).weight).toBe(75.25);
  });

  it('parses rpe as float', () => {
    const row: DbRow = { ...baseRow, rpe: '7.5' };
    expect(parseWorkoutSet(row).rpe).toBe(7.5);
  });

  it('returns null for missing weight', () => {
    const row: DbRow = { ...baseRow, weight: null };
    expect(parseWorkoutSet(row).weight).toBeNull();
  });

  it('returns null for missing rpe', () => {
    const row: DbRow = { ...baseRow, rpe: null };
    expect(parseWorkoutSet(row).rpe).toBeNull();
  });

  it('maps tag values', () => {
    const dropSet: DbRow = { ...baseRow, tag: 'dropSet' };
    expect(parseWorkoutSet(dropSet).tag).toBe('dropSet');

    const failure: DbRow = { ...baseRow, tag: 'failure' };
    expect(parseWorkoutSet(failure).tag).toBe('failure');
  });

  it('maps target rep ranges', () => {
    const row: DbRow = { ...baseRow, min_target_reps: 8, max_target_reps: 12 };
    const result = parseWorkoutSet(row);
    expect(result.min_target_reps).toBe(8);
    expect(result.max_target_reps).toBe(12);
  });

  it('casts is_completed to boolean', () => {
    const row: DbRow = { ...baseRow, is_completed: 0 };
    expect(parseWorkoutSet(row).is_completed).toBe(false);
  });
});

// ===== listExercises (SQL building with mocked db) =====

vi.mock('./db.js', () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

describe('listExercises', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValue([]);
  });

  it('includes is_hidden filter by default', async () => {
    const db = await import('./db.js');
    await listExercises();
    const [sql] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('is_hidden = false');
  });

  it('omits is_hidden filter when includeHidden is true', async () => {
    const db = await import('./db.js');
    await listExercises({ includeHidden: true });
    const [sql] = vi.mocked(db.query).mock.calls[0];
    expect(sql).not.toContain('is_hidden = false');
  });

  it('adds search filter when search option provided', async () => {
    const db = await import('./db.js');
    await listExercises({ search: 'bench' });
    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('ILIKE');
    expect(params).toContain('%bench%');
  });

  it('adds muscle group filter when muscleGroup provided', async () => {
    const db = await import('./db.js');
    await listExercises({ muscleGroup: 'chest' });
    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('primary_muscles');
    expect(sql).toContain('secondary_muscles');
    // Post-canonicalization (migration 026): JSONB containment match against
    // the canonical 'chest' slug, not substring ILIKE.
    expect(sql).toContain('@>');
    expect(params).toContain(JSON.stringify(['chest']));
  });

  it('includes ORDER BY clause', async () => {
    const db = await import('./db.js');
    await listExercises();
    const [sql] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('ORDER BY');
  });

  it('returns empty array when no rows found', async () => {
    const result = await listExercises();
    expect(result).toEqual([]);
  });

  it('returns parsed exercises when rows exist', async () => {
    const db = await import('./db.js');
    const exerciseRow: DbRow = {
      uuid: 'ex-uuid-1',
      everkinetic_id: 1,
      title: 'Squat',
      alias: '[]',
      description: null,
      primary_muscles: '["quadriceps"]',
      secondary_muscles: '[]',
      equipment: '["barbell"]',
      steps: '[]',
      tips: '[]',
      is_custom: false,
      is_hidden: false,
    };
    vi.mocked(db.query).mockResolvedValueOnce([exerciseRow]);
    const result = await listExercises();
    expect(result).toHaveLength(1);
    expect(result[0].uuid).toBe('ex-uuid-1');
    expect(result[0].title).toBe('Squat');
  });
});

// ===== getExercise =====

describe('getExercise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries by uuid and returns parsed exercise', async () => {
    const db = await import('./db.js');
    const exerciseRow: DbRow = {
      uuid: 'ex-uuid-42',
      everkinetic_id: 99,
      title: 'Deadlift',
      alias: '[]',
      description: 'Hip hinge movement',
      primary_muscles: '["hamstrings"]',
      secondary_muscles: '["glutes"]',
      equipment: '["barbell"]',
      steps: '[]',
      tips: '[]',
      is_custom: false,
      is_hidden: false,
    };
    vi.mocked(db.queryOne).mockResolvedValueOnce(exerciseRow);
    const result = await getExercise('ex-uuid-42');
    expect(vi.mocked(db.queryOne).mock.calls[0][0]).toContain('exercises');
    expect(vi.mocked(db.queryOne).mock.calls[0][1]).toEqual(['ex-uuid-42']);
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe('ex-uuid-42');
    expect(result!.title).toBe('Deadlift');
    expect(result!.description).toBe('Hip hinge movement');
  });

  it('returns null when exercise not found', async () => {
    const db = await import('./db.js');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);
    const result = await getExercise('nonexistent-uuid');
    expect(result).toBeNull();
  });
});

// ===== createCustomExercise =====

describe('createCustomExercise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts exercise and returns the created exercise', async () => {
    const db = await import('./db.js');
    const createdRow: DbRow = {
      uuid: 'new-ex-uuid',
      everkinetic_id: 10001,
      title: 'Custom Curl',
      alias: '[]',
      description: 'My custom exercise',
      primary_muscles: '["biceps"]',
      secondary_muscles: '[]',
      equipment: '["dumbbell"]',
      steps: '["Step 1"]',
      tips: '["Tip 1"]',
      is_custom: true,
      is_hidden: false,
    };
    // createCustomExercise calls query() for INSERT, then queryOne() for getExercise
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce(createdRow);

    const result = await createCustomExercise({
      title: 'Custom Curl',
      description: 'My custom exercise',
      primaryMuscles: ['biceps'],
      secondaryMuscles: [],
      equipment: ['dumbbell'],
      steps: ['Step 1'],
      tips: ['Tip 1'],
    });

    const [insertSql, insertParams] = vi.mocked(db.query).mock.calls[0];
    expect(insertSql).toContain('INSERT INTO exercises');
    expect(insertParams).toContain('Custom Curl');
    expect(insertParams).toContain('My custom exercise');
    expect(insertParams).toContain(JSON.stringify(['biceps']));
    expect(result.title).toBe('Custom Curl');
    expect(result.is_custom).toBe(true);
  });

  it('uses defaults for optional fields', async () => {
    const db = await import('./db.js');
    const createdRow: DbRow = {
      uuid: 'new-ex-uuid-2',
      everkinetic_id: 10001,
      title: 'Minimal Exercise',
      alias: '[]',
      description: null,
      primary_muscles: '["chest"]',
      secondary_muscles: '[]',
      equipment: '[]',
      steps: '[]',
      tips: '[]',
      is_custom: true,
      is_hidden: false,
    };
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce(createdRow);

    const result = await createCustomExercise({
      title: 'Minimal Exercise',
      primaryMuscles: ['chest'],
    });

    const [, insertParams] = vi.mocked(db.query).mock.calls[0];
    // description defaults to null
    expect(insertParams).toContain(null);
    // secondaryMuscles, equipment, steps, tips default to []
    expect(insertParams).toContain(JSON.stringify([]));
    expect(result.title).toBe('Minimal Exercise');
  });
});

// ===== startWorkout =====

describe('startWorkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts workout and returns parsed workout', async () => {
    const db = await import('./db.js');
    const workoutRow: DbRow = {
      uuid: 'wo-uuid-new',
      start_time: '2026-03-16T08:00:00.000Z',
      end_time: null,
      title: null,
      comment: null,
      is_current: true,
    };
    // startWorkout calls query() for UPDATE (deactivate current), then INSERT, then queryOne() for getWorkout
    vi.mocked(db.query).mockResolvedValueOnce([]); // UPDATE
    vi.mocked(db.query).mockResolvedValueOnce([]); // INSERT
    vi.mocked(db.queryOne).mockResolvedValueOnce(workoutRow);

    const result = await startWorkout();

    const [insertSql, insertParams] = vi.mocked(db.query).mock.calls[1];
    expect(insertSql).toContain('INSERT INTO workouts');
    expect(insertSql).toContain('is_current');
    // routineUuid defaults to null
    expect(insertParams).toContain(null);
    expect(result.is_current).toBe(true);
    expect(result.end_time).toBeNull();
  });

  it('passes routineUuid when provided', async () => {
    const db = await import('./db.js');
    const workoutRow: DbRow = {
      uuid: 'wo-uuid-with-routine',
      start_time: '2026-03-16T08:00:00.000Z',
      end_time: null,
      title: null,
      comment: null,
      is_current: true,
    };
    vi.mocked(db.query).mockResolvedValueOnce([]); // UPDATE
    vi.mocked(db.query).mockResolvedValueOnce([]); // INSERT
    vi.mocked(db.queryOne).mockResolvedValueOnce(workoutRow);

    await startWorkout('routine-uuid-1');

    const [, insertParams] = vi.mocked(db.query).mock.calls[1];
    expect(insertParams).toContain('routine-uuid-1');
  });
});

// ===== getCurrentWorkout =====

describe('getCurrentWorkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries for is_current = true and returns parsed workout', async () => {
    const db = await import('./db.js');
    const workoutRow: DbRow = {
      uuid: 'wo-current',
      start_time: '2026-03-16T09:00:00.000Z',
      end_time: null,
      title: null,
      comment: null,
      is_current: true,
    };
    vi.mocked(db.queryOne).mockResolvedValueOnce(workoutRow);

    const result = await getCurrentWorkout();

    const [sql] = vi.mocked(db.queryOne).mock.calls[0];
    expect(sql).toContain('is_current = true');
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe('wo-current');
    expect(result!.is_current).toBe(true);
  });

  it('returns null when no current workout', async () => {
    const db = await import('./db.js');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);

    const result = await getCurrentWorkout();
    expect(result).toBeNull();
  });
});

// ===== getWorkout =====

describe('getWorkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries by uuid and returns parsed workout', async () => {
    const db = await import('./db.js');
    const workoutRow: DbRow = {
      uuid: 'wo-uuid-abc',
      start_time: '2026-03-16T09:00:00.000Z',
      end_time: '2026-03-16T10:00:00.000Z',
      title: 'Pull Day',
      comment: null,
      is_current: false,
    };
    vi.mocked(db.queryOne).mockResolvedValueOnce(workoutRow);

    const result = await getWorkout('wo-uuid-abc');

    expect(vi.mocked(db.queryOne).mock.calls[0][0]).toContain('workouts');
    expect(vi.mocked(db.queryOne).mock.calls[0][1]).toEqual(['wo-uuid-abc']);
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe('wo-uuid-abc');
    expect(result!.title).toBe('Pull Day');
  });

  it('returns null when workout not found', async () => {
    const db = await import('./db.js');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);

    const result = await getWorkout('missing-uuid');
    expect(result).toBeNull();
  });
});

// ===== listWorkouts =====

describe('listWorkouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries completed workouts (is_current = false) by default', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    await listWorkouts();

    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('is_current = false');
    expect(sql).toContain('ORDER BY w.start_time DESC');
    expect(params).toEqual([]);
  });

  it('adds LIMIT clause when limit option provided', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    await listWorkouts({ limit: 10 });

    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('LIMIT');
    expect(params).toContain(10);
  });

  it('adds OFFSET clause when offset option provided', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    await listWorkouts({ offset: 5 });

    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('OFFSET');
    expect(params).toContain(5);
  });

  it('adds since filter when since option provided', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    const sinceDate = new Date('2026-01-01T00:00:00.000Z');
    await listWorkouts({ since: sinceDate });

    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('start_time >=');
    expect(params).toContain('2026-01-01T00:00:00.000Z');
  });

  it('combines limit and offset correctly with sequential param numbers', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    await listWorkouts({ limit: 20, offset: 40 });

    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('LIMIT $1');
    expect(sql).toContain('OFFSET $2');
    expect(params).toEqual([20, 40]);
  });

  it('combines since, limit, and offset with sequential param numbers', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    const sinceDate = new Date('2026-01-01T00:00:00.000Z');
    await listWorkouts({ since: sinceDate, limit: 10, offset: 0 });

    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('start_time >= $1');
    expect(sql).toContain('LIMIT $2');
    // offset: 0 is falsy, so no OFFSET clause expected
    expect(params).toEqual(['2026-01-01T00:00:00.000Z', 10]);
  });

  it('returns empty array when no workouts found', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    const result = await listWorkouts();
    expect(result).toEqual([]);
  });

  it('returns parsed workouts', async () => {
    const db = await import('./db.js');
    const workoutRow: DbRow = {
      uuid: 'wo-list-1',
      start_time: '2026-03-10T09:00:00.000Z',
      end_time: '2026-03-10T10:30:00.000Z',
      title: null,
      comment: null,
      is_current: false,
    };
    vi.mocked(db.query).mockResolvedValueOnce([workoutRow]);

    const result = await listWorkouts();
    expect(result).toHaveLength(1);
    expect(result[0].uuid).toBe('wo-list-1');
    expect(result[0].is_current).toBe(false);
  });
});

// ===== finishWorkout =====

describe('finishWorkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes empty exercises, updates workout, then fetches result', async () => {
    const db = await import('./db.js');
    const finishedRow: DbRow = {
      uuid: 'wo-finish-uuid',
      start_time: '2026-03-16T09:00:00.000Z',
      end_time: '2026-03-16T10:00:00.000Z',
      title: null,
      comment: null,
      is_current: false,
    };
    // finishWorkout calls query() twice (DELETE, UPDATE), then queryOne() for getWorkout
    vi.mocked(db.query).mockResolvedValueOnce([]); // DELETE
    vi.mocked(db.query).mockResolvedValueOnce([]); // UPDATE
    vi.mocked(db.queryOne).mockResolvedValueOnce(finishedRow);

    const result = await finishWorkout('wo-finish-uuid');

    expect(vi.mocked(db.query).mock.calls).toHaveLength(2);

    const [deleteSql, deleteParams] = vi.mocked(db.query).mock.calls[0];
    expect(deleteSql).toContain('DELETE FROM workout_exercises');
    expect(deleteSql).toContain('workout_uuid = $1');
    expect(deleteParams).toEqual(['wo-finish-uuid']);

    const [updateSql, updateParams] = vi.mocked(db.query).mock.calls[1];
    expect(updateSql).toContain('UPDATE workouts');
    expect(updateSql).toContain('is_current = false');
    expect(updateParams).toContain('wo-finish-uuid');

    expect(result.uuid).toBe('wo-finish-uuid');
    expect(result.is_current).toBe(false);
    expect(result.end_time).not.toBeNull();
  });
});

// ===== cancelWorkout =====

describe('cancelWorkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the workout by uuid', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    await cancelWorkout('wo-cancel-uuid');

    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('DELETE FROM workouts');
    expect(sql).toContain('uuid = $1');
    expect(params).toEqual(['wo-cancel-uuid']);
  });

  it('returns void', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    const result = await cancelWorkout('wo-cancel-uuid');
    expect(result).toBeUndefined();
  });
});

// ===== addExerciseToWorkout =====

describe('addExerciseToWorkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts exercise with next order index and creates default 3 sets', async () => {
    const db = await import('./db.js');
    const workoutExerciseRow: DbRow = {
      uuid: 'we-uuid-new',
      workout_uuid: 'wo-uuid-1',
      exercise_uuid: 'ex-uuid-1',
      comment: null,
      order_index: 0,
    };

    // addExerciseToWorkout calls:
    // 1. queryOne() for MAX(order_index)
    // 2. query() for INSERT workout_exercises
    // 3. query() for history sets
    // 4. query() x3 for INSERT workout_sets (default 3)
    // 5. queryOne() for getWorkoutExercise
    vi.mocked(db.queryOne).mockResolvedValueOnce({ max: null }); // no existing exercises
    vi.mocked(db.query).mockResolvedValueOnce([]); // INSERT workout_exercises
    vi.mocked(db.query).mockResolvedValueOnce([]); // history query (empty = default 3 sets)
    vi.mocked(db.query).mockResolvedValueOnce([]); // INSERT set 0
    vi.mocked(db.query).mockResolvedValueOnce([]); // INSERT set 1
    vi.mocked(db.query).mockResolvedValueOnce([]); // INSERT set 2
    vi.mocked(db.queryOne).mockResolvedValueOnce(workoutExerciseRow);

    const result = await addExerciseToWorkout('wo-uuid-1', 'ex-uuid-1');

    // Verify INSERT into workout_exercises
    const insertExerciseSql = vi.mocked(db.query).mock.calls[0][0];
    const insertExerciseParams = vi.mocked(db.query).mock.calls[0][1];
    expect(insertExerciseSql).toContain('INSERT INTO workout_exercises');
    expect(insertExerciseParams).toContain('wo-uuid-1');
    expect(insertExerciseParams).toContain('ex-uuid-1');
    // order_index should be 0 (max was null => -1 + 1 = 0)
    expect(insertExerciseParams).toContain(0);

    // Verify 3 set inserts
    const setInserts = vi.mocked(db.query).mock.calls.filter(
      ([sql]) => sql.includes('INSERT INTO workout_sets'),
    );
    expect(setInserts).toHaveLength(3);

    expect(result.uuid).toBe('we-uuid-new');
    expect(result.workout_uuid).toBe('wo-uuid-1');
  });

  it('uses median of history to determine set count', async () => {
    const db = await import('./db.js');
    const workoutExerciseRow: DbRow = {
      uuid: 'we-uuid-hist',
      workout_uuid: 'wo-uuid-1',
      exercise_uuid: 'ex-uuid-1',
      comment: null,
      order_index: 1,
    };

    // history returns 2 previous workouts with 4 and 6 sets => avg = 5
    const historyRows = [{ set_count: '4' }, { set_count: '6' }];
    vi.mocked(db.queryOne).mockResolvedValueOnce({ max: 0 }); // existing order index
    vi.mocked(db.query).mockResolvedValueOnce([]); // INSERT workout_exercises
    vi.mocked(db.query).mockResolvedValueOnce(historyRows); // history: avg 5 sets
    // 5 set inserts
    for (let i = 0; i < 5; i++) {
      vi.mocked(db.query).mockResolvedValueOnce([]);
    }
    vi.mocked(db.queryOne).mockResolvedValueOnce(workoutExerciseRow);

    await addExerciseToWorkout('wo-uuid-1', 'ex-uuid-1');

    const setInserts = vi.mocked(db.query).mock.calls.filter(
      ([sql]) => sql.includes('INSERT INTO workout_sets'),
    );
    expect(setInserts).toHaveLength(5);
  });

  it('increments order_index from existing max', async () => {
    const db = await import('./db.js');
    const workoutExerciseRow: DbRow = {
      uuid: 'we-uuid-order',
      workout_uuid: 'wo-uuid-1',
      exercise_uuid: 'ex-uuid-2',
      comment: null,
      order_index: 3,
    };

    vi.mocked(db.queryOne).mockResolvedValueOnce({ max: 2 }); // existing max is 2
    vi.mocked(db.query).mockResolvedValueOnce([]); // INSERT workout_exercises
    vi.mocked(db.query).mockResolvedValueOnce([]); // history (empty)
    vi.mocked(db.query).mockResolvedValueOnce([]); // set 0
    vi.mocked(db.query).mockResolvedValueOnce([]); // set 1
    vi.mocked(db.query).mockResolvedValueOnce([]); // set 2
    vi.mocked(db.queryOne).mockResolvedValueOnce(workoutExerciseRow);

    await addExerciseToWorkout('wo-uuid-1', 'ex-uuid-2');

    const [, insertParams] = vi.mocked(db.query).mock.calls[0];
    // order_index should be 3 (max was 2 => 2 + 1 = 3)
    expect(insertParams).toContain(3);
  });
});

// ===== getWorkoutExercise =====

describe('getWorkoutExercise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries by uuid and returns parsed workout exercise', async () => {
    const db = await import('./db.js');
    const weRow: DbRow = {
      uuid: 'we-uuid-x',
      workout_uuid: 'wo-uuid-1',
      exercise_uuid: 'ex-uuid-1',
      comment: null,
      order_index: 2,
    };
    vi.mocked(db.queryOne).mockResolvedValueOnce(weRow);

    const result = await getWorkoutExercise('we-uuid-x');

    expect(vi.mocked(db.queryOne).mock.calls[0][0]).toContain('workout_exercises');
    expect(vi.mocked(db.queryOne).mock.calls[0][1]).toEqual(['we-uuid-x']);
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe('we-uuid-x');
    expect(result!.order_index).toBe(2);
  });

  it('returns null when not found', async () => {
    const db = await import('./db.js');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);

    const result = await getWorkoutExercise('missing-uuid');
    expect(result).toBeNull();
  });
});

// ===== listWorkoutExercises =====

describe('listWorkoutExercises', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries by workout uuid and returns exercises ordered by order_index', async () => {
    const db = await import('./db.js');
    const rows: DbRow[] = [
      { uuid: 'we-1', workout_uuid: 'wo-1', exercise_uuid: 'ex-1', comment: null, order_index: 0 },
      { uuid: 'we-2', workout_uuid: 'wo-1', exercise_uuid: 'ex-2', comment: null, order_index: 1 },
    ];
    vi.mocked(db.query).mockResolvedValueOnce(rows);

    const result = await listWorkoutExercises('wo-1');

    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('workout_exercises');
    expect(sql).toContain('workout_uuid = $1');
    expect(sql).toContain('order_index');
    expect(params).toEqual(['wo-1']);
    expect(result).toHaveLength(2);
    expect(result[0].uuid).toBe('we-1');
    expect(result[1].uuid).toBe('we-2');
  });

  it('returns empty array when no exercises', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    const result = await listWorkoutExercises('wo-empty');
    expect(result).toEqual([]);
  });
});

// ===== logSet =====

describe('logSet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts set with auto-incremented order_index and returns parsed set', async () => {
    const db = await import('./db.js');
    const setRow: DbRow = {
      uuid: 'ws-uuid-new',
      workout_exercise_uuid: 'we-uuid-1',
      weight: '80',
      repetitions: 10,
      min_target_reps: null,
      max_target_reps: null,
      rpe: null,
      tag: null,
      comment: null,
      is_completed: true,
      order_index: 0,
    };
    // logSet calls queryOne() for MAX(order_index), query() for INSERT, queryOne() for getWorkoutSet
    vi.mocked(db.queryOne).mockResolvedValueOnce({ max: null }); // no existing sets
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce(setRow);

    const result = await logSet({
      workoutExerciseUuid: 'we-uuid-1',
      weight: 80,
      repetitions: 10,
    });

    const [insertSql, insertParams] = vi.mocked(db.query).mock.calls[0];
    expect(insertSql).toContain('INSERT INTO workout_sets');
    expect(insertSql).toContain('is_completed');
    expect(insertParams).toContain('we-uuid-1');
    expect(insertParams).toContain(80);
    expect(insertParams).toContain(10);
    // order_index = 0 (max null => -1 + 1 = 0)
    expect(insertParams).toContain(0);
    // is_completed is true (literal in SQL, not param)
    expect(result.is_completed).toBe(true);
    expect(result.weight).toBe(80);
    expect(result.repetitions).toBe(10);
  });

  it('uses provided orderIndex when given', async () => {
    const db = await import('./db.js');
    const setRow: DbRow = {
      uuid: 'ws-uuid-ordered',
      workout_exercise_uuid: 'we-uuid-1',
      weight: '60',
      repetitions: 12,
      min_target_reps: null,
      max_target_reps: null,
      rpe: null,
      tag: null,
      comment: null,
      is_completed: true,
      order_index: 5,
    };
    // When orderIndex is provided, queryOne for MAX is skipped
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce(setRow);

    await logSet({
      workoutExerciseUuid: 'we-uuid-1',
      weight: 60,
      repetitions: 12,
      orderIndex: 5,
    });

    // queryOne should only be called once (for getWorkoutSet at the end)
    expect(vi.mocked(db.queryOne).mock.calls).toHaveLength(1);
    const [, insertParams] = vi.mocked(db.query).mock.calls[0];
    expect(insertParams).toContain(5);
  });

  it('includes optional rpe and tag when provided', async () => {
    const db = await import('./db.js');
    const setRow: DbRow = {
      uuid: 'ws-uuid-rpe',
      workout_exercise_uuid: 'we-uuid-1',
      weight: '100',
      repetitions: 5,
      min_target_reps: null,
      max_target_reps: null,
      rpe: '9',
      tag: 'failure',
      comment: null,
      is_completed: true,
      order_index: 0,
    };
    vi.mocked(db.queryOne).mockResolvedValueOnce({ max: null });
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce(setRow);

    await logSet({
      workoutExerciseUuid: 'we-uuid-1',
      weight: 100,
      repetitions: 5,
      rpe: 9,
      tag: 'failure',
    });

    const [, insertParams] = vi.mocked(db.query).mock.calls[0];
    expect(insertParams).toContain(9);
    expect(insertParams).toContain('failure');
  });

  it('sets rpe and tag to null when not provided', async () => {
    const db = await import('./db.js');
    const setRow: DbRow = {
      uuid: 'ws-uuid-nulls',
      workout_exercise_uuid: 'we-uuid-1',
      weight: '50',
      repetitions: 8,
      min_target_reps: null,
      max_target_reps: null,
      rpe: null,
      tag: null,
      comment: null,
      is_completed: true,
      order_index: 0,
    };
    vi.mocked(db.queryOne).mockResolvedValueOnce({ max: null });
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce(setRow);

    await logSet({
      workoutExerciseUuid: 'we-uuid-1',
      weight: 50,
      repetitions: 8,
    });

    const [, insertParams] = vi.mocked(db.query).mock.calls[0];
    // rpe || null and tag || null both become null
    expect(insertParams).toContain(null);
  });
});

// ===== updateSet =====

describe('updateSet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds SET clause with only provided fields and returns updated set', async () => {
    const db = await import('./db.js');
    const setRow: DbRow = {
      uuid: 'ws-update-uuid',
      workout_exercise_uuid: 'we-uuid-1',
      weight: '90',
      repetitions: 8,
      min_target_reps: null,
      max_target_reps: null,
      rpe: null,
      tag: null,
      comment: null,
      is_completed: true,
      order_index: 0,
    };
    // updateSet calls query() for UPDATE, then queryOne() for getWorkoutSet
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce(setRow);

    const result = await updateSet('ws-update-uuid', { weight: 90, repetitions: 8 });

    const [updateSql, updateParams] = vi.mocked(db.query).mock.calls[0];
    expect(updateSql).toContain('UPDATE workout_sets');
    expect(updateSql).toContain('weight = $1');
    expect(updateSql).toContain('repetitions = $2');
    expect(updateSql).toContain('WHERE uuid = $3');
    expect(updateParams).toEqual([90, 8, 'ws-update-uuid']);
    expect(result.weight).toBe(90);
  });

  it('updates only rpe when provided', async () => {
    const db = await import('./db.js');
    const setRow: DbRow = {
      uuid: 'ws-rpe-uuid',
      workout_exercise_uuid: 'we-uuid-1',
      weight: '80',
      repetitions: 10,
      min_target_reps: null,
      max_target_reps: null,
      rpe: '8',
      tag: null,
      comment: null,
      is_completed: true,
      order_index: 0,
    };
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce(setRow);

    await updateSet('ws-rpe-uuid', { rpe: 8 });

    const [updateSql, updateParams] = vi.mocked(db.query).mock.calls[0];
    expect(updateSql).toContain('rpe = $1');
    expect(updateSql).toContain('WHERE uuid = $2');
    expect(updateParams).toEqual([8, 'ws-rpe-uuid']);
  });

  it('updates tag and isCompleted', async () => {
    const db = await import('./db.js');
    const setRow: DbRow = {
      uuid: 'ws-tag-uuid',
      workout_exercise_uuid: 'we-uuid-1',
      weight: null,
      repetitions: null,
      min_target_reps: null,
      max_target_reps: null,
      rpe: null,
      tag: 'dropSet',
      comment: null,
      is_completed: true,
      order_index: 0,
    };
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce(setRow);

    await updateSet('ws-tag-uuid', { tag: 'dropSet', isCompleted: true });

    const [updateSql, updateParams] = vi.mocked(db.query).mock.calls[0];
    expect(updateSql).toContain('tag = $1');
    expect(updateSql).toContain('is_completed = $2');
    expect(updateParams).toEqual(['dropSet', true, 'ws-tag-uuid']);
  });

  it('skips query when no fields provided and still returns current set', async () => {
    const db = await import('./db.js');
    const setRow: DbRow = {
      uuid: 'ws-nochange-uuid',
      workout_exercise_uuid: 'we-uuid-1',
      weight: '70',
      repetitions: 6,
      min_target_reps: null,
      max_target_reps: null,
      rpe: null,
      tag: null,
      comment: null,
      is_completed: false,
      order_index: 0,
    };
    vi.mocked(db.queryOne).mockResolvedValueOnce(setRow);

    const result = await updateSet('ws-nochange-uuid', {});

    // query should NOT have been called (no fields to update)
    expect(vi.mocked(db.query).mock.calls).toHaveLength(0);
    expect(result.uuid).toBe('ws-nochange-uuid');
  });

  it('can set tag to null', async () => {
    const db = await import('./db.js');
    const setRow: DbRow = {
      uuid: 'ws-null-tag-uuid',
      workout_exercise_uuid: 'we-uuid-1',
      weight: null,
      repetitions: null,
      min_target_reps: null,
      max_target_reps: null,
      rpe: null,
      tag: null,
      comment: null,
      is_completed: false,
      order_index: 0,
    };
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce(setRow);

    await updateSet('ws-null-tag-uuid', { tag: null });

    const [updateSql, updateParams] = vi.mocked(db.query).mock.calls[0];
    expect(updateSql).toContain('tag = $1');
    expect(updateParams[0]).toBeNull();
  });
});

// ===== getWorkoutSet =====

describe('getWorkoutSet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries by uuid and returns parsed workout set', async () => {
    const db = await import('./db.js');
    const setRow: DbRow = {
      uuid: 'ws-get-uuid',
      workout_exercise_uuid: 'we-uuid-1',
      weight: '55.5',
      repetitions: 12,
      min_target_reps: null,
      max_target_reps: null,
      rpe: '7',
      tag: null,
      comment: null,
      is_completed: true,
      order_index: 1,
    };
    vi.mocked(db.queryOne).mockResolvedValueOnce(setRow);

    const result = await getWorkoutSet('ws-get-uuid');

    expect(vi.mocked(db.queryOne).mock.calls[0][0]).toContain('workout_sets');
    expect(vi.mocked(db.queryOne).mock.calls[0][1]).toEqual(['ws-get-uuid']);
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe('ws-get-uuid');
    expect(result!.weight).toBe(55.5);
    expect(result!.rpe).toBe(7);
    expect(result!.order_index).toBe(1);
  });

  it('returns null when set not found', async () => {
    const db = await import('./db.js');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);

    const result = await getWorkoutSet('missing-uuid');
    expect(result).toBeNull();
  });
});

// ===== listWorkoutSets =====

describe('listWorkoutSets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries by workout_exercise_uuid ordered by order_index', async () => {
    const db = await import('./db.js');
    const rows: DbRow[] = [
      {
        uuid: 'ws-1',
        workout_exercise_uuid: 'we-uuid-1',
        weight: '80',
        repetitions: 10,
        min_target_reps: null,
        max_target_reps: null,
        rpe: null,
        tag: null,
        comment: null,
        is_completed: true,
        order_index: 0,
      },
      {
        uuid: 'ws-2',
        workout_exercise_uuid: 'we-uuid-1',
        weight: '80',
        repetitions: 8,
        min_target_reps: null,
        max_target_reps: null,
        rpe: null,
        tag: null,
        comment: null,
        is_completed: true,
        order_index: 1,
      },
    ];
    vi.mocked(db.query).mockResolvedValueOnce(rows);

    const result = await listWorkoutSets('we-uuid-1');

    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('workout_sets');
    expect(sql).toContain('workout_exercise_uuid = $1');
    expect(sql).toContain('order_index');
    expect(params).toEqual(['we-uuid-1']);
    expect(result).toHaveLength(2);
    expect(result[0].uuid).toBe('ws-1');
    expect(result[1].uuid).toBe('ws-2');
  });

  it('returns empty array when no sets', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    const result = await listWorkoutSets('we-empty');
    expect(result).toEqual([]);
  });

  it('parses all set fields correctly', async () => {
    const db = await import('./db.js');
    const row: DbRow = {
      uuid: 'ws-parse',
      workout_exercise_uuid: 'we-uuid-1',
      weight: '102.5',
      repetitions: 5,
      min_target_reps: 3,
      max_target_reps: 6,
      rpe: '9.5',
      tag: 'failure',
      comment: 'Last set',
      is_completed: true,
      order_index: 2,
    };
    vi.mocked(db.query).mockResolvedValueOnce([row]);

    const result = await listWorkoutSets('we-uuid-1');

    expect(result[0].weight).toBe(102.5);
    expect(result[0].rpe).toBe(9.5);
    expect(result[0].tag).toBe('failure');
    expect(result[0].min_target_reps).toBe(3);
    expect(result[0].max_target_reps).toBe(6);
    expect(result[0].is_completed).toBe(true);
    expect(result[0].order_index).toBe(2);
  });
});

// ===== INBODY SCANS =====

describe('parseInbodyScan', () => {
  const baseRow: DbRow = {
    uuid: 'scan-1',
    scanned_at: '2026-03-01T07:30:00.000Z',
    device: 'InBody 570',
    venue: 'Gym Alpha',
    age_at_scan: 34,
    height_cm: '166',
    weight_kg: '62.4',
    pbf_pct: '22.1',
    smm_kg: '25.3',
    inbody_score: 78,
    visceral_fat_level: 5,
    balance_upper: 'balanced',
    balance_lower: null,
    balance_upper_lower: null,
    impedance: '{"50kHz":{"ra":380,"la":382,"trunk":25,"rl":290,"ll":293}}',
    notes: 'First scan',
    raw_json: '{}',
    created_at: '2026-03-01T07:31:00.000Z',
    updated_at: '2026-03-01T07:31:00.000Z',
  };

  it('parses numeric strings into numbers', () => {
    const s = parseInbodyScan(baseRow);
    expect(s.weight_kg).toBe(62.4);
    expect(s.height_cm).toBe(166);
    expect(s.pbf_pct).toBeCloseTo(22.1);
    expect(s.smm_kg).toBeCloseTo(25.3);
    expect(s.inbody_score).toBe(78);
    expect(s.visceral_fat_level).toBe(5);
  });

  it('parses impedance JSON string', () => {
    const s = parseInbodyScan(baseRow);
    expect(s.impedance['50kHz']).toBeDefined();
    expect(s.impedance['50kHz'].ra).toBe(380);
  });

  it('preserves balance enum when set', () => {
    const s = parseInbodyScan(baseRow);
    expect(s.balance_upper).toBe('balanced');
    expect(s.balance_lower).toBeNull();
  });

  it('handles missing numeric columns as null', () => {
    const row: DbRow = { ...baseRow, weight_kg: null, height_cm: null, pbf_pct: null };
    const s = parseInbodyScan(row);
    expect(s.weight_kg).toBeNull();
    expect(s.height_cm).toBeNull();
    expect(s.pbf_pct).toBeNull();
  });

  it('passes through object impedance (non-string)', () => {
    const row: DbRow = { ...baseRow, impedance: { '50kHz': { ra: 100 } } };
    const s = parseInbodyScan(row);
    expect(s.impedance['50kHz'].ra).toBe(100);
  });

  it('parses soft/fat-free mass, segmental fat %, and arm muscle circumference', () => {
    const row: DbRow = {
      ...baseRow,
      soft_lean_mass_kg: '47.2',
      fat_free_mass_kg: '50.1',
      seg_fat_right_arm_pct: '18.4',
      seg_fat_left_arm_pct: '18.6',
      seg_fat_trunk_pct: '22.1',
      seg_fat_right_leg_pct: '25.3',
      seg_fat_left_leg_pct: '25.5',
      arm_muscle_circumference_cm: '27.8',
    };
    const s = parseInbodyScan(row);
    expect(s.soft_lean_mass_kg).toBeCloseTo(47.2);
    expect(s.fat_free_mass_kg).toBeCloseTo(50.1);
    expect(s.seg_fat_right_arm_pct).toBeCloseTo(18.4);
    expect(s.seg_fat_left_arm_pct).toBeCloseTo(18.6);
    expect(s.seg_fat_trunk_pct).toBeCloseTo(22.1);
    expect(s.seg_fat_right_leg_pct).toBeCloseTo(25.3);
    expect(s.seg_fat_left_leg_pct).toBeCloseTo(25.5);
    expect(s.arm_muscle_circumference_cm).toBeCloseTo(27.8);
  });

  it('defaults new numeric columns to null when absent', () => {
    const s = parseInbodyScan(baseRow);
    expect(s.soft_lean_mass_kg).toBeNull();
    expect(s.fat_free_mass_kg).toBeNull();
    expect(s.seg_fat_right_arm_pct).toBeNull();
    expect(s.seg_fat_left_arm_pct).toBeNull();
    expect(s.seg_fat_trunk_pct).toBeNull();
    expect(s.seg_fat_right_leg_pct).toBeNull();
    expect(s.seg_fat_left_leg_pct).toBeNull();
    expect(s.arm_muscle_circumference_cm).toBeNull();
  });
});

describe('createInbodyScan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires scanned_at', async () => {
    await expect(createInbodyScan({} as unknown as { scanned_at: string })).rejects.toThrow(/scanned_at/);
  });

  it('inserts only the provided fields', async () => {
    const db = await import('./db.js');
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      uuid: 'scan-new', scanned_at: '2026-03-01T07:30:00.000Z', device: 'InBody 570',
      weight_kg: '60', pbf_pct: '22', impedance: '{}', raw_json: '{}',
      created_at: '2026-03-01T07:30:00.000Z', updated_at: '2026-03-01T07:30:00.000Z',
    });

    const scan = await createInbodyScan({
      scanned_at: '2026-03-01T07:30:00.000Z',
      weight_kg: 60,
      pbf_pct: 22,
    });

    const [sql, params] = vi.mocked(db.queryOne).mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('INSERT INTO inbody_scans');
    expect(sql).toContain('RETURNING *');
    // Required fields: uuid, scanned_at, weight_kg, pbf_pct (exactly — no extras)
    expect(params.length).toBe(4);
    expect(scan.uuid).toBe('scan-new');
    expect(scan.weight_kg).toBe(60);
    expect(scan.pbf_pct).toBe(22);
  });

  it('serialises impedance to JSON string', async () => {
    const db = await import('./db.js');
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      uuid: 'scan-imp', scanned_at: '2026-03-01T07:30:00.000Z', device: 'InBody 570',
      impedance: '{"50kHz":{"ra":380}}', raw_json: '{}',
      created_at: '2026-03-01T07:30:00.000Z', updated_at: '2026-03-01T07:30:00.000Z',
    });
    await createInbodyScan({
      scanned_at: '2026-03-01T07:30:00.000Z',
      impedance: { '50kHz': { ra: 380 } },
    });
    const [, params] = vi.mocked(db.queryOne).mock.calls[0] as unknown as [string, unknown[]];
    const impParam = params[params.length - 1];
    expect(typeof impParam).toBe('string');
    expect(impParam).toBe('{"50kHz":{"ra":380}}');
  });
});

describe('listInbodyScans', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies from/to window and orders DESC by scanned_at', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValueOnce([]);
    await listInbodyScans({ limit: 10, from: '2026-01-01', to: '2026-04-01' });
    const [sql, params] = vi.mocked(db.query).mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('FROM inbody_scans');
    expect(sql).toContain('scanned_at >=');
    expect(sql).toContain('scanned_at <=');
    expect(sql).toContain('ORDER BY scanned_at DESC');
    expect(params).toContain('2026-01-01');
    expect(params).toContain('2026-04-01');
    expect(params).toContain(10);
  });

  it('falls back to 90 limit when none provided', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValueOnce([]);
    await listInbodyScans();
    const [, params] = vi.mocked(db.query).mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual([90]);
  });
});

describe('getInbodyScan / getLatestInbodyScan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getInbodyScan returns null when not found', async () => {
    const db = await import('./db.js');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);
    const scan = await getInbodyScan('missing');
    expect(scan).toBeNull();
  });

  it('getLatestInbodyScan picks ORDER BY scanned_at DESC LIMIT 1', async () => {
    const db = await import('./db.js');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);
    await getLatestInbodyScan();
    const [sql] = vi.mocked(db.queryOne).mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('ORDER BY scanned_at DESC');
    expect(sql).toContain('LIMIT 1');
  });
});

describe('updateInbodyScan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('no-ops to a getInbodyScan when no fields provided', async () => {
    const db = await import('./db.js');
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      uuid: 'scan-1', scanned_at: '2026-03-01T07:30:00.000Z', device: 'InBody 570',
      impedance: '{}', raw_json: '{}',
      created_at: '2026-03-01T07:30:00.000Z', updated_at: '2026-03-01T07:30:00.000Z',
    });
    await updateInbodyScan('scan-1', {});
    const [sql] = vi.mocked(db.queryOne).mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('SELECT * FROM inbody_scans');
  });

  it('builds UPDATE with only provided fields', async () => {
    const db = await import('./db.js');
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      uuid: 'scan-1', scanned_at: '2026-03-01T07:30:00.000Z', device: 'InBody 570',
      weight_kg: '61', impedance: '{}', raw_json: '{}',
      created_at: '2026-03-01T07:30:00.000Z', updated_at: '2026-03-01T07:31:00.000Z',
    });
    await updateInbodyScan('scan-1', { weight_kg: 61, notes: 'updated' });
    const [sql, params] = vi.mocked(db.queryOne).mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/UPDATE inbody_scans SET/);
    expect(sql).toContain('weight_kg = ');
    expect(sql).toContain('notes = ');
    expect(params[params.length - 1]).toBe('scan-1');
  });
});

describe('deleteInbodyScan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes auto-inserted circumferences then the scan row', async () => {
    const db = await import('./db.js');
    vi.mocked(db.query).mockResolvedValue([]);
    await deleteInbodyScan('scan-gone');
    const calls = vi.mocked(db.query).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][0]).toContain('DELETE FROM measurement_logs WHERE source');
    expect(calls[1][0]).toContain('DELETE FROM inbody_scans WHERE uuid');
  });
});
