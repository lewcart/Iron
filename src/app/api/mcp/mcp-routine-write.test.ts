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
  // toolError returns plain string; toolResult returns JSON string
  const result = text ? (isError ? text : JSON.parse(text)) : null;
  return { body, result, isError };
}

// ── create_routine ────────────────────────────────────────────────────────────

describe('create_routine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates plan with nested routines and sets (exercise by id)', async () => {
    const db = await import('@/db/db');
    // resolveExercise — exercise_id path → queryOne returns exercise
    vi.mocked(db.queryOne).mockResolvedValueOnce({ uuid: 'ex-uuid-1', title: 'Squat' });
    // INSERT workout_plans
    vi.mocked(db.query).mockResolvedValue([]);

    const { result, isError } = await callTool('create_routine', {
      name: 'PPL Week 1',
      description: 'Push pull legs',
      routines: [
        {
          day_label: 'Monday — Push',
          order: 0,
          exercises: [
            {
              exercise_id: 'ex-uuid-1',
              order: 0,
              sets: [
                { target_reps: 8, target_weight: 100, rpe_target: 8 },
                { target_reps: 8, target_weight: 100, rpe_target: 8.5 },
              ],
            },
          ],
        },
      ],
    });

    expect(isError).toBeFalsy();
    expect(result.plan_id).toBeDefined();
    expect(result.routine_ids).toHaveLength(1);
    expect(result.message).toContain('PPL Week 1');

    // Verify INSERT workout_plans included description
    const insertPlanCall = vi.mocked(db.query).mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO workout_plans')
    );
    expect(insertPlanCall).toBeDefined();
    expect(insertPlanCall![1]).toContain('Push pull legs');

    // Verify sets were inserted with target_weight and rpe_target
    const setInserts = vi.mocked(db.query).mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO workout_routine_sets')
    );
    expect(setInserts).toHaveLength(2);
    expect(setInserts[0][1]).toContain(100); // target_weight
    expect(setInserts[0][1]).toContain(8);   // rpe_target
  });

  it('resolves exercise by name (fuzzy match)', async () => {
    const db = await import('@/db/db');
    // resolveExercise — exercise_name path → query returns 1 match
    vi.mocked(db.query).mockResolvedValueOnce([{ uuid: 'bench-uuid', title: 'Bench Press' }]);
    vi.mocked(db.query).mockResolvedValue([]);

    const { result, isError } = await callTool('create_routine', {
      name: 'Test Plan',
      routines: [
        {
          day_label: 'Day 1',
          exercises: [{ exercise_name: 'bench', order: 0, sets: [] }],
        },
      ],
    });

    expect(isError).toBeFalsy();
    expect(result.plan_id).toBeDefined();
  });

  it('returns error when exercise name is ambiguous', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([
      { uuid: 'a', title: 'Bench Press' },
      { uuid: 'b', title: 'Bench Press (Dumbbell)' },
    ]);

    const { isError, result } = await callTool('create_routine', {
      name: 'Test Plan',
      routines: [
        {
          day_label: 'Day 1',
          exercises: [{ exercise_name: 'bench', order: 0 }],
        },
      ],
    });

    expect(isError).toBe(true);
    expect(result).toContain('Ambiguous');
    expect(result).toContain('Bench Press');
  });

  it('returns error when no exercise found by name', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    const { isError, result } = await callTool('create_routine', {
      name: 'Test Plan',
      routines: [
        { day_label: 'Day 1', exercises: [{ exercise_name: 'nonexistent', order: 0 }] },
      ],
    });

    expect(isError).toBe(true);
    expect(result).toContain('No exercise found');
  });

  it('fails fast listing all resolution errors before writing', async () => {
    const db = await import('@/db/db');
    // Two exercises, both fail to resolve
    vi.mocked(db.query)
      .mockResolvedValueOnce([]) // first exercise name lookup → 0 results
      .mockResolvedValueOnce([]); // second exercise name lookup → 0 results

    const { isError, result } = await callTool('create_routine', {
      name: 'Test Plan',
      routines: [
        {
          day_label: 'Day 1',
          exercises: [
            { exercise_name: 'foo', order: 0 },
            { exercise_name: 'bar', order: 1 },
          ],
        },
      ],
    });

    expect(isError).toBe(true);
    expect(result).toContain('Day 1, exercise 1');
    expect(result).toContain('Day 1, exercise 2');
    // No INSERT should have been called
    expect(vi.mocked(db.query).mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT')
    )).toHaveLength(0);
  });

  it('returns error when name is missing', async () => {
    const { isError } = await callTool('create_routine', { routines: [] });
    expect(isError).toBe(true);
  });
});

// ── update_routine ────────────────────────────────────────────────────────────

describe('update_routine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates name and description', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ uuid: 'plan-1' }) // plan exists check
      .mockResolvedValueOnce({ uuid: 'plan-1', title: 'New Name', description: 'Updated', is_active: false }); // RETURNING

    const { result, isError } = await callTool('update_routine', {
      plan_id: 'plan-1',
      name: 'New Name',
      description: 'Updated',
    });

    expect(isError).toBeFalsy();
    expect(result.title).toBe('New Name');
  });

  it('deactivates previous plan when is_active=true', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ uuid: 'plan-1' })
      .mockResolvedValueOnce({ uuid: 'plan-1', is_active: true });
    vi.mocked(db.query).mockResolvedValue([]);

    await callTool('update_routine', { plan_id: 'plan-1', is_active: true });

    const deactivateCall = vi.mocked(db.query).mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('is_active = false')
    );
    expect(deactivateCall).toBeDefined();
  });

  it('returns error when plan not found', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);

    const { isError } = await callTool('update_routine', { plan_id: 'missing', name: 'X' });
    expect(isError).toBe(true);
  });

  it('returns error when no fields provided', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ uuid: 'plan-1' });

    const { isError } = await callTool('update_routine', { plan_id: 'plan-1' });
    expect(isError).toBe(true);
  });
});

// ── delete_routine ────────────────────────────────────────────────────────────

describe('delete_routine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes plan and returns success', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ title: 'My Plan' });
    vi.mocked(db.query).mockResolvedValue([]);

    const { result, isError } = await callTool('delete_routine', { plan_id: 'plan-1' });

    expect(isError).toBeFalsy();
    expect(result.success).toBe(true);
    expect(result.message).toContain('My Plan');

    const deleteCall = vi.mocked(db.query).mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('DELETE FROM workout_plans')
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toContain('plan-1');
  });

  it('returns error when plan not found', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);

    const { isError } = await callTool('delete_routine', { plan_id: 'missing' });
    expect(isError).toBe(true);
  });
});

// ── add_exercise ──────────────────────────────────────────────────────────────

describe('add_exercise', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds exercise by id with sets', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ uuid: 'routine-1' }) // routine exists
      .mockResolvedValueOnce({ uuid: 'ex-1', title: 'Squat' }) // resolveExercise by id
      .mockResolvedValueOnce({ count: '2' }); // current count
    vi.mocked(db.query).mockResolvedValue([]);

    const { result, isError } = await callTool('add_exercise', {
      routine_id: 'routine-1',
      exercise_id: 'ex-1',
      sets: [{ target_reps: 5, target_weight: 120, rpe_target: 8 }],
    });

    expect(isError).toBeFalsy();
    expect(result.routine_exercise_id).toBeDefined();
    expect(result.exercise).toBe('Squat');
    expect(result.sets_created).toBe(1);
  });

  it('returns error when routine not found', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);

    const { isError } = await callTool('add_exercise', { routine_id: 'missing', exercise_id: 'ex-1' });
    expect(isError).toBe(true);
  });
});

// ── swap_exercise ─────────────────────────────────────────────────────────────

describe('swap_exercise', () => {
  beforeEach(() => vi.clearAllMocks());

  it('swaps exercise by name and preserves sets', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ uuid: 'routine-1' }) // routine exists
      .mockResolvedValueOnce({ uuid: 'old-ex', title: 'Squat' }) // resolveExercise old by id
      .mockResolvedValueOnce({ uuid: 'new-ex', title: 'Hack Squat' }) // resolveExercise new by id
      .mockResolvedValueOnce({ uuid: 're-uuid' }) // find routine_exercise
      .mockResolvedValueOnce({ count: '3' }); // set count
    vi.mocked(db.query).mockResolvedValue([]);

    const { result, isError } = await callTool('swap_exercise', {
      routine_id: 'routine-1',
      old_exercise_id: 'old-ex',
      new_exercise_id: 'new-ex',
    });

    expect(isError).toBeFalsy();
    expect(result.swapped_from).toBe('Squat');
    expect(result.swapped_to).toBe('Hack Squat');
    expect(result.sets_preserved).toBe(3);
  });

  it('returns error when old exercise not in routine', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ uuid: 'routine-1' })
      .mockResolvedValueOnce({ uuid: 'old-ex', title: 'Squat' })
      .mockResolvedValueOnce({ uuid: 'new-ex', title: 'Hack Squat' })
      .mockResolvedValueOnce(null); // routine_exercise not found

    const { isError } = await callTool('swap_exercise', {
      routine_id: 'routine-1',
      old_exercise_id: 'old-ex',
      new_exercise_id: 'new-ex',
    });

    expect(isError).toBe(true);
  });
});

// ── remove_exercise ───────────────────────────────────────────────────────────

describe('remove_exercise', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes exercise from routine', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ uuid: 'ex-1', title: 'Squat' }) // resolveExercise
      .mockResolvedValueOnce({ uuid: 're-uuid' }); // find routine_exercise
    vi.mocked(db.query).mockResolvedValue([]);

    const { result, isError } = await callTool('remove_exercise', {
      routine_id: 'routine-1',
      exercise_id: 'ex-1',
    });

    expect(isError).toBeFalsy();
    expect(result.success).toBe(true);
    expect(result.removed).toBe('Squat');

    const deleteCall = vi.mocked(db.query).mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('DELETE FROM workout_routine_exercises')
    );
    expect(deleteCall).toBeDefined();
  });

  it('returns error when exercise not in routine', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ uuid: 'ex-1', title: 'Squat' })
      .mockResolvedValueOnce(null);

    const { isError } = await callTool('remove_exercise', { routine_id: 'r', exercise_id: 'ex-1' });
    expect(isError).toBe(true);
  });
});

// ── update_sets ───────────────────────────────────────────────────────────────

describe('update_sets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces sets for a routine exercise', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ uuid: 're-uuid' }); // re exists
    vi.mocked(db.query).mockResolvedValue([]);

    const { result, isError } = await callTool('update_sets', {
      routine_exercise_id: 're-uuid',
      sets: [
        { target_reps: 5, target_weight: 110, rpe_target: 8 },
        { target_reps: 5, target_weight: 110, rpe_target: 8 },
        { target_reps: 5, target_weight: 110, rpe_target: 8 },
      ],
    });

    expect(isError).toBeFalsy();
    expect(result.sets_updated).toBe(3);

    // Should DELETE existing sets first
    const deleteCall = vi.mocked(db.query).mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('DELETE FROM workout_routine_sets')
    );
    expect(deleteCall).toBeDefined();

    // Should insert 3 new sets
    const insertCalls = vi.mocked(db.query).mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO workout_routine_sets')
    );
    expect(insertCalls).toHaveLength(3);

    // Each set should have target_weight and rpe_target
    expect(insertCalls[0][1]).toContain(110);
    expect(insertCalls[0][1]).toContain(8);
  });

  it('can clear all sets by passing empty array', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ uuid: 're-uuid' });
    vi.mocked(db.query).mockResolvedValue([]);

    const { result, isError } = await callTool('update_sets', {
      routine_exercise_id: 're-uuid',
      sets: [],
    });

    expect(isError).toBeFalsy();
    expect(result.sets_updated).toBe(0);

    const deleteCall = vi.mocked(db.query).mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('DELETE FROM workout_routine_sets')
    );
    expect(deleteCall).toBeDefined();
  });

  it('returns error when routine exercise not found', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);

    const { isError } = await callTool('update_sets', { routine_exercise_id: 'missing', sets: [] });
    expect(isError).toBe(true);
  });
});
