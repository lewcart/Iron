'use client';

/**
 * Dexie live-query hooks for the foods + week_meal_ingredients tables.
 * Used by the ingredient editor on the Standard Week page.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/local';
import type { LocalFood, LocalWeekMealIngredient } from '@/db/local';

// ─── Foods ────────────────────────────────────────────────────────────────────

/**
 * All non-archived, non-deleted foods in insertion order.
 * Used to resolve food rows from ingredient uuids.
 */
export function useFoods(): LocalFood[] {
  return useLiveQuery(
    async () => {
      return db.foods
        .filter(f => !f._deleted && !f.archived_at)
        .toArray();
    },
    [],
    [],
  );
}

/**
 * Index of food_uuid → LocalFood for O(1) lookups in the ingredient editor.
 * Returns a plain object (stable reference only when content changes — Dexie
 * live query triggers a re-render when the `foods` table changes).
 */
export function useFoodsById(): Record<string, LocalFood> {
  return useLiveQuery(
    async () => {
      const foods = await db.foods
        .filter(f => !f._deleted)
        .toArray();
      const map: Record<string, LocalFood> = {};
      for (const f of foods) map[f.uuid] = f;
      return map;
    },
    [],
    {},
  );
}

// ─── Week meal ingredients ────────────────────────────────────────────────────

/**
 * All non-deleted ingredients for a given week meal, ordered by sort_order.
 */
export function useMealIngredients(weekMealUuid: string | null): LocalWeekMealIngredient[] {
  return useLiveQuery(
    async () => {
      if (!weekMealUuid) return [];
      const rows = await db.week_meal_ingredients
        .where('week_meal_uuid')
        .equals(weekMealUuid)
        .filter(i => !i._deleted)
        .toArray();
      return rows.sort((a, b) => a.sort_order - b.sort_order);
    },
    [weekMealUuid],
    [],
  );
}

/**
 * Map of week_meal_uuid → ingredient count (non-deleted).
 * Lets the week page show a "3 ingredients" count in the disclosure header
 * without fetching full ingredient rows per meal.
 */
export function useMealIngredientCounts(): Record<string, number> {
  return useLiveQuery(
    async () => {
      const all = await db.week_meal_ingredients
        .filter(i => !i._deleted && !!i.week_meal_uuid)
        .toArray();
      const counts: Record<string, number> = {};
      for (const i of all) {
        if (i.week_meal_uuid) {
          counts[i.week_meal_uuid] = (counts[i.week_meal_uuid] ?? 0) + 1;
        }
      }
      return counts;
    },
    [],
    {},
  );
}
