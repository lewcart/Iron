'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { uuid as genUUID } from '@/lib/uuid';
import type { LocalFood, LocalWeekMealIngredient } from '@/db/local';

// Mutations for the nutrition foods + ingredients surface:
// - foods (canonical ingredient table; archive-only, no hard-delete)
// - week_meal_ingredients (join: nutrition_week_meals ↔ foods)
// - nutrition_week_meals.is_recipe flag

function now() { return Date.now(); }
function syncMeta() {
  return { _synced: false as const, _updated_at: now(), _deleted: false as const };
}

// ─── Foods ───────────────────────────────────────────────────────────────────

/** Create or replace a food row in the local Dexie store. Schedules a push. */
export async function createFood(opts: {
  uuid?: string;
  name: string;
  brand?: string | null;
  per_unit?: 'g' | 'ml' | 'serve';
  per_qty?: number;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  nutrients?: Record<string, unknown>;
  source?: string;
}): Promise<LocalFood> {
  const food: LocalFood = {
    uuid: opts.uuid ?? genUUID(),
    name: opts.name.trim(),
    brand: opts.brand?.trim() || null,
    per_unit: opts.per_unit ?? 'serve',
    per_qty: opts.per_qty ?? 1,
    calories: opts.calories ?? null,
    protein_g: opts.protein_g ?? null,
    carbs_g: opts.carbs_g ?? null,
    fat_g: opts.fat_g ?? null,
    nutrients: opts.nutrients ?? {},
    source: opts.source ?? 'manual',
    archived_at: null,
    created_at: new Date().toISOString(),
    ...syncMeta(),
  };
  await db.foods.put(food);
  syncEngine.schedulePush();
  return food;
}

/**
 * Archive a food row (soft-delete via archive). MUST NOT hard-delete: the
 * server has ON DELETE RESTRICT on week_meal_ingredients.food_uuid, so a
 * hard-DELETE from the client would wedge the entire push batch.
 *
 * The server push translates _deleted=true on a food row to
 * `UPDATE foods SET archived_at = NOW()` — never a DELETE.
 */
export async function archiveFood(uuid: string): Promise<void> {
  await db.foods.update(uuid, {
    _deleted: true,
    _synced: false,
    _updated_at: now(),
  });
  syncEngine.schedulePush();
}

// ─── Week meal ingredients ────────────────────────────────────────────────────

/**
 * Add a food as an ingredient to a week meal. Schedules a push.
 * Caller is responsible for ensuring food_uuid already exists in db.foods.
 */
export async function addMealIngredient(opts: {
  week_meal_uuid: string;
  food_uuid: string;
  amount: number;
  sort_order?: number;
}): Promise<LocalWeekMealIngredient> {
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) {
    throw new Error(`INVALID_QUANTITY: amount must be > 0, got ${opts.amount}`);
  }
  // Default sort_order = next slot in this meal
  const sortOrder = opts.sort_order ??
    await db.week_meal_ingredients
      .filter(i => i.week_meal_uuid === opts.week_meal_uuid && !i._deleted)
      .count();
  const ingredient: LocalWeekMealIngredient = {
    uuid: genUUID(),
    week_meal_uuid: opts.week_meal_uuid,
    food_uuid: opts.food_uuid,
    amount: opts.amount,
    sort_order: sortOrder,
    created_at: new Date().toISOString(),
    ...syncMeta(),
  };
  await db.week_meal_ingredients.add(ingredient);
  syncEngine.schedulePush();
  return ingredient;
}

/** Update the amount of an existing ingredient row. */
export async function updateMealIngredientAmount(
  uuid: string,
  amount: number,
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`INVALID_QUANTITY: amount must be > 0, got ${amount}`);
  }
  await db.week_meal_ingredients.update(uuid, {
    amount,
    _synced: false,
    _updated_at: now(),
  });
  syncEngine.schedulePush();
}

/**
 * Remove an ingredient from a meal (soft-delete via sync). The server push
 * translates _deleted=true to a hard-DELETE on week_meal_ingredients — this
 * is safe because the ingredient row has no downstream FK dependents.
 */
export async function removeMealIngredient(uuid: string): Promise<void> {
  await db.week_meal_ingredients.update(uuid, {
    _deleted: true,
    _synced: false,
    _updated_at: now(),
  });
  syncEngine.schedulePush();
}

// ─── Week meal is_recipe flag ─────────────────────────────────────────────────

/**
 * Flip the is_recipe flag on a week meal. When true, effective macros are
 * derived from week_meal_ingredients × foods (see nutrition_week_meal_effective
 * Postgres view). When false, stored aggregate macros are used (legacy).
 *
 * See migration 052 GATE DECISION 1 for the rationale.
 */
export async function setMealIsRecipe(
  uuid: string,
  isRecipe: boolean,
): Promise<void> {
  await db.nutrition_week_meals.update(uuid, {
    is_recipe: isRecipe,
    _synced: false,
    _updated_at: now(),
  });
  syncEngine.schedulePush();
}
