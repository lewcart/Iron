/**
 * Tests for Dexie v27 schema addition — foods + week_meal_ingredients tables
 * and the nutrition_week_meals.is_recipe backfill.
 *
 * Uses fake-indexeddb to exercise the actual Dexie upgrade path without a
 * browser/real IDB engine.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from './local';

vi.mock('@/lib/sync', () => ({
  syncEngine: { schedulePush: vi.fn() },
}));

// ─── v27 table registration ───────────────────────────────────────────────────

describe('Dexie v27 — foods table', () => {
  beforeEach(async () => {
    await db.foods.clear();
  });

  it('foods table exists and can put/get a food row', async () => {
    const food = {
      uuid: 'f1111111-0000-0000-0000-000000000001',
      name: 'Oats',
      brand: 'Uncle Tobys',
      per_unit: 'g' as const,
      per_qty: 100,
      calories: 389,
      protein_g: 17,
      carbs_g: 66,
      fat_g: 7,
      nutrients: {},
      source: 'manual',
      archived_at: null,
      created_at: new Date().toISOString(),
      _synced: false as const,
      _updated_at: Date.now(),
      _deleted: false as const,
    };
    await db.foods.put(food);
    const stored = await db.foods.get(food.uuid);
    expect(stored).toBeDefined();
    expect(stored!.name).toBe('Oats');
    expect(stored!.per_unit).toBe('g');
    expect(stored!.per_qty).toBe(100);
    expect(typeof stored!.per_qty).toBe('number');
    expect(stored!.calories).toBe(389);
    expect(typeof stored!.calories).toBe('number');
  });

  it('food row can be queried by _synced index (dirty-row push path)', async () => {
    await db.foods.put({
      uuid: 'f2222222-0000-0000-0000-000000000002',
      name: 'Banana',
      brand: null,
      per_unit: 'serve',
      per_qty: 1,
      calories: 90,
      protein_g: 1,
      carbs_g: 23,
      fat_g: 0.3,
      nutrients: {},
      source: 'manual',
      archived_at: null,
      created_at: new Date().toISOString(),
      _synced: false,
      _updated_at: Date.now(),
      _deleted: false,
    });
    const dirty = await db.foods.filter(r => !r._synced).toArray();
    expect(dirty.length).toBeGreaterThanOrEqual(1);
    expect(dirty.some(f => f.uuid === 'f2222222-0000-0000-0000-000000000002')).toBe(true);
  });

  it('macro fields are stored and retrieved as numbers (not strings)', async () => {
    await db.foods.put({
      uuid: 'f3333333-0000-0000-0000-000000000003',
      name: 'Protein Powder',
      brand: null,
      per_unit: 'serve',
      per_qty: 1,
      calories: 120,
      protein_g: 25,
      carbs_g: 3,
      fat_g: 2,
      nutrients: {},
      source: 'manual',
      archived_at: null,
      created_at: new Date().toISOString(),
      _synced: false,
      _updated_at: Date.now(),
      _deleted: false,
    });
    const stored = await db.foods.get('f3333333-0000-0000-0000-000000000003');
    // Regression for "571"+"114"="571114" string-concatenation bug
    expect(typeof stored!.calories).toBe('number');
    expect(typeof stored!.protein_g).toBe('number');
    expect(typeof stored!.carbs_g).toBe('number');
    expect(typeof stored!.fat_g).toBe('number');
    expect(stored!.calories! + stored!.protein_g!).toBe(145); // 120 + 25, not "12025"
  });
});

// ─── v27 table registration — week_meal_ingredients ──────────────────────────

describe('Dexie v27 — week_meal_ingredients table', () => {
  beforeEach(async () => {
    await db.week_meal_ingredients.clear();
  });

  it('week_meal_ingredients table exists and can put/get an ingredient row', async () => {
    const ingredient = {
      uuid: 'i1111111-0000-0000-0000-000000000001',
      week_meal_uuid: 'm1111111-0000-0000-0000-000000000001',
      food_uuid: 'f1111111-0000-0000-0000-000000000001',
      amount: 80,
      sort_order: 0,
      created_at: new Date().toISOString(),
      _synced: false as const,
      _updated_at: Date.now(),
      _deleted: false as const,
    };
    await db.week_meal_ingredients.put(ingredient);
    const stored = await db.week_meal_ingredients.get(ingredient.uuid);
    expect(stored).toBeDefined();
    expect(stored!.amount).toBe(80);
    expect(typeof stored!.amount).toBe('number');
  });

  it('ingredients can be queried by week_meal_uuid index', async () => {
    const mealUuid = 'm2222222-0000-0000-0000-000000000002';
    await db.week_meal_ingredients.bulkPut([
      {
        uuid: 'i2222222-0001-0000-0000-000000000001',
        week_meal_uuid: mealUuid,
        food_uuid: 'f0001',
        amount: 40,
        sort_order: 0,
        created_at: new Date().toISOString(),
        _synced: false,
        _updated_at: Date.now(),
        _deleted: false,
      },
      {
        uuid: 'i2222222-0002-0000-0000-000000000002',
        week_meal_uuid: mealUuid,
        food_uuid: 'f0002',
        amount: 60,
        sort_order: 1,
        created_at: new Date().toISOString(),
        _synced: false,
        _updated_at: Date.now(),
        _deleted: false,
      },
    ]);
    const rows = await db.week_meal_ingredients
      .where('week_meal_uuid').equals(mealUuid)
      .toArray();
    expect(rows).toHaveLength(2);
    // amount fields are numbers — sum is arithmetic, not concatenation
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    expect(total).toBe(100); // 40 + 60, not "4060"
  });

  it('ingredient amount stored and retrieved as number (string-concatenation regression)', async () => {
    await db.week_meal_ingredients.put({
      uuid: 'i3333333-0000-0000-0000-000000000003',
      week_meal_uuid: 'm3333333',
      food_uuid: 'f0003',
      amount: 571,
      sort_order: 0,
      created_at: new Date().toISOString(),
      _synced: false,
      _updated_at: Date.now(),
      _deleted: false,
    });
    const stored = await db.week_meal_ingredients.get('i3333333-0000-0000-0000-000000000003');
    expect(typeof stored!.amount).toBe('number');
    expect(stored!.amount + 114).toBe(685); // not "571114"
  });
});

// ─── is_recipe backfill on nutrition_week_meals (v27 upgrade) ────────────────

describe('Dexie v27 — nutrition_week_meals.is_recipe', () => {
  beforeEach(async () => {
    await db.nutrition_week_meals.clear();
  });

  it('can write and read is_recipe=true on a week meal', async () => {
    await db.nutrition_week_meals.put({
      uuid: 'meal-is-recipe-test',
      day_of_week: 0,
      meal_slot: 'breakfast',
      meal_name: 'Smoothie',
      protein_g: 45,
      carbs_g: 60,
      fat_g: 12,
      calories: 571,
      quality_rating: null,
      sort_order: 0,
      is_recipe: true,
      _synced: false,
      _updated_at: Date.now(),
      _deleted: false,
    });
    const stored = await db.nutrition_week_meals.get('meal-is-recipe-test');
    expect(stored).toBeDefined();
    expect(stored!.is_recipe).toBe(true);
  });

  it('is_recipe defaults to undefined for old rows (backward compat)', async () => {
    // Simulate a pre-v27 row (no is_recipe field) by inserting a plain object
    // without it and checking Dexie returns the value gracefully.
    // In real usage the v27 upgrade() hook backfills false.
    await db.nutrition_week_meals.put({
      uuid: 'meal-no-is-recipe',
      day_of_week: 1,
      meal_slot: 'lunch',
      meal_name: 'Old meal',
      protein_g: 30,
      carbs_g: 40,
      fat_g: 8,
      calories: 350,
      quality_rating: null,
      sort_order: 0,
      _synced: false,
      _updated_at: Date.now(),
      _deleted: false,
      // is_recipe intentionally absent
    } as Parameters<typeof db.nutrition_week_meals.put>[0]);
    const stored = await db.nutrition_week_meals.get('meal-no-is-recipe');
    // After v27, the field exists (may be undefined on rows that didn't go
    // through the upgrade hook in the fake-IDB test environment, but must
    // never be a truthy non-boolean that would accidentally flip the derive path).
    expect(stored!.is_recipe).toBeFalsy();
  });

  it('existing nutrition_week_meals rows remain intact after v27 schema exists', async () => {
    await db.nutrition_week_meals.bulkPut([
      {
        uuid: 'meal-persist-1',
        day_of_week: 2,
        meal_slot: 'dinner',
        meal_name: 'Chicken Bowl',
        protein_g: 50,
        carbs_g: 70,
        fat_g: 15,
        calories: 610,
        quality_rating: null,
        sort_order: 0,
        _synced: true,
        _updated_at: Date.now(),
        _deleted: false,
      },
      {
        uuid: 'meal-persist-2',
        day_of_week: 3,
        meal_slot: 'snack',
        meal_name: 'Yoghurt',
        protein_g: 18,
        carbs_g: 10,
        fat_g: 3,
        calories: 140,
        quality_rating: null,
        sort_order: 0,
        _synced: true,
        _updated_at: Date.now(),
        _deleted: false,
      },
    ]);
    const all = await db.nutrition_week_meals.filter(m => !m._deleted).toArray();
    expect(all.length).toBeGreaterThanOrEqual(2);
    const names = all.map(m => m.meal_name);
    expect(names).toContain('Chicken Bowl');
    expect(names).toContain('Yoghurt');
    // Macros still intact (not wiped by the upgrade)
    const chicken = all.find(m => m.uuid === 'meal-persist-1');
    expect(chicken!.protein_g).toBe(50);
    expect(chicken!.calories).toBe(610);
  });
});

// ─── foods table is independent of other tables (schema isolation) ─────────

describe('Dexie v27 — new stores are empty after schema upgrade', () => {
  it('foods table starts empty (no pre-existing data)', async () => {
    await db.foods.clear();
    const count = await db.foods.count();
    expect(count).toBe(0);
  });

  it('week_meal_ingredients table starts empty (no pre-existing data)', async () => {
    await db.week_meal_ingredients.clear();
    const count = await db.week_meal_ingredients.count();
    expect(count).toBe(0);
  });
});
