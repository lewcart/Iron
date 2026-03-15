import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseExercise, parseWorkout, parseWorkoutExercise, parseWorkoutSet, listExercises } from './queries';
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
    expect(params).toContain('%chest%');
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
});
