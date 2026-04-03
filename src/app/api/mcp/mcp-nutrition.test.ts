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

  it('returns week_plan grouped by day', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([
      { day_of_week: 0, meal_slot: 'breakfast', meal_name: 'Oats', protein_g: 30, calories: 400, sort_order: 0 },
      { day_of_week: 0, meal_slot: 'lunch', meal_name: 'Chicken', protein_g: 50, calories: 550, sort_order: 1 },
      { day_of_week: 1, meal_slot: 'breakfast', meal_name: 'Eggs', protein_g: 25, calories: 350, sort_order: 0 },
    ]);

    const { POST } = await import('./route');
    const res = await POST(toolCall('get_nutrition_plan'));
    const body = await res.json();

    expect(body.result.isError).toBeFalsy();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.week_plan).toHaveLength(2);
    expect(parsed.week_plan[0].day).toBe('Mon');
    expect(parsed.week_plan[0].meals).toHaveLength(2);
    expect(parsed.week_plan[0].meals[0]).toMatchObject({ slot: 'breakfast', description: 'Oats', calories: 400, protein_g: 30 });
    expect(parsed.week_plan[1].day).toBe('Tue');
    expect(parsed.compliance_7d).toBeUndefined();
  });

  it('returns empty week_plan when no meals exist', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([]);

    const { POST } = await import('./route');
    const res = await POST(toolCall('get_nutrition_plan'));
    const body = await res.json();

    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.week_plan).toEqual([]);
  });

  it('includes compliance_7d when include_compliance=true', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      avg_calories: '2100.5',
      avg_protein: '160.3',
      logged_days: '5',
    });

    const { POST } = await import('./route');
    const res = await POST(toolCall('get_nutrition_plan', { include_compliance: true }));
    const body = await res.json();

    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.compliance_7d).toEqual({ avg_calories: 2100.5, avg_protein: 160.3, logged_days: 5 });
  });

  it('returns null values in compliance_7d when no logs exist', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([]);
    vi.mocked(db.queryOne).mockResolvedValueOnce({ avg_calories: null, avg_protein: null, logged_days: '0' });

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

  it('deletes existing meals and inserts new ones', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValue([]);

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
        {
          day: 'Tue',
          meals: [
            { slot: 'breakfast', description: 'Eggs', calories: 350, protein_g: 25 },
          ],
        },
      ],
    }));

    const body = await res.json();
    expect(body.result.isError).toBeFalsy();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.meals_created).toBe(3);
    expect(parsed.weeks_loaded).toBe(2);

    // First call should be DELETE
    expect(vi.mocked(db.query).mock.calls[0][0]).toMatch(/DELETE FROM nutrition_week_meals/);
    // Subsequent calls are INSERTs
    const insertCalls = vi.mocked(db.query).mock.calls.slice(1);
    expect(insertCalls).toHaveLength(3);
    // Mon = day_of_week 0
    expect(insertCalls[0][1]).toContain(0);
    // Tue = day_of_week 1
    expect(insertCalls[2][1]).toContain(1);
  });

  it('maps numeric day (1-7) to day_of_week (0-6)', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValue([]);

    const { POST } = await import('./route');
    await POST(toolCall('load_nutrition_plan', {
      days: [
        { day: 7, meals: [{ slot: 'dinner', description: 'Sunday roast', calories: 800 }] },
      ],
    }));

    const insertArgs = vi.mocked(db.query).mock.calls[1][1] as unknown[];
    expect(insertArgs[1]).toBe(6); // day 7 → index 6 (Sun)
  });

  it('maps full day names correctly', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValue([]);

    const { POST } = await import('./route');
    await POST(toolCall('load_nutrition_plan', {
      days: [
        { day: 'Friday', meals: [{ slot: 'lunch', description: 'Salad' }] },
      ],
    }));

    const insertArgs = vi.mocked(db.query).mock.calls[1][1] as unknown[];
    expect(insertArgs[1]).toBe(4); // Fri = 4
  });

  it('notes unstorable fields (carbs_g, fat_g, targets) without failing', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValue([]);

    const { POST } = await import('./route');
    const res = await POST(toolCall('load_nutrition_plan', {
      days: [
        {
          day: 'Mon',
          meals: [{ slot: 'breakfast', description: 'Oats', carbs_g: 60, fat_g: 8 }],
        },
      ],
      targets: { calories: 2200, protein_g: 160 },
    }));

    const body = await res.json();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.notes).toContain('targets not stored (no targets table in schema)');
    expect(parsed.notes).toContain('carbs_g and fat_g not stored (columns absent from nutrition_week_meals)');
  });

  it('returns no notes field when no unstorable fields present', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValue([]);

    const { POST } = await import('./route');
    const res = await POST(toolCall('load_nutrition_plan', {
      days: [
        { day: 'Mon', meals: [{ slot: 'breakfast', description: 'Oats', calories: 400, protein_g: 30 }] },
      ],
    }));

    const body = await res.json();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.notes).toBeUndefined();
  });
});
