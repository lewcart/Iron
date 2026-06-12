/**
 * Tests for Unit 3 — sync-layer push behaviour for foods and
 * week_meal_ingredients, plus the is_recipe addition to nutrition_week_meals.
 *
 * All tests mock @/db/db and run without a live Postgres connection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db/db', () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn(),
}));

vi.mock('@/db/queries', () => ({
  recomputePRFlagsForExercise: vi.fn().mockResolvedValue(undefined),
}));

function pushRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/sync/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function pushPayload(body: Record<string, unknown>) {
  const { POST } = await import('./route');
  return POST(pushRequest(body));
}

const baseFood = {
  uuid: 'food-aaaa-bbbb-cccc-dddddddddddd',
  name: 'Oats',
  brand: 'Uncle Tobys',
  per_unit: 'g',
  per_qty: 100,
  calories: 389,
  protein_g: 17,
  carbs_g: 66,
  fat_g: 7,
  nutrients: {},
  source: 'manual',
  archived_at: null,
};

const baseIngredient = {
  uuid: 'ingr-aaaa-bbbb-cccc-dddddddddddd',
  week_meal_uuid: 'meal-aaaa-bbbb-cccc-dddddddddddd',
  food_uuid: 'food-aaaa-bbbb-cccc-dddddddddddd',
  amount: 80,
  sort_order: 0,
};

// ─── pushFood ─────────────────────────────────────────────────────────────────

describe('pushFood — upsert', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 and calls query for a valid food row', async () => {
    const res = await pushPayload({ foods: [baseFood] });
    expect(res.status).toBe(200);
    const db = await import('@/db/db');
    expect(vi.mocked(db.query).mock.calls).toHaveLength(1);
  });

  it('passes nutrients as JSON.stringify to the INSERT', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      foods: [{ ...baseFood, nutrients: { fiber_g: 10, sodium_mg: 5 } }],
    });
    const [sql, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('nutrients');
    const nutrientsParam = params.find(
      p => typeof p === 'string' && p.includes('fiber_g'),
    );
    expect(nutrientsParam).toBe(JSON.stringify({ fiber_g: 10, sodium_mg: 5 }));
  });

  it('inserts WITH ON CONFLICT upsert clause', async () => {
    const db = await import('@/db/db');
    await pushPayload({ foods: [baseFood] });
    const [sql] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT (uuid) DO UPDATE SET');
    expect(sql).toContain('INSERT INTO foods');
  });

  it('sanitizes per_unit to default "serve" for invalid values', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      foods: [{ ...baseFood, per_unit: 'ounce' }],
    });
    const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    // per_unit is the 4th param ($4)
    expect(params[3]).toBe('serve');
  });

  it('accepts valid per_unit values: g, ml, serve', async () => {
    const db = await import('@/db/db');
    for (const unit of ['g', 'ml', 'serve']) {
      vi.clearAllMocks();
      await pushPayload({ foods: [{ ...baseFood, per_unit: unit }] });
      const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
      expect(params[3]).toBe(unit);
    }
  });

  it('clamps non-finite per_qty to 1', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      foods: [{ ...baseFood, per_qty: NaN }],
    });
    const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    // per_qty is the 5th param ($5)
    expect(params[4]).toBe(1);
  });

  it('returns null for non-finite macro values (NaN → null)', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      foods: [{ ...baseFood, calories: NaN, protein_g: Infinity }],
    });
    const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    // calories is $6, protein_g is $7
    expect(params[5]).toBeNull();
    expect(params[6]).toBeNull();
  });

  it('passes finite macro values through unchanged', async () => {
    const db = await import('@/db/db');
    await pushPayload({ foods: [baseFood] });
    const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(params[5]).toBe(389);
    expect(params[6]).toBe(17);
    expect(params[7]).toBe(66);
    expect(params[8]).toBe(7);
  });
});

// ─── pushFood — archive-only deletion (CRITICAL: no hard DELETE) ──────────────

describe('pushFood — _deleted translates to archived_at, NOT hard DELETE', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits UPDATE ... archived_at = NOW() instead of DELETE for _deleted food', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      foods: [{ ...baseFood, _deleted: true }],
    });
    const calls = vi.mocked(db.query).mock.calls;
    expect(calls).toHaveLength(1);
    const [sql] = calls[0] as [string, unknown[]];
    // Must NOT be a DELETE — would wedge ON DELETE RESTRICT on ingredient FK
    expect(sql).not.toMatch(/^DELETE/i);
    // Must be an UPDATE setting archived_at
    expect(sql).toMatch(/UPDATE\s+foods/i);
    expect(sql).toContain('archived_at');
    expect(sql).toContain('NOW()');
  });

  it('passes the food uuid to the UPDATE WHERE clause', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      foods: [{ ...baseFood, _deleted: true }],
    });
    const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(params).toContain(baseFood.uuid);
  });

  it('returns 200 even when a referenced food is _deleted', async () => {
    const res = await pushPayload({
      foods: [{ ...baseFood, _deleted: true }],
    });
    expect(res.status).toBe(200);
  });
});

// ─── pushWeekMealIngredient ───────────────────────────────────────────────────

describe('pushWeekMealIngredient — upsert', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 for a valid ingredient row', async () => {
    const res = await pushPayload({ week_meal_ingredients: [baseIngredient] });
    expect(res.status).toBe(200);
  });

  it('inserts with ON CONFLICT upsert clause on composite (meal, food) key', async () => {
    const db = await import('@/db/db');
    await pushPayload({ week_meal_ingredients: [baseIngredient] });
    const [sql] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO week_meal_ingredients');
    // The composite unique key is the primary conflict guard (prevents 23505 batch wedge)
    expect(sql).toContain('ON CONFLICT (week_meal_uuid, food_uuid) DO UPDATE SET');
  });

  it('hard-DELETEs on _deleted (de-listing an ingredient is safe)', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      week_meal_ingredients: [{ ...baseIngredient, _deleted: true }],
    });
    const [sql, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/^DELETE FROM week_meal_ingredients/i);
    expect(params).toContain(baseIngredient.uuid);
  });

  // ─── F1 regression guard: duplicate (meal, food) push does NOT throw ───────

  it('two pushes of the same (meal, food) pair — second push does NOT throw 23505', async () => {
    const db = await import('@/db/db');

    // Simulate: two payloads with the same (week_meal_uuid, food_uuid) but different uuids
    // (the race condition that was causing the push-batch wedge).
    const dup1 = { ...baseIngredient, uuid: 'ingr-dup1-0000-0000-000000000001', amount: 80 };
    const dup2 = { ...baseIngredient, uuid: 'ingr-dup2-0000-0000-000000000002', amount: 40 };

    // Both pushes must succeed (200); neither throws
    const res1 = await pushPayload({ week_meal_ingredients: [dup1] });
    const res2 = await pushPayload({ week_meal_ingredients: [dup2] });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Both calls used ON CONFLICT (week_meal_uuid, food_uuid) — no 23505 possible
    const calls = vi.mocked(db.query).mock.calls as [string, unknown[]][];
    const insertCalls = calls.filter(([sql]) => sql.includes('INSERT INTO week_meal_ingredients'));
    expect(insertCalls.length).toBeGreaterThanOrEqual(2);
    for (const [sql] of insertCalls) {
      expect(sql).toContain('ON CONFLICT (week_meal_uuid, food_uuid) DO UPDATE SET');
    }
  });

  it('silently drops an ingredient with amount <= 0 (server-side validation)', async () => {
    const db = await import('@/db/db');
    const res = await pushPayload({
      week_meal_ingredients: [{ ...baseIngredient, amount: 0 }],
    });
    expect(res.status).toBe(200);
    // Should have emitted no query (silent drop)
    expect(vi.mocked(db.query).mock.calls).toHaveLength(0);
  });

  it('silently drops an ingredient with non-finite amount (NaN)', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      week_meal_ingredients: [{ ...baseIngredient, amount: NaN }],
    });
    expect(vi.mocked(db.query).mock.calls).toHaveLength(0);
  });

  it('passes amount as a number to the query params', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      week_meal_ingredients: [{ ...baseIngredient, amount: 80 }],
    });
    const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(params).toContain(80);
  });
});

// ─── pushNutritionWeekMeal — is_recipe threading ─────────────────────────────

describe('pushNutritionWeekMeal — is_recipe field', () => {
  beforeEach(() => vi.clearAllMocks());

  const baseWeekMeal = {
    uuid: 'meal-aaaa-bbbb-cccc-dddddddddddd',
    day_of_week: 0,
    meal_slot: 'breakfast',
    meal_name: 'Smoothie',
    protein_g: 45,
    carbs_g: 60,
    fat_g: 12,
    calories: 571,
    quality_rating: null,
    sort_order: 0,
  };

  it('threads is_recipe=true into the INSERT', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      nutrition_week_meals: [{ ...baseWeekMeal, is_recipe: true }],
    });
    const [sql, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('is_recipe');
    expect(params).toContain(true);
  });

  it('threads is_recipe=false when not provided (coerces falsy)', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      nutrition_week_meals: [{ ...baseWeekMeal }], // is_recipe absent
    });
    const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    // $11 = is_recipe (0-indexed: 10). params = [uuid, day_of_week, meal_slot,
    // meal_name, protein_g, carbs_g, fat_g, calories, quality_rating, sort_order, is_recipe]
    const isRecipeParam = params[10];
    expect(isRecipeParam).toBe(false);
  });

  it('includes is_recipe in the ON CONFLICT DO UPDATE SET clause', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      nutrition_week_meals: [{ ...baseWeekMeal, is_recipe: true }],
    });
    const [sql] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('is_recipe = EXCLUDED.is_recipe');
  });
});

// ─── FK-safe push ordering ───────────────────────────────────────────────────

describe('push ordering — foods before week_meal_ingredients', () => {
  beforeEach(() => vi.clearAllMocks());

  it('processes foods before week_meal_ingredients in a combined payload', async () => {
    const db = await import('@/db/db');
    const callLog: string[] = [];
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO foods')) callLog.push('food');
      if (sql.includes('INSERT INTO week_meal_ingredients')) callLog.push('ingredient');
      return [];
    });

    await pushPayload({
      foods: [baseFood],
      week_meal_ingredients: [baseIngredient],
    });

    expect(callLog).toEqual(['food', 'ingredient']);
  });
});

// ─── SYNCED_TABLES allowlist ──────────────────────────────────────────────────
// Smoke-test: changes route allows foods + week_meal_ingredients.

describe('changes route — SYNCED_TABLES includes new tables', () => {
  it('foods is in the changes route allowlist', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const routeSource = readFileSync(
      resolve(__dirname, '../changes/route.ts'),
      'utf-8',
    );
    expect(routeSource).toContain("'foods'");
    expect(routeSource).toContain("'week_meal_ingredients'");
  });

  it('foods appears before week_meal_ingredients in the changes allowlist (FK order)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const routeSource = readFileSync(
      resolve(__dirname, '../changes/route.ts'),
      'utf-8',
    );
    const foodsIdx = routeSource.indexOf("'foods'");
    const wmiIdx = routeSource.indexOf("'week_meal_ingredients'");
    expect(foodsIdx).toBeGreaterThan(-1);
    expect(wmiIdx).toBeGreaterThan(-1);
    expect(foodsIdx).toBeLessThan(wmiIdx);
  });
});
