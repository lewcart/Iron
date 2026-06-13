/**
 * Tests for the ingredient-aware MCP nutrition surface (migration 052 additions).
 *
 * Covers:
 *  - resolveFood by uuid / by name (server-side, via mocked queryOne)
 *  - create_food idempotent by lower(name)+source
 *  - set_meal_ingredients: composes a recipe, flips is_recipe, get_nutrition_plan
 *    then returns derived macros + ingredients
 *  - add_meal_ingredient: adds ingredient + does not throw on duplicate (upsert)
 *  - update_meal_ingredient
 *  - remove_meal_ingredient
 *  - FOOD_NOT_FOUND on unknown name passed to set_meal_ingredients
 *  - convert_week_meal_to_recipe idempotent
 *  - get_nutrition_plan and get_active_nutrition_plan return is_recipe + ingredients
 *
 * All DB calls are mocked — no live Postgres required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock @/db/db before any SUT import ──────────────────────────────────────

const queryMock = vi.fn();
const queryOneMock = vi.fn();
const transactionMock = vi.fn();

vi.mock('@/db/db', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  queryOne: (...args: unknown[]) => queryOneMock(...args),
  transaction: (...args: unknown[]) => transactionMock(...args),
}));

// ─── SUT ──────────────────────────────────────────────────────────────────────

import { nutritionTools } from './nutrition-tools';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

function parseText(result: ToolResult) {
  return JSON.parse(result.content[0].text);
}

function tool(name: string) {
  const t = nutritionTools.find(t => t.name === name);
  if (!t) throw new Error(`Tool "${name}" not found in nutritionTools`);
  return async (args: Record<string, unknown>) => (await t.execute(args)) as ToolResult;
}

const createFood = tool('create_food');
const convertToRecipe = tool('convert_week_meal_to_recipe');
const setMealIngredients = tool('set_meal_ingredients');
const addMealIngredient = tool('add_meal_ingredient');
const updateMealIngredient = tool('update_meal_ingredient');
const removeMealIngredient = tool('remove_meal_ingredient');
const getNutritionPlan = tool('get_nutrition_plan');
const getActiveNutritionPlan = tool('get_active_nutrition_plan');

beforeEach(() => {
  queryMock.mockReset();
  queryOneMock.mockReset();
  transactionMock.mockReset();
  // Default: transaction resolves immediately
  transactionMock.mockResolvedValue(undefined);
});

// ─── create_food ──────────────────────────────────────────────────────────────

describe('create_food', () => {
  it('CF1: creates a new food row and returns uuid', async () => {
    queryOneMock
      .mockResolvedValueOnce(null)                          // dedupe check → not found
      .mockResolvedValueOnce({ uuid: 'food-1', name: 'Oats' }); // INSERT RETURNING

    const r = await createFood({ name: 'Oats', per_unit: 'g', per_qty: 100, calories: 389, protein_g: 17, carbs_g: 66, fat_g: 7 });
    expect(r.isError).toBeUndefined();
    const body = parseText(r);
    expect(body.uuid).toBe('food-1');
    expect(body.deduplicated).toBeUndefined();
  });

  it('CF2: idempotent — returns existing uuid without inserting when lower(name) matches', async () => {
    queryOneMock.mockResolvedValueOnce({ uuid: 'existing-123' }); // dedupe hit

    const r = await createFood({ name: 'oats', per_unit: 'g', per_qty: 100, calories: 389, protein_g: 17, carbs_g: 66, fat_g: 7 });
    expect(r.isError).toBeUndefined();
    const body = parseText(r);
    expect(body.uuid).toBe('existing-123');
    expect(body.deduplicated).toBe(true);
    // Only one queryOne call (dedupe check) — no INSERT
    expect(queryOneMock).toHaveBeenCalledTimes(1);
  });

  it('CF3: rejects invalid per_unit', async () => {
    const r = await createFood({ name: 'Widget', per_unit: 'oz', per_qty: 1, calories: 100, protein_g: 5, carbs_g: 10, fat_g: 2 });
    expect(r.isError).toBe(true);
    const body = parseText(r);
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toMatch(/per_unit/);
  });

  it('CF4: rejects missing name', async () => {
    const r = await createFood({ per_unit: 'g', per_qty: 100 });
    expect(r.isError).toBe(true);
    const body = parseText(r);
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('CF5: rejects per_qty ≤ 0', async () => {
    const r = await createFood({ name: 'Test', per_unit: 'g', per_qty: 0, calories: 100, protein_g: 5, carbs_g: 10, fat_g: 2 });
    expect(r.isError).toBe(true);
    expect(parseText(r).error.code).toBe('INVALID_INPUT');
  });
});

// ─── convert_week_meal_to_recipe ──────────────────────────────────────────────

describe('convert_week_meal_to_recipe', () => {
  it('CMR1: sets is_recipe=true on a known meal', async () => {
    queryOneMock.mockResolvedValueOnce({ uuid: 'meal-1', is_recipe: true });
    const r = await convertToRecipe({ week_meal_uuid: 'meal-1' });
    expect(r.isError).toBeUndefined();
    const body = parseText(r);
    expect(body.uuid).toBe('meal-1');
    expect(body.is_recipe).toBe(true);
  });

  it('CMR2: idempotent — succeeds even if already a recipe', async () => {
    queryOneMock.mockResolvedValueOnce({ uuid: 'meal-2', is_recipe: true });
    const r = await convertToRecipe({ week_meal_uuid: 'meal-2' });
    expect(r.isError).toBeUndefined();
  });

  it('CMR3: returns NOT_FOUND when meal does not exist', async () => {
    queryOneMock.mockResolvedValueOnce(null);
    const r = await convertToRecipe({ week_meal_uuid: 'ghost' });
    expect(r.isError).toBe(true);
    expect(parseText(r).error.code).toBe('NOT_FOUND');
  });

  it('CMR4: requires week_meal_uuid', async () => {
    const r = await convertToRecipe({});
    expect(r.isError).toBe(true);
    expect(parseText(r).error.code).toBe('INVALID_INPUT');
  });
});

// ─── set_meal_ingredients ─────────────────────────────────────────────────────

describe('set_meal_ingredients', () => {
  // Shared food fixtures
  const foodOats = { uuid: 'food-oats', name: 'Oats', per_unit: 'g', per_qty: 100, calories: 389, protein_g: 17, carbs_g: 66, fat_g: 7 };
  const foodProtein = { uuid: 'food-pp', name: 'Protein Powder', per_unit: 'serve', per_qty: 1, calories: 120, protein_g: 25, carbs_g: 3, fat_g: 2 };

  // Ingredient rows that fetchIngredientsForMeals would return (contribution already computed)
  const ingredientRows = [
    { uuid: 'ing-1', food_uuid: 'food-oats', food_name: 'Oats', amount: 80, per_unit: 'g', per_qty: 100,
      calories: (80 / 100) * 389, protein_g: (80 / 100) * 17, carbs_g: (80 / 100) * 66, fat_g: (80 / 100) * 7, sort_order: 0,
      week_meal_uuid: 'meal-1' },
    { uuid: 'ing-2', food_uuid: 'food-pp', food_name: 'Protein Powder', amount: 2, per_unit: 'serve', per_qty: 1,
      calories: 2 * 120, protein_g: 2 * 25, carbs_g: 2 * 3, fat_g: 2 * 2, sort_order: 1,
      week_meal_uuid: 'meal-1' },
  ];

  it('SMI1: resolves foods by uuid, replaces ingredients, flips is_recipe=true', async () => {
    // resolveFood calls: 2 foods by uuid
    queryOneMock
      .mockResolvedValueOnce(foodOats)    // resolveFood for oats
      .mockResolvedValueOnce(foodProtein) // resolveFood for protein powder
      .mockResolvedValueOnce({ uuid: 'meal-1' }); // meal exists check

    // fetchIngredientsForMeals → query call returns ingredient rows
    queryMock.mockResolvedValueOnce(ingredientRows);

    const r = await setMealIngredients({
      week_meal_uuid: 'meal-1',
      ingredients: [
        { food_uuid: 'food-oats', amount: 80 },
        { food_uuid: 'food-pp', amount: 2 },
      ],
    });

    expect(r.isError).toBeUndefined();
    const body = parseText(r);
    expect(body.is_recipe).toBe(true);
    expect(body.week_meal_uuid).toBe('meal-1');
    expect(body.ingredients).toHaveLength(2);

    // Transaction was called (DELETE + UPDATE + 2 INSERTs = 4 statements)
    expect(transactionMock).toHaveBeenCalledTimes(1);
    const [statements] = transactionMock.mock.calls[0];
    expect(statements.length).toBe(4); // DELETE + UPDATE is_recipe + 2 INSERTs
  });

  it('SMI2: resolves food by name', async () => {
    queryOneMock
      .mockResolvedValueOnce(foodOats)     // resolveFood by name
      .mockResolvedValueOnce({ uuid: 'meal-1' });
    queryMock.mockResolvedValueOnce([ingredientRows[0]]);

    const r = await setMealIngredients({
      week_meal_uuid: 'meal-1',
      ingredients: [{ food_name: 'Oats', amount: 80 }],
    });
    expect(r.isError).toBeUndefined();
  });

  it('SMI3: returns FOOD_NOT_FOUND with hint when food_name not found', async () => {
    queryOneMock.mockResolvedValueOnce(null); // resolveFood → not found

    const r = await setMealIngredients({
      week_meal_uuid: 'meal-1',
      ingredients: [{ food_name: 'Unicorn Dust', amount: 10 }],
    });
    expect(r.isError).toBe(true);
    const body = parseText(r);
    expect(body.error.code).toBe('FOOD_NOT_FOUND');
    expect(body.error.hint).toMatch(/create_food/);
  });

  it('SMI4: returns NOT_FOUND when meal does not exist', async () => {
    queryOneMock
      .mockResolvedValueOnce(foodOats)  // resolveFood ok
      .mockResolvedValueOnce(null);     // meal check → not found

    const r = await setMealIngredients({
      week_meal_uuid: 'ghost-meal',
      ingredients: [{ food_uuid: 'food-oats', amount: 80 }],
    });
    expect(r.isError).toBe(true);
    expect(parseText(r).error.code).toBe('NOT_FOUND');
  });

  it('SMI5: rejects ingredient with amount ≤ 0', async () => {
    queryOneMock.mockResolvedValueOnce(foodOats); // resolveFood ok

    const r = await setMealIngredients({
      week_meal_uuid: 'meal-1',
      ingredients: [{ food_uuid: 'food-oats', amount: 0 }],
    });
    expect(r.isError).toBe(true);
    expect(parseText(r).error.code).toBe('INVALID_INPUT');
  });

  it('SMI6: get_nutrition_plan returns is_recipe + ingredients for recipe meal', async () => {
    // get_nutrition_plan query (effective view JOIN)
    const planRow = {
      uuid: 'meal-1', day_of_week: 0, meal_slot: 'breakfast', meal_name: 'Oat shake',
      calories: (80 / 100) * 389 + 2 * 120,
      protein_g: (80 / 100) * 17 + 2 * 25,
      carbs_g: (80 / 100) * 66 + 2 * 3,
      fat_g: (80 / 100) * 7 + 2 * 2,
      quality_rating: null, sort_order: 0, is_recipe: true,
    };
    queryMock
      .mockResolvedValueOnce([planRow])      // meals query
      .mockResolvedValueOnce(ingredientRows); // fetchIngredientsForMeals

    queryOneMock.mockResolvedValueOnce(null); // targets (no compliance)

    const r = await getNutritionPlan({});
    expect(r.isError).toBeUndefined();
    const body = parseText(r);
    const meal = body.week_plan[0].meals[0];
    expect(meal.is_recipe).toBe(true);
    expect(meal.ingredients).toHaveLength(2);
    // Calories should be derived (stored in effective view mock values)
    expect(meal.calories).toBeCloseTo((80 / 100) * 389 + 2 * 120, 2);
  });

  it('SMI7: get_active_nutrition_plan returns is_recipe + ingredients', async () => {
    const planRow = {
      uuid: 'meal-1', day_of_week: 0, meal_slot: 'breakfast', meal_name: 'Oat shake',
      calories: 551, protein_g: 63, carbs_g: 57, fat_g: 9,
      quality_rating: null, sort_order: 0, is_recipe: true,
    };
    queryMock
      .mockResolvedValueOnce([planRow])
      .mockResolvedValueOnce(ingredientRows);

    const r = await getActiveNutritionPlan({});
    expect(r.isError).toBeUndefined();
    const body = parseText(r);
    expect(body[0].is_recipe).toBe(true);
    expect(body[0].ingredients).toHaveLength(2);
  });
});

// ─── add_meal_ingredient ──────────────────────────────────────────────────────

describe('add_meal_ingredient', () => {
  const foodOats = { uuid: 'food-oats', name: 'Oats', per_unit: 'g', per_qty: 100, calories: 389, protein_g: 17, carbs_g: 66, fat_g: 7 };

  it('AMI1: adds ingredient and sets is_recipe=true', async () => {
    queryOneMock
      .mockResolvedValueOnce(foodOats)         // resolveFood
      .mockResolvedValueOnce({ uuid: 'meal-1' }) // meal exists
      .mockResolvedValueOnce({ c: 0 });          // sort_order count

    const ingredientRow = {
      uuid: 'ing-1', food_uuid: 'food-oats', food_name: 'Oats', amount: 80,
      per_unit: 'g', per_qty: 100, calories: 311.2, protein_g: 13.6, carbs_g: 52.8, fat_g: 5.6,
      sort_order: 0, week_meal_uuid: 'meal-1',
    };
    queryMock.mockResolvedValueOnce([ingredientRow]);

    const r = await addMealIngredient({ week_meal_uuid: 'meal-1', food_uuid: 'food-oats', amount: 80 });
    expect(r.isError).toBeUndefined();
    const body = parseText(r);
    expect(body.is_recipe).toBe(true);
    expect(body.week_meal_uuid).toBe('meal-1');
    expect(body.ingredients).toHaveLength(1);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    // Transaction should have ON CONFLICT ... DO UPDATE (upsert)
    const [stmts] = transactionMock.mock.calls[0];
    expect(stmts[0].text).toMatch(/ON CONFLICT.*DO UPDATE/i);
  });

  it('AMI2: duplicate add does not throw — upsert updates amount', async () => {
    queryOneMock
      .mockResolvedValueOnce(foodOats)
      .mockResolvedValueOnce({ uuid: 'meal-1' })
      .mockResolvedValueOnce({ c: 1 });  // already has 1 ingredient

    queryMock.mockResolvedValueOnce([]);

    // Should not error even though food already attached
    const r = await addMealIngredient({ week_meal_uuid: 'meal-1', food_uuid: 'food-oats', amount: 100 });
    expect(r.isError).toBeUndefined();
  });

  it('AMI3: returns FOOD_NOT_FOUND when food not resolved', async () => {
    queryOneMock.mockResolvedValueOnce(null); // resolveFood → not found

    const r = await addMealIngredient({ week_meal_uuid: 'meal-1', food_name: 'Ghost Food', amount: 50 });
    expect(r.isError).toBe(true);
    expect(parseText(r).error.code).toBe('FOOD_NOT_FOUND');
  });

  it('AMI4: requires week_meal_uuid', async () => {
    const r = await addMealIngredient({ food_uuid: 'food-1', amount: 50 });
    expect(r.isError).toBe(true);
    expect(parseText(r).error.code).toBe('INVALID_INPUT');
  });
});

// ─── update_meal_ingredient ───────────────────────────────────────────────────

describe('update_meal_ingredient', () => {
  it('UMI1: updates amount on existing ingredient row', async () => {
    queryOneMock.mockResolvedValueOnce({ uuid: 'ing-1', week_meal_uuid: 'meal-1' });
    queryMock.mockResolvedValueOnce([
      { uuid: 'ing-1', food_uuid: 'food-oats', food_name: 'Oats', amount: 120, per_unit: 'g', per_qty: 100,
        calories: (120 / 100) * 389, protein_g: 0, carbs_g: 0, fat_g: 0, sort_order: 0, week_meal_uuid: 'meal-1' },
    ]);

    const r = await updateMealIngredient({ ingredient_uuid: 'ing-1', amount: 120 });
    expect(r.isError).toBeUndefined();
    const body = parseText(r);
    expect(body.ingredient_uuid).toBe('ing-1');
    expect(body.week_meal_uuid).toBe('meal-1');
  });

  it('UMI2: returns NOT_FOUND when ingredient not found', async () => {
    queryOneMock.mockResolvedValueOnce(null);
    const r = await updateMealIngredient({ ingredient_uuid: 'ghost', amount: 50 });
    expect(r.isError).toBe(true);
    expect(parseText(r).error.code).toBe('NOT_FOUND');
  });

  it('UMI3: rejects amount ≤ 0', async () => {
    const r = await updateMealIngredient({ ingredient_uuid: 'ing-1', amount: -5 });
    expect(r.isError).toBe(true);
    expect(parseText(r).error.code).toBe('INVALID_INPUT');
  });
});

// ─── remove_meal_ingredient ───────────────────────────────────────────────────

describe('remove_meal_ingredient', () => {
  it('RMI1: deletes ingredient and returns deleted uuid', async () => {
    queryOneMock.mockResolvedValueOnce({ uuid: 'ing-1', week_meal_uuid: 'meal-1' });
    const r = await removeMealIngredient({ ingredient_uuid: 'ing-1' });
    expect(r.isError).toBeUndefined();
    const body = parseText(r);
    expect(body.deleted).toBe('ing-1');
    expect(body.week_meal_uuid).toBe('meal-1');
  });

  it('RMI2: returns NOT_FOUND when ingredient does not exist', async () => {
    queryOneMock.mockResolvedValueOnce(null);
    const r = await removeMealIngredient({ ingredient_uuid: 'ghost' });
    expect(r.isError).toBe(true);
    expect(parseText(r).error.code).toBe('NOT_FOUND');
  });

  it('RMI3: requires ingredient_uuid', async () => {
    const r = await removeMealIngredient({});
    expect(r.isError).toBe(true);
    expect(parseText(r).error.code).toBe('INVALID_INPUT');
  });
});

// ─── resolveFood (indirectly via set_meal_ingredients) ───────────────────────

describe('resolveFood (server-side, via set_meal_ingredients)', () => {
  it('RF1: resolves by food_uuid — exact match', async () => {
    const food = { uuid: 'f-1', name: 'Chicken Breast', per_unit: 'g', per_qty: 100, calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 };
    queryOneMock
      .mockResolvedValueOnce(food)             // resolveFood by uuid
      .mockResolvedValueOnce({ uuid: 'meal-1' }); // meal exists
    queryMock.mockResolvedValueOnce([]);

    const r = await setMealIngredients({
      week_meal_uuid: 'meal-1',
      ingredients: [{ food_uuid: 'f-1', amount: 150 }],
    });
    expect(r.isError).toBeUndefined();
    // First queryOne call should have been the UUID lookup (no name param)
    const firstCall = queryOneMock.mock.calls[0];
    expect(firstCall[1]).toEqual(['f-1']);
  });

  it('RF2: resolves by food_name — case-insensitive lookup', async () => {
    const food = { uuid: 'f-2', name: 'Chicken Breast', per_unit: 'g', per_qty: 100, calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 };
    queryOneMock
      .mockResolvedValueOnce(food)              // resolveFood by name
      .mockResolvedValueOnce({ uuid: 'meal-1' });
    queryMock.mockResolvedValueOnce([]);

    const r = await setMealIngredients({
      week_meal_uuid: 'meal-1',
      ingredients: [{ food_name: 'chicken breast', amount: 150 }],
    });
    expect(r.isError).toBeUndefined();
    // First queryOne call should use lower($1) = lower($1) pattern — params include trimmed name
    const firstCall = queryOneMock.mock.calls[0];
    expect(firstCall[1][0]).toBe('chicken breast');
  });
});
