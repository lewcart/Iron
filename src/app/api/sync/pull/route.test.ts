import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/db/db', () => ({
  query: vi.fn(),
}));

import { query } from '@/db/db';
import { GET } from './route';

type QueryMock = ReturnType<typeof vi.fn>;
const queryMock = query as unknown as QueryMock;

// The pull route runs five queries in a Promise.all: workouts,
// workout_exercises, workout_sets, bodyweight_logs, exercises (in that order).
// Each test below stages the results by call order.
function stageResults(rows: Record<string, unknown>[][]) {
  queryMock.mockReset();
  for (const r of rows) queryMock.mockResolvedValueOnce(r);
}

const nowIso = '2026-04-20T00:00:00.000Z';

describe('GET /api/sync/pull — catalog bundling', () => {
  beforeEach(() => queryMock.mockReset());

  it('full pull returns an exercises array', async () => {
    stageResults([
      [], // workouts
      [], // workout_exercises
      [], // workout_sets
      [], // bodyweight_logs
      [
        {
          uuid: 'EX-UPPER-CASE',
          everkinetic_id: 1,
          title: 'Bench Press',
          alias: [],
          description: null,
          primary_muscles: ['chest'],
          secondary_muscles: [],
          equipment: ['barbell'],
          steps: [],
          tips: [],
          is_custom: false,
          is_hidden: false,
          movement_pattern: 'horizontal_push',
          updated_at: nowIso,
        },
      ],
    ]);

    const res = await GET(new Request('http://localhost/api/sync/pull'));
    const body = await res.json();

    expect(body.exercises).toHaveLength(1);
    // Server MUST lowercase the uuid to match client lookup normalization.
    expect(body.exercises[0].uuid).toBe('ex-upper-case');
    expect(body.exercises[0].title).toBe('Bench Press');
    expect(body.exercises[0].movement_pattern).toBe('horizontal_push');

    const callSqls = queryMock.mock.calls.map(c => c[0] as string);
    expect(callSqls.some(s => s.includes('FROM exercises'))).toBe(true);
    expect(callSqls.some(s => s.includes('is_hidden = false'))).toBe(true);
  });

  it('incremental pull filters exercises by updated_at > since', async () => {
    stageResults([[], [], [], [], []]);

    const since = '2026-04-10T00:00:00.000Z';
    await GET(new Request(`http://localhost/api/sync/pull?since=${encodeURIComponent(since)}`));

    const calls = queryMock.mock.calls;
    const exercisesCall = calls.find(c => (c[0] as string).includes('FROM exercises'));
    expect(exercisesCall, 'exercises query should be run on incremental pull too').toBeDefined();
    expect(exercisesCall![0]).toMatch(/updated_at > \$1/);
    expect(exercisesCall![1]).toEqual([since]);
  });

  it('lowercases exercise_uuid in workout_exercises too (regression: this was the recurring Unknown Exercise root cause)', async () => {
    stageResults([
      [],
      [
        {
          uuid: 'we-1',
          workout_uuid: 'w-1',
          exercise_uuid: 'ABCDEF12-3456-7890-ABCD-EF1234567890',
          comment: null,
          order_index: 0,
          updated_at: nowIso,
        },
      ],
      [],
      [],
      [],
    ]);

    const res = await GET(new Request('http://localhost/api/sync/pull'));
    const body = await res.json();
    expect(body.workout_exercises[0].exercise_uuid).toBe('abcdef12-3456-7890-abcd-ef1234567890');
  });
});
