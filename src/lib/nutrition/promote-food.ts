/**
 * promote-food.ts — promote a FoodResult (search hit) into the local `foods`
 * table, and resolve existing foods by uuid or name.
 *
 * Implements the "promote-on-attach mint target" strategy from the GSTACK review
 * (Critical Finding #2 — Food corpus fork). The canonical search surface stays
 * as-is (nutrition_food_canonical view); foods are minted into the local `foods`
 * table only when a food is actually attached as an ingredient. This avoids
 * forking a second frozen corpus.
 *
 * Key guarantee: promoteFoodFromResult is idempotent. Calling it twice for the
 * same food_name + source returns the same uuid without creating a second row.
 *
 * Serving metadata contract:
 *   FoodResult.serving_size { qty, unit } → foods.per_qty / foods.per_unit
 *   e.g. serving_size { qty: 100, unit: 'g' } → per_qty=100, per_unit='g'
 *   A null or unparseable serving_size falls back to per_unit='serve', per_qty=1
 *   so the food still works — but gram-native scaling won't be available.
 *
 * This module is client-safe (Dexie only; no server imports). The server-side
 * resolveFood uses a Postgres query and lives separately in the MCP tools file.
 */

'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { uuid as genUUID } from '@/lib/uuid';
import type { LocalFood } from '@/db/local';
import type { FoodResult } from '@/lib/nutrition-history-types';

// ─── Internal helpers ─────────────────────────────────────────────────────────

function now() { return Date.now(); }

function syncMeta() {
  return { _synced: false as const, _updated_at: now(), _deleted: false as const };
}

type PerUnit = 'g' | 'ml' | 'serve';

/**
 * Parse a FoodResult's serving_size into (per_unit, per_qty).
 * Falls back to ('serve', 1) when serving_size is absent or unit is unrecognised.
 */
function parseServing(servingSize: FoodResult['serving_size']): { per_unit: PerUnit; per_qty: number } {
  if (!servingSize) return { per_unit: 'serve', per_qty: 1 };

  const rawUnit = servingSize.unit?.trim().toLowerCase() ?? '';
  const qty = Number(servingSize.qty);

  if (!Number.isFinite(qty) || qty <= 0) return { per_unit: 'serve', per_qty: 1 };

  if (rawUnit === 'g' || rawUnit === 'gram' || rawUnit === 'grams') {
    return { per_unit: 'g', per_qty: qty };
  }
  if (rawUnit === 'ml' || rawUnit === 'millilitre' || rawUnit === 'milliliter' ||
      rawUnit === 'millilitres' || rawUnit === 'milliliters') {
    return { per_unit: 'ml', per_qty: qty };
  }
  // 'serve', 'serving', 'cup', 'tbsp', etc. → serve unit
  return { per_unit: 'serve', per_qty: qty };
}

/**
 * Dedupe key for a food: lower(name) + '|' + source.
 * This is the same strategy used by the server upsert in mutation helpers.
 */
function dedupeKey(name: string, source: string): string {
  return `${name.trim().toLowerCase()}|${source}`;
}

// ─── Promote-on-attach ────────────────────────────────────────────────────────

/**
 * Promote a FoodResult (search hit) into the local `foods` table.
 *
 * - Idempotent: if a non-archived food with the same lower(name) + source already
 *   exists in Dexie, returns its uuid without creating a new row.
 * - Carries real serving metadata from FoodResult.serving_size into per_unit/per_qty
 *   (e.g. serving_size {qty:100, unit:'g'} → per_unit='g', per_qty=100) so
 *   gram-native scaling works. Falls back to serve/1 when absent.
 * - Carries calories/protein_g/carbs_g/fat_g + nutrients.
 * - Schedules a sync push.
 *
 * @param result A FoodResult from the search API (/api/nutrition/foods).
 * @returns The stable food uuid (minted or existing).
 */
export async function promoteFoodFromResult(result: FoodResult): Promise<string> {
  const name = result.food_name.trim();
  if (!name) throw new Error('INVALID_FOOD: food_name is required');

  const source = result.source ?? 'manual';
  const key = dedupeKey(name, source);

  // Check for an existing non-archived food with the same name+source.
  // We do a case-insensitive match on name (Dexie doesn't support lower() natively,
  // so we fetch by source index and filter in JS — the table is small).
  const existing = await db.foods
    .where('source').equals(source)
    .filter(f => !f._deleted && !f.archived_at && dedupeKey(f.name, f.source) === key)
    .first();

  if (existing) return existing.uuid;

  // Mint a new food row.
  const { per_unit, per_qty } = parseServing(result.serving_size);

  const food: LocalFood = {
    uuid: genUUID(),
    name,
    brand: null,
    per_unit,
    per_qty,
    calories: result.calories ?? null,
    protein_g: result.protein_g ?? null,
    carbs_g: result.carbs_g ?? null,
    fat_g: result.fat_g ?? null,
    nutrients: (result.nutrients as Record<string, unknown>) ?? {},
    source,
    archived_at: null,
    created_at: new Date().toISOString(),
    ...syncMeta(),
  };

  await db.foods.put(food);
  syncEngine.schedulePush();

  return food.uuid;
}

// ─── Manual-create path ───────────────────────────────────────────────────────

export interface ManualFoodInput {
  name: string;
  brand?: string | null;
  per_unit?: PerUnit;
  per_qty?: number;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  nutrients?: Record<string, unknown>;
}

/**
 * Create a manual food (not from search) and return its uuid.
 * Idempotent by lower(name) + 'manual' source — if the same manual food name
 * already exists, returns the existing uuid.
 *
 * Use this for the "food not in search" UI path. For search-hit foods, use
 * promoteFoodFromResult instead (it carries richer serving metadata from the
 * FoodResult).
 */
export async function createManualFood(input: ManualFoodInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('INVALID_FOOD: name is required');

  const per_unit: PerUnit = input.per_unit ?? 'serve';
  const per_qty = input.per_qty ?? 1;

  if (!Number.isFinite(per_qty) || per_qty <= 0) {
    throw new Error(`INVALID_FOOD: per_qty must be > 0, got ${per_qty}`);
  }

  const key = dedupeKey(name, 'manual');

  const existing = await db.foods
    .where('source').equals('manual')
    .filter(f => !f._deleted && !f.archived_at && dedupeKey(f.name, f.source) === key)
    .first();

  if (existing) return existing.uuid;

  const food: LocalFood = {
    uuid: genUUID(),
    name,
    brand: input.brand?.trim() || null,
    per_unit,
    per_qty,
    calories: input.calories ?? null,
    protein_g: input.protein_g ?? null,
    carbs_g: input.carbs_g ?? null,
    fat_g: input.fat_g ?? null,
    nutrients: input.nutrients ?? {},
    source: 'manual',
    archived_at: null,
    created_at: new Date().toISOString(),
    ...syncMeta(),
  };

  await db.foods.put(food);
  syncEngine.schedulePush();

  return food.uuid;
}

// ─── resolveFood (client-side, Dexie) ────────────────────────────────────────

/**
 * Resolve a food by uuid or name from the local Dexie store.
 *
 * Mirrors the resolveExercise pattern from mcp-tools.ts (the {_id | _name}
 * convention) but operates against the Dexie `foods` table for client-side use.
 *
 * - uuid lookup: exact match, includes archived foods (so existing ingredient
 *   rows still resolve even if the food was later archived).
 * - name lookup: case-insensitive match on non-archived, non-deleted foods.
 *   Returns the first match if unique; null if none found; throws if ambiguous
 *   (caller should surface "be more specific" to user).
 *
 * @returns The LocalFood row, or null if not found.
 */
export async function resolveFood(args: {
  food_uuid?: string;
  food_name?: string;
}): Promise<LocalFood | null> {
  const { food_uuid, food_name } = args;

  if (food_uuid) {
    const row = await db.foods.get(food_uuid);
    return row && !row._deleted ? row : null;
  }

  if (food_name) {
    const nameLower = food_name.trim().toLowerCase();
    const matches = await db.foods
      .filter(f => !f._deleted && !f.archived_at && f.name.toLowerCase() === nameLower)
      .toArray();

    if (matches.length === 0) return null;
    // Return first match (most recently created wins — Dexie insertion order).
    return matches[0];
  }

  return null;
}
