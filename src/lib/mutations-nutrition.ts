'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { uuid as genUUID } from '@/lib/uuid';
import type {
  LocalNutritionLog,
  LocalNutritionWeekMeal,
  LocalNutritionDayNote,
  LocalNutritionTarget,
} from '@/db/local';

// Mutations for the nutrition page surface:
// - nutrition_logs (logged meals with macros)
// - nutrition_week_meals (planned weekly schedule)
// - nutrition_day_notes (per-day hydration + notes, keyed by date string)
// - nutrition_targets (singleton macro targets row, id=1)

function now() { return Date.now(); }
function syncMeta() {
  return { _synced: false as const, _updated_at: now(), _deleted: false as const };
}

// ─── Nutrition logs ──────────────────────────────────────────────────────────

export async function logMeal(opts: {
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other' | null;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  notes?: string | null;
  logged_at?: string;
}): Promise<LocalNutritionLog> {
  const log: LocalNutritionLog = {
    uuid: genUUID(),
    logged_at: opts.logged_at ?? new Date().toISOString(),
    meal_type: opts.meal_type ?? null,
    calories: opts.calories ?? null,
    protein_g: opts.protein_g ?? null,
    carbs_g: opts.carbs_g ?? null,
    fat_g: opts.fat_g ?? null,
    notes: opts.notes?.trim() || null,
    ...syncMeta(),
  };
  await db.nutrition_logs.add(log);
  syncEngine.schedulePush();
  return log;
}

export async function updateMeal(
  uuid: string,
  patch: Partial<Omit<LocalNutritionLog, 'uuid' | '_synced' | '_updated_at' | '_deleted'>>,
): Promise<void> {
  const changes = { ...patch, ...syncMeta() };
  if (changes.notes !== undefined) changes.notes = changes.notes?.trim() || null;
  await db.nutrition_logs.update(uuid, changes);
  syncEngine.schedulePush();
}

export async function deleteMeal(uuid: string): Promise<void> {
  await db.nutrition_logs.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── Week meal plan ──────────────────────────────────────────────────────────

export async function setWeekMeal(opts: {
  uuid?: string;
  day_of_week: number;
  meal_slot: string;
  meal_name: string;
  protein_g?: number | null;
  calories?: number | null;
  quality_rating?: number | null;
  sort_order?: number;
}): Promise<string> {
  const id = opts.uuid ?? genUUID();
  const sortOrder = opts.sort_order ??
    await db.nutrition_week_meals.filter(m => m.day_of_week === opts.day_of_week && !m._deleted).count();
  const meal: LocalNutritionWeekMeal = {
    uuid: id,
    day_of_week: opts.day_of_week,
    meal_slot: opts.meal_slot,
    meal_name: opts.meal_name.trim(),
    protein_g: opts.protein_g ?? null,
    calories: opts.calories ?? null,
    quality_rating: opts.quality_rating ?? null,
    sort_order: sortOrder,
    ...syncMeta(),
  };
  await db.nutrition_week_meals.put(meal);
  syncEngine.schedulePush();
  return id;
}

export async function deleteWeekMeal(uuid: string): Promise<void> {
  await db.nutrition_week_meals.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── Day notes (per-date hydration + notes) ──────────────────────────────────

export async function setDayNote(opts: {
  date: string;
  hydration_ml?: number | null;
  notes?: string | null;
}): Promise<void> {
  // Keyed by date — find existing or create new.
  const existing = await db.nutrition_day_notes.filter(d => d.date === opts.date && !d._deleted).first();
  const note: LocalNutritionDayNote = {
    uuid: existing?.uuid ?? genUUID(),
    date: opts.date,
    hydration_ml: opts.hydration_ml ?? existing?.hydration_ml ?? null,
    notes: opts.notes?.trim() ?? existing?.notes ?? null,
    ...syncMeta(),
  };
  await db.nutrition_day_notes.put(note);
  syncEngine.schedulePush();
}

// ─── Nutrition targets (singleton id=1) ──────────────────────────────────────

export async function setNutritionTargets(opts: {
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}): Promise<void> {
  const row: LocalNutritionTarget = {
    id: 1,
    calories: opts.calories ?? null,
    protein_g: opts.protein_g ?? null,
    carbs_g: opts.carbs_g ?? null,
    fat_g: opts.fat_g ?? null,
    ...syncMeta(),
  };
  await db.nutrition_targets.put(row);
  syncEngine.schedulePush();
}
