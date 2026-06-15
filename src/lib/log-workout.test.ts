/**
 * Tests for the `log_workout` MCP tool (src/lib/mcp-tools.ts).
 *
 * The Postgres layer (@/db/db) is mocked with a tiny in-memory model that
 * recognises the SQL prefixes the SUT issues. @/db/queries is mocked so the
 * PR recompute / weekly rollup helpers are inert — log_workout's contract is
 * "insert the rows correctly"; the rollups are covered by their own tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory DB state ───────────────────────────────────────────────────────

interface ExerciseRow {
  uuid: string;
  title: string;
  is_custom: boolean;
  is_hidden: boolean;
  tracking_mode: 'reps' | 'time';
  primary_muscles: string[];
  secondary_muscles: string[];
}
interface WorkoutRow {
  uuid: string;
  start_time: string;
  end_time: string | null;
  title: string;
  comment: string | null;
  is_current: boolean;
  workout_routine_uuid: string | null;
}
interface WeRow {
  uuid: string;
  workout_uuid: string;
  exercise_uuid: string;
  order_index: number;
}
interface SetRow {
  uuid: string;
  workout_exercise_uuid: string;
  weight: number | null;
  repetitions: number | null;
  duration_seconds: number | null;
  rpe: number | null;
  comment: string | null;
  is_completed: boolean;
  is_pr: boolean;
  excluded_from_pb: boolean;
  order_index: number;
}

const exercises = new Map<string, ExerciseRow>();
const routines = new Map<string, { uuid: string }>();
const workouts = new Map<string, WorkoutRow>();
const workoutExercises = new Map<string, WeRow>();
const workoutSets = new Map<string, SetRow>();

// ── DB mock ──────────────────────────────────────────────────────────────────

function applyInsert(s: string, params: unknown[]) {
  if (s.startsWith('INSERT INTO exercises')) {
    const [uuid, title, primary, secondary, mode] = params as [string, string, string, string, string];
    exercises.set(uuid, {
      uuid,
      title,
      is_custom: true,
      is_hidden: false,
      tracking_mode: mode === 'time' ? 'time' : 'reps',
      primary_muscles: JSON.parse(primary),
      secondary_muscles: JSON.parse(secondary),
    });
    return [];
  }
  if (s.startsWith('INSERT INTO workouts')) {
    const [uuid, start_time, end_time, title, comment, workout_routine_uuid] = params as [
      string, string, string, string, string | null, string | null,
    ];
    workouts.set(uuid, {
      uuid, start_time, end_time, title, comment, is_current: false, workout_routine_uuid,
    });
    return [];
  }
  if (s.startsWith('INSERT INTO workout_exercises')) {
    const [uuid, workout_uuid, exercise_uuid, order_index] = params as [string, string, string, number];
    workoutExercises.set(uuid, { uuid, workout_uuid, exercise_uuid, order_index });
    return [];
  }
  if (s.startsWith('INSERT INTO workout_sets')) {
    const [uuid, we, weight, repetitions, duration_seconds, rpe, comment, order_index] = params as [
      string, string, number | null, number | null, number | null, number | null, string | null, number,
    ];
    workoutSets.set(uuid, {
      uuid, workout_exercise_uuid: we, weight, repetitions, duration_seconds, rpe, comment,
      is_completed: true, is_pr: false, excluded_from_pb: false, order_index,
    });
    return [];
  }
  throw new Error(`Unrecognised INSERT in mock: ${s.slice(0, 60)}`);
}

const queryMock = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();

  // resolveExercise by id
  if (s.startsWith('SELECT uuid, title FROM exercises WHERE uuid = $1 AND is_hidden = false')) {
    const ex = exercises.get(params[0] as string);
    return ex && !ex.is_hidden ? [{ uuid: ex.uuid, title: ex.title }] : [];
  }
  // resolveExercise by name (fuzzy)
  if (s.startsWith('SELECT uuid, title FROM exercises') && s.includes('title ILIKE $1')) {
    const frag = String(params[0]).replace(/%/g, '').toLowerCase();
    const matches = [...exercises.values()]
      .filter(e => !e.is_hidden && e.title.toLowerCase().includes(frag))
      .sort((a, b) => Number(a.is_custom) - Number(b.is_custom) || a.title.localeCompare(b.title))
      .slice(0, 5)
      .map(e => ({ uuid: e.uuid, title: e.title }));
    return matches;
  }
  // tracking_mode lookup
  if (s.startsWith('SELECT tracking_mode FROM exercises WHERE uuid = $1')) {
    const ex = exercises.get(params[0] as string);
    return ex ? [{ tracking_mode: ex.tracking_mode }] : [];
  }
  // routine link validation
  if (s.startsWith('SELECT uuid FROM workout_routines WHERE uuid = $1')) {
    const r = routines.get(params[0] as string);
    return r ? [{ uuid: r.uuid }] : [];
  }
  // idempotency check
  if (s.startsWith('SELECT uuid FROM workouts') && s.includes('LOWER(TRIM(title))')) {
    const title = String(params[0]).trim().toLowerCase();
    const day = String(params[1]);
    const hit = [...workouts.values()].find(
      w => !w.is_current && w.title.trim().toLowerCase() === title && w.start_time.slice(0, 10) === day,
    );
    return hit ? [{ uuid: hit.uuid }] : [];
  }
  if (s.startsWith('INSERT')) return applyInsert(s, params);

  throw new Error(`Unrecognised SQL in mock: ${s.slice(0, 80)}`);
});

const queryOneMock = vi.fn(async (sql: string, params: unknown[] = []) => {
  const rows = await queryMock(sql, params);
  return rows.length > 0 ? rows[0] : null;
});

const transactionMock = vi.fn(async (statements: Array<{ text: string; params?: unknown[] }>) => {
  for (const { text, params } of statements) {
    applyInsert(text.trim(), params ?? []);
  }
});

vi.mock('@/db/db', () => ({
  query: (...a: unknown[]) => queryMock(a[0] as string, a[1] as unknown[] | undefined),
  queryOne: (...a: unknown[]) => queryOneMock(a[0] as string, a[1] as unknown[] | undefined),
  transaction: (...a: unknown[]) => transactionMock(a[0] as Array<{ text: string; params?: unknown[] }>),
}));

const recomputeMock = vi.fn(async (_uuid: string) => undefined);
vi.mock('@/db/queries', () => ({
  getWeekSetsPerMuscle: vi.fn(async () => []),
  getExercisePRs: vi.fn(async () => ({ e1rm: null })),
  recomputePRFlagsForExercise: (...a: unknown[]) => recomputeMock(a[0] as string),
}));

// SUT — imported AFTER vi.mock calls.
import { tools } from './mcp-tools';

// ── Helpers ──────────────────────────────────────────────────────────────────

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

function parse(result: ToolResult) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

async function logWorkout(args: Record<string, unknown>): Promise<ToolResult> {
  const t = tools.find(x => x.name === 'log_workout');
  if (!t) throw new Error('log_workout tool not registered');
  return (await t.execute(args)) as ToolResult;
}

function seedExercise(over: Partial<ExerciseRow> & { uuid: string; title: string }) {
  exercises.set(over.uuid, {
    is_custom: false,
    is_hidden: false,
    tracking_mode: 'reps',
    primary_muscles: [],
    secondary_muscles: [],
    ...over,
  });
}

beforeEach(() => {
  exercises.clear();
  routines.clear();
  workouts.clear();
  workoutExercises.clear();
  workoutSets.clear();
  queryMock.mockClear();
  queryOneMock.mockClear();
  transactionMock.mockClear();
  recomputeMock.mockClear();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('log_workout', () => {
  it('inserts a workout + exercises + sets and returns the recent-workouts shape', async () => {
    seedExercise({ uuid: 'ex-bench', title: 'Bench Press' });

    const res = await logWorkout({
      date: '2026-06-13T08:00:00+10:00',
      name: 'Push Day',
      duration_min: 60,
      exercises: [
        { exercise_id: 'ex-bench', sets: [{ weight: 60, reps: 8 }, { weight: 65, reps: 6 }] },
      ],
    });
    const out = parse(res);

    expect(res.isError).toBeFalsy();
    expect(out.name).toBe('Push Day');
    expect(out.duration_min).toBe(60);
    expect(out.auto_created_exercises).toEqual([]);
    expect(out.warning).toBeUndefined();

    // One workout, one exercise, two sets persisted.
    expect(workouts.size).toBe(1);
    expect(workoutExercises.size).toBe(1);
    expect(workoutSets.size).toBe(2);

    // end_time must be non-null (per-muscle rollups require it).
    const w = [...workouts.values()][0];
    expect(w.end_time).not.toBeNull();
    expect(w.is_current).toBe(false);

    // Every set is_completed=true with reps>=1 → flows into set tallies.
    for (const set of workoutSets.values()) {
      expect(set.is_completed).toBe(true);
      expect(set.repetitions! >= 1).toBe(true);
    }

    // total_volume = 60*8 + 65*6 = 480 + 390 = 870.
    expect(out.total_volume).toBe(870);

    // PR recompute ran for the exercise.
    expect(recomputeMock).toHaveBeenCalledWith('ex-bench');
  });

  it('accepts weight:0 sets — counts as a working set, contributes 0 load volume', async () => {
    seedExercise({ uuid: 'ex-glute', title: 'Banded Glute Bridge' });

    const res = await logWorkout({
      name: 'Glute Burnout',
      exercises: [{ exercise_id: 'ex-glute', sets: [{ weight: 0, reps: 20, band: 'medium' }] }],
    });
    const out = parse(res);

    expect(res.isError).toBeFalsy();
    expect(out.total_volume).toBe(0); // 0 * 20 = 0

    const set = [...workoutSets.values()][0];
    expect(set.weight).toBe(0);
    expect(set.repetitions).toBe(20); // working set: is_completed && reps>=1
    expect(set.is_completed).toBe(true);
    expect(set.excluded_from_pb).toBe(false); // Epley guard neutralises it; no need to exclude
    // Band stored in comment, not a new column.
    expect(set.comment).toBe('band: medium');
  });

  it('logs time-mode exercises with duration_seconds instead of reps', async () => {
    seedExercise({ uuid: 'ex-plank', title: 'Plank', tracking_mode: 'time' });

    const res = await logWorkout({
      name: 'Core',
      exercises: [{ exercise_id: 'ex-plank', sets: [{ weight: 0, duration_seconds: 90 }] }],
    });
    const out = parse(res);

    expect(res.isError).toBeFalsy();
    const set = [...workoutSets.values()][0];
    expect(set.duration_seconds).toBe(90);
    expect(set.repetitions).toBeNull();
    expect(set.is_completed).toBe(true);
    expect(out.total_volume).toBe(0);
  });

  it('auto-creates a custom exercise when exercise_name is unmatched and reports it', async () => {
    const res = await logWorkout({
      name: 'Accessories',
      exercises: [{ exercise_name: 'Banded Glute Bridge', sets: [{ weight: 0, reps: 15 }] }],
    });
    const out = parse(res);

    expect(res.isError).toBeFalsy();
    expect(out.auto_created_exercises).toEqual(['Banded Glute Bridge']);

    // A custom exercise row was created with inferred muscles (glutes).
    const created = [...exercises.values()].find(e => e.title === 'Banded Glute Bridge');
    expect(created).toBeDefined();
    expect(created!.is_custom).toBe(true);
    expect(created!.primary_muscles).toContain('glutes');
  });

  it('leaves muscles empty when the name is not inferable', async () => {
    const res = await logWorkout({
      name: 'Mystery',
      exercises: [{ exercise_name: 'Zercher Widowmaker XYZ', sets: [{ weight: 40, reps: 10 }] }],
    });
    const out = parse(res);
    expect(res.isError).toBeFalsy();
    expect(out.auto_created_exercises).toEqual(['Zercher Widowmaker XYZ']);
    const created = [...exercises.values()].find(e => e.title === 'Zercher Widowmaker XYZ');
    expect(created!.primary_muscles).toEqual([]);
  });

  it('returns a warning (but still logs) when a workout with same name + day exists', async () => {
    seedExercise({ uuid: 'ex-bench', title: 'Bench Press' });
    // Pre-seed an existing session that day.
    workouts.set('w-existing', {
      uuid: 'w-existing',
      start_time: '2026-06-13T07:00:00.000Z',
      end_time: '2026-06-13T08:00:00.000Z',
      title: 'Push Day',
      comment: null,
      is_current: false,
      workout_routine_uuid: null,
    });

    const res = await logWorkout({
      date: '2026-06-13T15:00:00+10:00', // same UTC calendar day (2026-06-13)
      name: 'Push Day',
      exercises: [{ exercise_id: 'ex-bench', sets: [{ weight: 60, reps: 8 }] }],
    });
    const out = parse(res);

    expect(res.isError).toBeFalsy();
    expect(typeof out.warning).toBe('string');
    expect(out.warning).toContain('Push Day');
    // Still inserted (didn't block) → now two workouts exist.
    expect(workouts.size).toBe(2);
  });

  it('rejects a missing name', async () => {
    const res = await logWorkout({ exercises: [{ exercise_id: 'x', sets: [{ weight: 1, reps: 1 }] }] });
    expect(res.isError).toBe(true);
    expect(parse(res)).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });

  it('rejects an out-of-range rpe', async () => {
    seedExercise({ uuid: 'ex-bench', title: 'Bench Press' });
    const res = await logWorkout({
      name: 'Push',
      exercises: [{ exercise_id: 'ex-bench', sets: [{ weight: 60, reps: 8, rpe: 11 }] }],
    });
    expect(res.isError).toBe(true);
    expect(parse(res)).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });
});
