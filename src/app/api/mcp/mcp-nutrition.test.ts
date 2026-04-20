import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock auth so all requests pass
vi.mock('@/lib/api-auth', () => ({
  requireApiKey: vi.fn().mockReturnValue(null),
}));

// Mock the DB layer
vi.mock('@/db/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

// Helpers for JSON-RPC requests
function rpcRequest(method: string, params: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

function toolCall(name: string, args: Record<string, unknown> = {}) {
  return rpcRequest('tools/call', { name, arguments: args });
}

// ── get_nutrition_plan ────────────────────────────────────────────────────────

describe('get_nutrition_plan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns week_plan grouped by day with macros + targets', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([
      { uuid: 'u1', day_of_week: 0, meal_slot: 'breakfast', meal_name: 'Oats', protein_g: 30, carbs_g: 60, fat_g: 8, calories: 400, quality_rating: 4, sort_order: 0 },
      { uuid: 'u2', day_of_week: 0, meal_slot: 'lunch', meal_name: 'Chicken', protein_g: 50, carbs_g: 70, fat_g: 10, calories: 550, quality_rating: null, sort_order: 1 },
      { uuid: 'u3', day_of_week: 1, meal_slot: 'breakfast', meal_name: 'Eggs', protein_g: 25, carbs_g: 5, fat_g: 20, calories: 350, quality_rating: null, sort_order: 0 },
    ]);
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      calories: 2200, protein_g: 160, carbs_g: 220, fat_g: 70,
    });

    const { POST } = await import('./route');
    const res = await POST(toolCall('get_nutrition_plan'));
    const body = await res.json();

    expect(body.result.isError).toBeFalsy();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.week_plan).toHaveLength(2);
    expect(parsed.week_plan[0].day).toBe('Mon');
    expect(parsed.week_plan[0].meals).toHaveLength(2);
    expect(parsed.week_plan[0].meals[0]).toMatchObject({
      uuid: 'u1', slot: 'breakfast', description: 'Oats',
      calories: 400, protein_g: 30, carbs_g: 60, fat_g: 8, quality_rating: 4,
    });
    expect(parsed.week_plan[1].day).toBe('Tue');
    expect(parsed.targets).toEqual({ calories: 2200, protein_g: 160, carbs_g: 220, fat_g: 70 });
    expect(parsed.compliance_7d).toBeUndefined();
  });

  it('returns empty week_plan and null targets when nothing stored', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);

    const { POST } = await import('./route');
    const res = await POST(toolCall('get_nutrition_plan'));
    const body = await res.json();

    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.week_plan).toEqual([]);
    expect(parsed.targets).toBeNull();
  });

  it('includes compliance_7d when include_compliance=true', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // targets
      .mockResolvedValueOnce({ avg_calories: '2100.5', avg_protein: '160.3', logged_days: '5' });

    const { POST } = await import('./route');
    const res = await POST(toolCall('get_nutrition_plan', { include_compliance: true }));
    const body = await res.json();

    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.compliance_7d).toEqual({ avg_calories: 2100.5, avg_protein: 160.3, logged_days: 5 });
  });

  it('returns null values in compliance_7d when no logs exist', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // targets
      .mockResolvedValueOnce({ avg_calories: null, avg_protein: null, logged_days: '0' });

    const { POST } = await import('./route');
    const res = await POST(toolCall('get_nutrition_plan', { include_compliance: true }));
    const body = await res.json();

    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.compliance_7d).toEqual({ avg_calories: null, avg_protein: null, logged_days: 0 });
  });
});

// ── load_nutrition_plan ───────────────────────────────────────────────────────

describe('load_nutrition_plan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs DELETE + N INSERTs in a single transaction', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.transaction).mockResolvedValue(undefined);

    const { POST } = await import('./route');
    const res = await POST(toolCall('load_nutrition_plan', {
      days: [
        {
          day: 'Mon',
          meals: [
            { slot: 'breakfast', description: 'Oats', calories: 400, protein_g: 30 },
            { slot: 'lunch', description: 'Chicken rice', calories: 600, protein_g: 50 },
          ],
        },
        { day: 'Tue', meals: [{ slot: 'breakfast', description: 'Eggs', calories: 350, protein_g: 25 }] },
      ],
    }));

    const body = await res.json();
    expect(body.result.isError).toBeFalsy();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.meals_created).toBe(3);
    expect(parsed.weeks_loaded).toBe(2);

    expect(vi.mocked(db.transaction)).toHaveBeenCalledTimes(1);
    const stmts = vi.mocked(db.transaction).mock.calls[0][0] as Array<{ text: string; params?: unknown[] }>;
    // DELETE + 3 INSERTs
    expect(stmts).toHaveLength(4);
    expect(stmts[0].text).toMatch(/DELETE FROM nutrition_week_meals/);
    expect(stmts[1].text).toMatch(/INSERT INTO nutrition_week_meals/);
    expect(stmts[1].params?.[1]).toBe(0); // Mon
    expect(stmts[3].params?.[1]).toBe(1); // Tue
  });

  it('maps numeric day (1-7) to day_of_week (0-6)', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.transaction).mockResolvedValue(undefined);

    const { POST } = await import('./route');
    await POST(toolCall('load_nutrition_plan', {
      days: [{ day: 7, meals: [{ slot: 'dinner', description: 'Sunday roast', calories: 800 }] }],
    }));

    const stmts = vi.mocked(db.transaction).mock.calls[0][0] as Array<{ text: string; params?: unknown[] }>;
    expect(stmts[1].params?.[1]).toBe(6); // day 7 → index 6 (Sun)
  });

  it('maps full day names correctly', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.transaction).mockResolvedValue(undefined);

    const { POST } = await import('./route');
    await POST(toolCall('load_nutrition_plan', {
      days: [{ day: 'Friday', meals: [{ slot: 'lunch', description: 'Salad' }] }],
    }));

    const stmts = vi.mocked(db.transaction).mock.calls[0][0] as Array<{ text: string; params?: unknown[] }>;
    expect(stmts[1].params?.[1]).toBe(4); // Fri = 4
  });

  it('persists carbs_g, fat_g, quality_rating, and targets', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.transaction).mockResolvedValue(undefined);

    const { POST } = await import('./route');
    const res = await POST(toolCall('load_nutrition_plan', {
      days: [
        {
          day: 'Mon',
          meals: [{ slot: 'breakfast', description: 'Oats', calories: 400, protein_g: 30, carbs_g: 60, fat_g: 8, quality_rating: 4 }],
        },
      ],
      targets: { calories: 2200, protein_g: 160, carbs_g: 220, fat_g: 70 },
    }));

    const body = await res.json();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.meals_created).toBe(1);
    expect(parsed.targets_set).toBe(true);

    const stmts = vi.mocked(db.transaction).mock.calls[0][0] as Array<{ text: string; params?: unknown[] }>;
    // DELETE, INSERT meal, INSERT targets upsert
    expect(stmts).toHaveLength(3);
    expect(stmts[0].text).toMatch(/DELETE FROM nutrition_week_meals/);
    expect(stmts[1].text).toMatch(/INSERT INTO nutrition_week_meals/);
    const mealArgs = stmts[1].params as unknown[];
    // [uuid, dow, slot, name, protein, carbs, fat, calories, quality, sort_order]
    expect(mealArgs[4]).toBe(30);
    expect(mealArgs[5]).toBe(60);
    expect(mealArgs[6]).toBe(8);
    expect(mealArgs[7]).toBe(400);
    expect(mealArgs[8]).toBe(4);

    expect(stmts[2].text).toMatch(/INSERT INTO nutrition_targets/);
    expect(stmts[2].params).toEqual([2200, 160, 220, 70]);
  });

  it('skips targets upsert when targets not supplied', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.transaction).mockResolvedValue(undefined);

    const { POST } = await import('./route');
    const res = await POST(toolCall('load_nutrition_plan', {
      days: [{ day: 'Mon', meals: [{ slot: 'breakfast', description: 'Oats', calories: 400, protein_g: 30 }] }],
    }));

    const body = await res.json();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.targets_set).toBe(false);

    const stmts = vi.mocked(db.transaction).mock.calls[0][0] as Array<{ text: string; params?: unknown[] }>;
    expect(stmts.some(s => /nutrition_targets/.test(s.text))).toBe(false);
  });
});

// ── log_nutrition_meal ────────────────────────────────────────────────────────

describe('log_nutrition_meal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a meal log row', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ uuid: 'row-1', meal_name: 'Protein oats' });

    const { POST } = await import('./route');
    const res = await POST(toolCall('log_nutrition_meal', {
      meal_type: 'breakfast',
      meal_name: 'Protein oats',
      calories: 420,
      protein_g: 35,
      carbs_g: 55,
      fat_g: 9,
      status: 'planned',
    }));

    const body = await res.json();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.uuid).toBe('row-1');

    const call = vi.mocked(db.queryOne).mock.calls[0];
    expect(call[0]).toMatch(/INSERT INTO nutrition_logs/);
    const args = call[1] as unknown[];
    // [uuid, logged_at, meal_type, meal_name, cal, prot, carb, fat, notes, tpl, status]
    expect(args[2]).toBe('breakfast');
    expect(args[3]).toBe('Protein oats');
    expect(args[10]).toBe('planned');
  });

  it('rejects invalid meal_type', async () => {
    const { POST } = await import('./route');
    const res = await POST(toolCall('log_nutrition_meal', { meal_type: 'brunch' }));
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/meal_type must be/);
  });

  it('rejects invalid status', async () => {
    const { POST } = await import('./route');
    const res = await POST(toolCall('log_nutrition_meal', { status: 'freeform' }));
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/status must be/);
  });
});

// ── set_nutrition_day_notes ───────────────────────────────────────────────────

describe('set_nutrition_day_notes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts hydration + notes for a given date', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ date: '2026-04-20', hydration_ml: 3000, notes: 'low-carb day' });

    const { POST } = await import('./route');
    const res = await POST(toolCall('set_nutrition_day_notes', {
      date: '2026-04-20',
      hydration_ml: 3000,
      notes: 'low-carb day',
    }));

    const body = await res.json();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.hydration_ml).toBe(3000);

    const call = vi.mocked(db.queryOne).mock.calls[0];
    expect(call[0]).toMatch(/INSERT INTO nutrition_day_notes/);
    expect(call[0]).toMatch(/ON CONFLICT \(date\) DO UPDATE/);
  });

  it('rejects bad date format', async () => {
    const { POST } = await import('./route');
    const res = await POST(toolCall('set_nutrition_day_notes', { date: '04/20/2026' }));
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/YYYY-MM-DD/);
  });
});

// ── set_nutrition_targets ─────────────────────────────────────────────────────

describe('set_nutrition_targets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts the singleton targets row', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ id: 1, calories: 2500, protein_g: 180, carbs_g: 250, fat_g: 80 });

    const { POST } = await import('./route');
    const res = await POST(toolCall('set_nutrition_targets', {
      calories: 2500, protein_g: 180, carbs_g: 250, fat_g: 80,
    }));

    const body = await res.json();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.calories).toBe(2500);

    const call = vi.mocked(db.queryOne).mock.calls[0];
    expect(call[0]).toMatch(/INSERT INTO nutrition_targets/);
    expect(call[0]).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(call[1]).toEqual([2500, 180, 250, 80]);
  });
});

// ── update_week_meal ──────────────────────────────────────────────────────────

describe('update_week_meal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates only the provided fields', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ uuid: 'meal-1', meal_name: 'Steak + rice', calories: 800 });

    const { POST } = await import('./route');
    const res = await POST(toolCall('update_week_meal', {
      uuid: 'meal-1',
      meal_name: 'Steak + rice',
      calories: 800,
    }));

    const body = await res.json();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.meal_name).toBe('Steak + rice');

    const call = vi.mocked(db.queryOne).mock.calls[0];
    expect(call[0]).toMatch(/UPDATE nutrition_week_meals SET meal_name = \$1, calories = \$2 WHERE uuid = \$3/);
    expect(call[1]).toEqual(['Steak + rice', 800, 'meal-1']);
  });

  it('errors when uuid missing', async () => {
    const { POST } = await import('./route');
    const res = await POST(toolCall('update_week_meal', { calories: 500 }));
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/uuid is required/);
  });

  it('errors when no fields to update', async () => {
    const { POST } = await import('./route');
    const res = await POST(toolCall('update_week_meal', { uuid: 'meal-1' }));
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/No fields to update/);
  });

  it('returns not found when uuid does not exist', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);

    const { POST } = await import('./route');
    const res = await POST(toolCall('update_week_meal', { uuid: 'nope', calories: 1 }));
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/Meal not found/);
  });
});
