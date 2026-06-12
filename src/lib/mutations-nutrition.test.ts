import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/db/local';
import { ensurePlannedLogsForDate, setWeekMeal } from './mutations-nutrition';
import type { LocalFood, LocalWeekMealIngredient } from '@/db/local';

vi.mock('@/lib/sync', () => ({
  syncEngine: { schedulePush: vi.fn() },
}));

// dateToDayOfWeek('2026-05-04'): Monday → 0 (schema uses 0=Mon..6=Sun).
const MONDAY = '2026-05-04';
const TUESDAY = '2026-05-05';

describe('ensurePlannedLogsForDate', () => {
  beforeEach(async () => {
    await Promise.all([
      db.nutrition_logs.clear(),
      db.nutrition_week_meals.clear(),
      db.nutrition_day_notes.clear(),
    ]);
  });

  it('materializes the standard-week template into nutrition_logs for the matching DOW', async () => {
    await setWeekMeal({
      day_of_week: 0,
      meal_slot: 'breakfast',
      meal_name: 'Oats',
      calories: 350,
      protein_g: 20,
    });
    await setWeekMeal({
      day_of_week: 0,
      meal_slot: 'lunch',
      meal_name: 'Salad',
      calories: 500,
      protein_g: 35,
    });

    await ensurePlannedLogsForDate(MONDAY);

    const logs = await db.nutrition_logs
      .filter(l => l.logged_at.startsWith(MONDAY))
      .toArray();
    expect(logs).toHaveLength(2);

    const breakfast = logs.find(l => l.meal_type === 'breakfast');
    expect(breakfast).toMatchObject({
      meal_name: 'Oats',
      calories: 350,
      protein_g: 20,
      status: 'planned',
    });
    expect(breakfast?.template_meal_id).toBeTruthy();

    const lunch = logs.find(l => l.meal_type === 'lunch');
    expect(lunch).toMatchObject({
      meal_name: 'Salad',
      calories: 500,
      status: 'planned',
    });
  });

  it('stamps day_notes.template_applied_at so re-runs are no-ops', async () => {
    await setWeekMeal({ day_of_week: 0, meal_slot: 'snack', meal_name: 'Apple' });

    await ensurePlannedLogsForDate(MONDAY);
    const note = await db.nutrition_day_notes.filter(n => n.date === MONDAY).first();
    expect(note?.template_applied_at).toBeTruthy();

    // Run again — should not duplicate logs.
    await ensurePlannedLogsForDate(MONDAY);
    const logs = await db.nutrition_logs
      .filter(l => l.logged_at.startsWith(MONDAY))
      .toArray();
    expect(logs).toHaveLength(1);
  });

  it('does not resurrect logs the user has soft-deleted', async () => {
    await setWeekMeal({ day_of_week: 0, meal_slot: 'breakfast', meal_name: 'Oats' });

    await ensurePlannedLogsForDate(MONDAY);
    const original = await db.nutrition_logs.filter(l => l.logged_at.startsWith(MONDAY)).toArray();
    const id = original[0].uuid;

    // User deletes the planned row, then clears the day-note stamp to simulate
    // a stale client (or admin reset). The cross-device guard should still
    // prevent recreating a row whose template_meal_id is already in use.
    await db.nutrition_logs.update(id, { _deleted: true });
    const note = await db.nutrition_day_notes.filter(n => n.date === MONDAY).first();
    if (note) await db.nutrition_day_notes.update(note.uuid, { template_applied_at: null });

    await ensurePlannedLogsForDate(MONDAY);
    const all = await db.nutrition_logs.filter(l => l.logged_at.startsWith(MONDAY)).toArray();
    // Only the soft-deleted original — no fresh row resurrected.
    expect(all).toHaveLength(1);
    expect(all[0]._deleted).toBe(true);
  });

  it('stamps the day note even when the DOW has no template (so we do not re-scan forever)', async () => {
    // Tuesday has no template meals.
    await ensurePlannedLogsForDate(TUESDAY);
    const note = await db.nutrition_day_notes.filter(n => n.date === TUESDAY).first();
    expect(note?.template_applied_at).toBeTruthy();
    const logs = await db.nutrition_logs
      .filter(l => l.logged_at.startsWith(TUESDAY))
      .toArray();
    expect(logs).toHaveLength(0);
  });

  it('rejects malformed date strings without throwing', async () => {
    await expect(ensurePlannedLogsForDate('not-a-date')).resolves.toBeUndefined();
    const all = await db.nutrition_day_notes.toArray();
    expect(all).toHaveLength(0);
  });
});

// ─── U5: effective macros at materialization time (client path) ───────────────

describe('ensurePlannedLogsForDate — U5 effective-macro materialization', () => {
  beforeEach(async () => {
    await Promise.all([
      db.nutrition_logs.clear(),
      db.nutrition_week_meals.clear(),
      db.nutrition_day_notes.clear(),
      db.foods.clear(),
      db.week_meal_ingredients.clear(),
    ]);
  });

  /** Helper: write a LocalFood directly to Dexie. */
  async function seedFood(overrides: Partial<LocalFood> & { uuid: string; name: string }): Promise<LocalFood> {
    const food: LocalFood = {
      per_unit: 'g',
      per_qty: 100,
      calories: 400,
      protein_g: 20,
      carbs_g: 60,
      fat_g: 8,
      nutrients: {},
      source: 'manual',
      archived_at: null,
      created_at: new Date().toISOString(),
      brand: null,
      _synced: false,
      _updated_at: Date.now(),
      _deleted: false,
      ...overrides,
    };
    await db.foods.put(food);
    return food;
  }

  /** Helper: write a LocalWeekMealIngredient directly to Dexie. */
  async function seedIngredient(
    uuid: string,
    week_meal_uuid: string,
    food_uuid: string,
    amount: number,
    sort_order = 0,
  ): Promise<void> {
    const ing: LocalWeekMealIngredient = {
      uuid,
      week_meal_uuid,
      food_uuid,
      amount,
      sort_order,
      created_at: new Date().toISOString(),
      _synced: false,
      _updated_at: Date.now(),
      _deleted: false,
    };
    await db.week_meal_ingredients.put(ing);
  }

  it('recipe meal (is_recipe=true): log carries derived macros, not stored aggregate', async () => {
    // Oats food: 389 kcal / 17 pro / 66 carb / 7 fat per 100g
    const oats = await seedFood({
      uuid: 'food-oats',
      name: 'Oats',
      per_unit: 'g',
      per_qty: 100,
      calories: 389,
      protein_g: 17,
      carbs_g: 66,
      fat_g: 7,
    });

    // Protein powder: 120 kcal / 25 pro / 3 carb / 2 fat per 1 serve
    const pp = await seedFood({
      uuid: 'food-pp',
      name: 'Protein Powder',
      per_unit: 'serve',
      per_qty: 1,
      calories: 120,
      protein_g: 25,
      carbs_g: 3,
      fat_g: 2,
    });

    // Create a recipe meal for Monday with stale stored aggregate (999 each).
    // The stale values should NOT appear in the materialized log.
    const mealId = await setWeekMeal({
      day_of_week: 0,
      meal_slot: 'breakfast',
      meal_name: 'Protein Smoothie',
      calories: 999,   // stale stored aggregate — should be ignored for recipe meals
      protein_g: 999,
      carbs_g: 999,
      fat_g: 999,
    });
    // Directly set is_recipe=true (setWeekMeal doesn't expose this yet)
    await db.nutrition_week_meals.update(mealId, { is_recipe: true });

    // Seed ingredients: 80g oats + 2 serves protein powder
    await seedIngredient('ing-1', mealId, oats.uuid, 80);
    await seedIngredient('ing-2', mealId, pp.uuid, 2, 1);

    await ensurePlannedLogsForDate(MONDAY);

    const logs = await db.nutrition_logs
      .filter(l => l.logged_at.startsWith(MONDAY))
      .toArray();
    expect(logs).toHaveLength(1);

    const log = logs[0];
    // Expected derived macros:
    //   oats 80g:       0.8 × {389, 17, 66, 7} = {311.2, 13.6, 52.8, 5.6}
    //   pp 2 serves:    2   × {120, 25,  3, 2} = {240,   50,    6,   4}
    //   total:                                   {551.2, 63.6, 58.8, 9.6}
    expect(log.calories).toBeCloseTo(551.2, 1);
    expect(log.protein_g).toBeCloseTo(63.6, 1);
    expect(log.carbs_g).toBeCloseTo(58.8, 1);
    expect(log.fat_g).toBeCloseTo(9.6, 1);

    // Sanity: the stale 999s were NOT written
    expect(log.calories).not.toBe(999);
    expect(log.protein_g).not.toBe(999);

    // Structural fields preserved
    expect(log.status).toBe('planned');
    expect(log.template_meal_id).toBe(mealId);
    expect(log.meal_name).toBe('Protein Smoothie');
  });

  it('flat meal (is_recipe=false): log carries stored aggregate macros unchanged (regression)', async () => {
    const mealId = await setWeekMeal({
      day_of_week: 0,
      meal_slot: 'lunch',
      meal_name: 'Chicken Rice',
      calories: 570,
      protein_g: 40,
      carbs_g: 80,
      fat_g: 10,
    });
    // is_recipe defaults to false — no ingredients seeded, no update needed.

    await ensurePlannedLogsForDate(MONDAY);

    const logs = await db.nutrition_logs
      .filter(l => l.logged_at.startsWith(MONDAY))
      .toArray();
    expect(logs).toHaveLength(1);
    const log = logs[0];

    // Must carry stored aggregate exactly (no ingredient derivation).
    expect(log.calories).toBe(570);
    expect(log.protein_g).toBe(40);
    expect(log.carbs_g).toBe(80);
    expect(log.fat_g).toBe(10);
    expect(log.status).toBe('planned');
  });

  it('recipe meal with no ingredients → log has null macros (mirrors SQL SUM over empty set)', async () => {
    const mealId = await setWeekMeal({
      day_of_week: 0,
      meal_slot: 'snack',
      meal_name: 'Empty Recipe',
      calories: 400,
      protein_g: 30,
      carbs_g: 40,
      fat_g: 10,
    });
    await db.nutrition_week_meals.update(mealId, { is_recipe: true });
    // No ingredients seeded.

    await ensurePlannedLogsForDate(MONDAY);

    const logs = await db.nutrition_logs
      .filter(l => l.logged_at.startsWith(MONDAY))
      .toArray();
    expect(logs).toHaveLength(1);
    const log = logs[0];
    // Empty recipe → all macros null (same as SQL SUM of nothing)
    expect(log.calories).toBeNull();
    expect(log.protein_g).toBeNull();
    expect(log.carbs_g).toBeNull();
    expect(log.fat_g).toBeNull();
  });

  it('past logs are immutable snapshots: already-stamped dates not rewritten even if ingredients change', async () => {
    // Seed a flat meal
    const mealId = await setWeekMeal({
      day_of_week: 0,
      meal_slot: 'breakfast',
      meal_name: 'Static Meal',
      calories: 400,
      protein_g: 30,
      carbs_g: 50,
      fat_g: 8,
    });

    // First fill: stamped with stored macros.
    await ensurePlannedLogsForDate(MONDAY);
    const firstLog = await db.nutrition_logs
      .filter(l => l.logged_at.startsWith(MONDAY))
      .first();
    expect(firstLog?.calories).toBe(400);

    // Now "convert to recipe" and add an ingredient.
    const oats = await seedFood({ uuid: 'food-oats2', name: 'Oats2', per_qty: 100, calories: 200 });
    await db.nutrition_week_meals.update(mealId, { is_recipe: true });
    await seedIngredient('ing-x', mealId, oats.uuid, 100);

    // Attempt to re-fill the SAME already-stamped date.
    await ensurePlannedLogsForDate(MONDAY);

    // Should still be only 1 log (idempotency gate), and with original macros.
    const logs = await db.nutrition_logs
      .filter(l => l.logged_at.startsWith(MONDAY) && !l._deleted)
      .toArray();
    expect(logs).toHaveLength(1);
    // Original materialized log is NOT rewritten — past logs are immutable.
    expect(logs[0].calories).toBe(400);
    expect(logs[0].calories).not.toBe(200); // derived would be 200 if rewritten
  });

  it('mixed day: recipe + flat meals in the same day each carry correct macros', async () => {
    // Flat meal
    const flatId = await setWeekMeal({
      day_of_week: 0,
      meal_slot: 'lunch',
      meal_name: 'Chicken Rice',
      calories: 570,
      protein_g: 40,
      carbs_g: 80,
      fat_g: 10,
    });

    // Recipe meal
    const recipeId = await setWeekMeal({
      day_of_week: 0,
      meal_slot: 'breakfast',
      meal_name: 'Smoothie',
      calories: 999, // stale
      protein_g: 999,
      carbs_g: 999,
      fat_g: 999,
    });
    await db.nutrition_week_meals.update(recipeId, { is_recipe: true });

    // One ingredient: 100g oats (per 100g: 389/17/66/7) → full macros
    const oats = await seedFood({
      uuid: 'food-oats3',
      name: 'Oats3',
      per_unit: 'g',
      per_qty: 100,
      calories: 389,
      protein_g: 17,
      carbs_g: 66,
      fat_g: 7,
    });
    await seedIngredient('ing-mix', recipeId, oats.uuid, 100);

    await ensurePlannedLogsForDate(MONDAY);

    const logs = await db.nutrition_logs
      .filter(l => l.logged_at.startsWith(MONDAY) && !l._deleted)
      .toArray();
    expect(logs).toHaveLength(2);

    const lunchLog = logs.find(l => l.meal_type === 'lunch');
    expect(lunchLog?.calories).toBe(570);   // flat stored
    expect(lunchLog?.protein_g).toBe(40);

    const breakfastLog = logs.find(l => l.meal_type === 'breakfast');
    expect(breakfastLog?.calories).toBeCloseTo(389, 1);  // derived: 100/100 × 389
    expect(breakfastLog?.protein_g).toBeCloseTo(17, 1);
    expect(breakfastLog?.carbs_g).toBeCloseTo(66, 1);
    expect(breakfastLog?.fat_g).toBeCloseTo(7, 1);
  });
});
