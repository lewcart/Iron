import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireApiKey: vi.fn().mockReturnValue(null),
}));

vi.mock('@/db/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

function toolCall(name: string, args: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const { POST } = await import('./route');
  const res = await POST(toolCall(name, args));
  const body = await res.json();
  const isError = body.result?.isError;
  const text = body.result?.content?.[0]?.text;
  const result = text ? (isError ? text : JSON.parse(text)) : null;
  return { body, result, isError };
}

// ── get_recent_workouts ───────────────────────────────────────────────────────

describe('get_recent_workouts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty array when no workouts found', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([]); // workouts query

    const { result, isError } = await callTool('get_recent_workouts');
    expect(isError).toBeFalsy();
    expect(result).toEqual([]);
  });

  it('returns workouts with exercises and sets', async () => {
    const db = await import('@/db/db');
    // workouts
    vi.mocked(db.query).mockResolvedValueOnce([
      { uuid: 'w1', title: 'Push Day', start_time: '2026-04-01T09:00:00Z', end_time: '2026-04-01T10:00:00Z' },
    ]);
    // exercises
    vi.mocked(db.query).mockResolvedValueOnce([
      { workout_uuid: 'w1', exercise_uuid: 'ex1', exercise_title: 'Bench Press', we_uuid: 'we1', order_index: 0 },
    ]);
    // sets
    vi.mocked(db.query).mockResolvedValueOnce([
      { workout_exercise_uuid: 'we1', weight: 100, repetitions: 8, rpe: 8, is_completed: true, order_index: 0 },
      { workout_exercise_uuid: 'we1', weight: 100, repetitions: 8, rpe: 8.5, is_completed: true, order_index: 1 },
    ]);

    const { result, isError } = await callTool('get_recent_workouts', { limit: 5, days_back: 7 });
    expect(isError).toBeFalsy();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Push Day');
    expect(result[0].duration_min).toBe(60);
    expect(result[0].exercises).toHaveLength(1);
    expect(result[0].exercises[0].name).toBe('Bench Press');
    expect(result[0].exercises[0].sets).toHaveLength(2);
    expect(result[0].exercises[0].sets[0]).toMatchObject({ weight: 100, reps: 8, rpe: 8 });
    expect(result[0].total_volume).toBe(1600); // 100*8 + 100*8
  });

  it('returns null duration when workout has no end_time', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([
      { uuid: 'w1', title: 'Unfinished', start_time: '2026-04-01T09:00:00Z', end_time: null },
    ]);
    vi.mocked(db.query).mockResolvedValueOnce([]); // exercises
    // no sets call since weUuids is empty

    const { result } = await callTool('get_recent_workouts');
    expect(result[0].duration_min).toBeNull();
  });

  it('caps limit at 50', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    await callTool('get_recent_workouts', { limit: 999 });
    // First query param[0] should be capped at 50
    const firstCallParams = vi.mocked(db.query).mock.calls[0][1] as unknown[];
    expect(firstCallParams[0]).toBe(50);
  });
});

// ── get_exercise_history ──────────────────────────────────────────────────────

describe('get_exercise_history', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when neither exercise_name nor exercise_id provided', async () => {
    const { isError, result } = await callTool('get_exercise_history', {});
    expect(isError).toBe(true);
    expect(result).toMatch(/exercise_name or exercise_id/);
  });

  it('returns error when exercise_name yields no match', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null); // no match

    const { isError, result } = await callTool('get_exercise_history', { exercise_name: 'nonexistent' });
    expect(isError).toBe(true);
    expect(result).toMatch(/No exercise found matching/);
  });

  it('resolves exercise by name via fuzzy match and returns history', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ uuid: 'ex-squat', title: 'Barbell Squat' });
    vi.mocked(db.query).mockResolvedValueOnce([
      { workout_uuid: 'w1', we_uuid: 'we1', date: '2026-03-28T10:00:00Z', workout_name: 'Leg Day' },
    ]);
    vi.mocked(db.query).mockResolvedValueOnce([
      { workout_exercise_uuid: 'we1', weight: 140, repetitions: 5 },
      { workout_exercise_uuid: 'we1', weight: 140, repetitions: 5 },
    ]);

    const { result, isError } = await callTool('get_exercise_history', { exercise_name: 'squat' });
    expect(isError).toBeFalsy();
    expect(result).toHaveLength(1);
    expect(result[0].workout_name).toBe('Leg Day');
    expect(result[0].sets).toHaveLength(2);
    expect(result[0].sets[0]).toMatchObject({ weight: 140, reps: 5 });
    // Epley 1RM: 140 * (1 + 5/30) = 140 * 1.1667 ≈ 163.3
    expect(result[0].estimated_1rm).toBeCloseTo(163.3, 0);
  });

  it('resolves exercise directly by exercise_id', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([
      { workout_uuid: 'w1', we_uuid: 'we1', date: '2026-03-28T10:00:00Z', workout_name: 'Push' },
    ]);
    vi.mocked(db.query).mockResolvedValueOnce([]);

    const { result, isError } = await callTool('get_exercise_history', { exercise_id: 'ex-uuid-123' });
    expect(isError).toBeFalsy();
    expect(result).toHaveLength(1);
    expect(result[0].estimated_1rm).toBeNull(); // no sets
  });

  it('returns empty array when no sessions found for valid exercise_id', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([]); // sessions

    const { result, isError } = await callTool('get_exercise_history', { exercise_id: 'ex-uuid-999' });
    expect(isError).toBeFalsy();
    expect(result).toEqual([]);
  });
});

// ── get_active_routine ────────────────────────────────────────────────────────

describe('get_active_routine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no active plan exists', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);

    const { result, isError } = await callTool('get_active_routine');
    expect(isError).toBeFalsy();
    expect(result).toBeNull();
  });

  it('returns active plan with routines and exercises', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ uuid: 'plan-1', title: 'PPL' });
    // routines
    vi.mocked(db.query).mockResolvedValueOnce([
      { uuid: 'r1', title: 'Push', comment: null, order_index: 0 },
      { uuid: 'r2', title: 'Pull', comment: null, order_index: 1 },
    ]);
    // routine exercises
    vi.mocked(db.query).mockResolvedValueOnce([
      { routine_uuid: 'r1', re_uuid: 're1', exercise_uuid: 'ex1', exercise_title: 'Bench Press', order_index: 0 },
    ]);
    // routine sets
    vi.mocked(db.query).mockResolvedValueOnce([
      { workout_routine_exercise_uuid: 're1', min_repetitions: 6, max_repetitions: 8, order_index: 0 },
      { workout_routine_exercise_uuid: 're1', min_repetitions: 6, max_repetitions: 8, order_index: 1 },
    ]);

    const { result, isError } = await callTool('get_active_routine');
    expect(isError).toBeFalsy();
    expect(result.uuid).toBe('plan-1');
    expect(result.title).toBe('PPL');
    expect(result.routines).toHaveLength(2);
    expect(result.routines[0].title).toBe('Push');
    expect(result.routines[0].exercises).toHaveLength(1);
    expect(result.routines[0].exercises[0].exercise_title).toBe('Bench Press');
    expect(result.routines[0].exercises[0].sets).toHaveLength(2);
    expect(result.routines[1].exercises).toHaveLength(0); // no exercises for Pull
  });

  it('returns plan with empty routines array when plan has no routines', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ uuid: 'plan-1', title: 'Empty Plan' });
    vi.mocked(db.query).mockResolvedValueOnce([]); // no routines
    // No further queries since rUuids is empty

    const { result, isError } = await callTool('get_active_routine');
    expect(isError).toBeFalsy();
    expect(result.routines).toEqual([]);
  });
});

// ── get_weekly_summary ────────────────────────────────────────────────────────

describe('get_weekly_summary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns summary for current week (default offset 0)', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ week_start: '2026-03-30', week_end: '2026-04-06' });
    vi.mocked(db.query).mockResolvedValueOnce([
      { uuid: 'w1', title: 'Push', start_time: '2026-04-01T09:00:00Z', total_volume: '4500' },
      { uuid: 'w2', title: 'Pull', start_time: '2026-04-02T09:00:00Z', total_volume: '3200' },
    ]);
    // getWeekSetsPerMuscle row shape (post-migration 023, canonical slugs).
    vi.mocked(db.query).mockResolvedValueOnce([
      { slug: 'chest', display_name: 'Chest', parent_group: 'chest',
        optimal_sets_min: 10, optimal_sets_max: 20, display_order: 10,
        set_count: 12, kg_volume: '3000', coverage: 'tagged' },
      { slug: 'lats', display_name: 'Lats', parent_group: 'back',
        optimal_sets_min: 10, optimal_sets_max: 20, display_order: 20,
        set_count: 8, kg_volume: '2700', coverage: 'tagged' },
    ]);
    vi.mocked(db.queryOne).mockResolvedValueOnce({ routine_count: '4' });

    const { result, isError } = await callTool('get_weekly_summary');
    expect(isError).toBeFalsy();
    expect(result.week_start).toBe('2026-03-30');
    expect(result.week_end).toBe('2026-04-06');
    expect(result.training_days).toBe(2);
    expect(result.total_volume).toBe(7700); // 4500 + 3200
    expect(result.volume_by_muscle).toMatchObject({ chest: 3000, lats: 2700 });
    expect(result.by_muscle).toEqual([
      expect.objectContaining({ slug: 'chest', set_count: 12, kg_volume: 3000, status: 'optimal' }),
      expect.objectContaining({ slug: 'lats', set_count: 8, kg_volume: 2700, status: 'under' }),
    ]);
    expect(result.compliance_pct).toBe(50); // 2 of 4 planned days = 50%
  });

  it('returns compliance_pct null when no active plan', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ week_start: '2026-03-30', week_end: '2026-04-06' });
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce({ routine_count: '0' });

    const { result, isError } = await callTool('get_weekly_summary');
    expect(isError).toBeFalsy();
    expect(result.training_days).toBe(0);
    expect(result.total_volume).toBe(0);
    expect(result.volume_by_muscle).toEqual({});
    expect(result.compliance_pct).toBeNull();
  });

  it('caps compliance_pct at 100 when training days exceed planned', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ week_start: '2026-03-30', week_end: '2026-04-06' });
    vi.mocked(db.query).mockResolvedValueOnce([
      { uuid: 'w1', title: 'Day 1', start_time: '2026-04-01T09:00:00Z', total_volume: '1000' },
      { uuid: 'w2', title: 'Day 2', start_time: '2026-04-02T09:00:00Z', total_volume: '1000' },
      { uuid: 'w3', title: 'Day 3', start_time: '2026-04-03T09:00:00Z', total_volume: '1000' },
    ]);
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce({ routine_count: '2' }); // only 2 planned

    const { result } = await callTool('get_weekly_summary', { week_offset: 0 });
    expect(result.compliance_pct).toBe(100); // capped via Math.min(1, 3/2) * 100
  });

  it('passes week_offset to week bounds query', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ week_start: '2026-03-23', week_end: '2026-03-30' });
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce({ routine_count: '3' });

    await callTool('get_weekly_summary', { week_offset: -1 });
    // The week bounds queryOne should receive -1 as the offset param
    const weekBoundsParams = vi.mocked(db.queryOne).mock.calls[0][1] as unknown[];
    expect(weekBoundsParams[0]).toBe(-1);
  });
});
