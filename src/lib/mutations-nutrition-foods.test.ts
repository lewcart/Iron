/**
 * Tests for src/lib/mutations-nutrition-foods.ts
 *
 * Key coverage:
 *   - addMealIngredient: normal insert path
 *   - addMealIngredient: duplicate-safe — same (meal, food) pair → UPDATE existing,
 *     no second row (F1 regression guard)
 *   - updateMealIngredientAmount / removeMealIngredient: happy paths
 *
 * Uses fake-indexeddb so real Dexie runs without a browser.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/db/local';
import {
  addMealIngredient,
  updateMealIngredientAmount,
  removeMealIngredient,
} from './mutations-nutrition-foods';

vi.mock('@/lib/sync', () => ({
  syncEngine: { schedulePush: vi.fn() },
}));

const MEAL_UUID = 'meal-1111-2222-3333-444444444444';
const FOOD_UUID = 'food-aaaa-bbbb-cccc-dddddddddddd';

beforeEach(async () => {
  await db.week_meal_ingredients.clear();
});

// ─── addMealIngredient: normal path ──────────────────────────────────────────

describe('addMealIngredient — normal insert', () => {
  it('inserts a new ingredient row', async () => {
    const row = await addMealIngredient({
      week_meal_uuid: MEAL_UUID,
      food_uuid: FOOD_UUID,
      amount: 100,
    });
    expect(row.uuid).toBeTruthy();
    expect(row.amount).toBe(100);

    const stored = await db.week_meal_ingredients.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].food_uuid).toBe(FOOD_UUID);
    expect(stored[0].amount).toBe(100);
  });

  it('assigns sort_order = 0 for the first ingredient', async () => {
    const row = await addMealIngredient({
      week_meal_uuid: MEAL_UUID,
      food_uuid: FOOD_UUID,
      amount: 50,
    });
    expect(row.sort_order).toBe(0);
  });

  it('throws INVALID_QUANTITY for amount <= 0', async () => {
    await expect(
      addMealIngredient({ week_meal_uuid: MEAL_UUID, food_uuid: FOOD_UUID, amount: 0 }),
    ).rejects.toThrow('INVALID_QUANTITY');
  });

  it('throws INVALID_QUANTITY for non-finite amount', async () => {
    await expect(
      addMealIngredient({ week_meal_uuid: MEAL_UUID, food_uuid: FOOD_UUID, amount: NaN }),
    ).rejects.toThrow('INVALID_QUANTITY');
  });
});

// ─── addMealIngredient: duplicate-safe (F1 regression guard) ─────────────────

describe('addMealIngredient — duplicate-safe (F1)', () => {
  it('adding the same food twice → exactly one row, amount combined', async () => {
    // First add: 80g
    await addMealIngredient({ week_meal_uuid: MEAL_UUID, food_uuid: FOOD_UUID, amount: 80 });

    // Second add: same (meal, food), 40g more
    const updated = await addMealIngredient({
      week_meal_uuid: MEAL_UUID,
      food_uuid: FOOD_UUID,
      amount: 40,
    });

    // Still exactly one row
    const all = await db.week_meal_ingredients
      .filter(i => i.week_meal_uuid === MEAL_UUID && !i._deleted)
      .toArray();
    expect(all).toHaveLength(1);

    // Amount is additive (80 + 40 = 120)
    expect(all[0].amount).toBe(120);
    expect(updated.amount).toBe(120);
  });

  it('second add reuses the original row uuid', async () => {
    const first = await addMealIngredient({
      week_meal_uuid: MEAL_UUID,
      food_uuid: FOOD_UUID,
      amount: 50,
    });
    const second = await addMealIngredient({
      week_meal_uuid: MEAL_UUID,
      food_uuid: FOOD_UUID,
      amount: 50,
    });

    expect(second.uuid).toBe(first.uuid);
  });

  it('different food uuids on the same meal each get their own row', async () => {
    const FOOD_UUID_2 = 'food-bbbb-cccc-dddd-eeeeeeeeeeee';
    await addMealIngredient({ week_meal_uuid: MEAL_UUID, food_uuid: FOOD_UUID, amount: 80 });
    await addMealIngredient({ week_meal_uuid: MEAL_UUID, food_uuid: FOOD_UUID_2, amount: 60 });

    const all = await db.week_meal_ingredients
      .filter(i => i.week_meal_uuid === MEAL_UUID && !i._deleted)
      .toArray();
    expect(all).toHaveLength(2);
  });

  it('same food on different meals each get their own row', async () => {
    const MEAL_UUID_2 = 'meal-5555-6666-7777-888888888888';
    await addMealIngredient({ week_meal_uuid: MEAL_UUID, food_uuid: FOOD_UUID, amount: 80 });
    await addMealIngredient({ week_meal_uuid: MEAL_UUID_2, food_uuid: FOOD_UUID, amount: 80 });

    const all = await db.week_meal_ingredients
      .filter(i => !i._deleted)
      .toArray();
    expect(all).toHaveLength(2);
  });

  it('soft-deleted duplicate is treated as non-existing (inserts fresh row)', async () => {
    // Insert then soft-delete
    const first = await addMealIngredient({
      week_meal_uuid: MEAL_UUID,
      food_uuid: FOOD_UUID,
      amount: 80,
    });
    await removeMealIngredient(first.uuid);

    // Add again — should insert a new row, not update the deleted one
    const second = await addMealIngredient({
      week_meal_uuid: MEAL_UUID,
      food_uuid: FOOD_UUID,
      amount: 40,
    });

    expect(second.uuid).not.toBe(first.uuid);
    expect(second.amount).toBe(40);

    // Two rows total: one deleted, one fresh
    const all = await db.week_meal_ingredients.toArray();
    expect(all).toHaveLength(2);
    const active = all.filter(i => !i._deleted);
    expect(active).toHaveLength(1);
    expect(active[0].amount).toBe(40);
  });
});

// ─── updateMealIngredientAmount ───────────────────────────────────────────────

describe('updateMealIngredientAmount', () => {
  it('updates the amount on an existing row', async () => {
    const row = await addMealIngredient({
      week_meal_uuid: MEAL_UUID,
      food_uuid: FOOD_UUID,
      amount: 80,
    });

    await updateMealIngredientAmount(row.uuid, 150);

    const stored = await db.week_meal_ingredients.get(row.uuid);
    expect(stored?.amount).toBe(150);
  });

  it('throws INVALID_QUANTITY for amount <= 0', async () => {
    const row = await addMealIngredient({
      week_meal_uuid: MEAL_UUID,
      food_uuid: FOOD_UUID,
      amount: 80,
    });
    await expect(updateMealIngredientAmount(row.uuid, -1)).rejects.toThrow('INVALID_QUANTITY');
  });
});

// ─── removeMealIngredient ─────────────────────────────────────────────────────

describe('removeMealIngredient', () => {
  it('soft-deletes the row (_deleted = true)', async () => {
    const row = await addMealIngredient({
      week_meal_uuid: MEAL_UUID,
      food_uuid: FOOD_UUID,
      amount: 80,
    });

    await removeMealIngredient(row.uuid);

    const stored = await db.week_meal_ingredients.get(row.uuid);
    expect(stored?._deleted).toBe(true);
  });
});
