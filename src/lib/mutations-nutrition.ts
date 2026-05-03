'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { uuid as genUUID } from '@/lib/uuid';
import { dateToDayOfWeek } from '@/lib/api/nutrition';
import type { MealSlot } from '@/types';
import type {
  LocalNutritionLog,
  LocalNutritionWeekMeal,
  LocalNutritionDayNote,
  LocalNutritionTarget,
  MacroBands,
} from '@/db/local';

// Mutations for the nutrition page surface:
// - nutrition_logs (logged meals with macros)
// - nutrition_week_meals (planned weekly schedule)
// - nutrition_day_notes (per-day hydration + notes + approval state, keyed by date string)
// - nutrition_targets (singleton macro targets row, id=1)

function now() { return Date.now(); }
function syncMeta() {
  return { _synced: false as const, _updated_at: now(), _deleted: false as const };
}

// ─── Nutrition logs ──────────────────────────────────────────────────────────

export async function logMeal(opts: {
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other' | null;
  meal_name?: string | null;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  notes?: string | null;
  template_meal_id?: string | null;
  status?: 'planned' | 'deviation' | 'added' | null;
  logged_at?: string;
}): Promise<LocalNutritionLog> {
  const log: LocalNutritionLog = {
    uuid: genUUID(),
    logged_at: opts.logged_at ?? new Date().toISOString(),
    meal_type: opts.meal_type ?? null,
    meal_name: opts.meal_name?.trim() || null,
    calories: opts.calories ?? null,
    protein_g: opts.protein_g ?? null,
    carbs_g: opts.carbs_g ?? null,
    fat_g: opts.fat_g ?? null,
    notes: opts.notes?.trim() || null,
    template_meal_id: opts.template_meal_id ?? null,
    status: opts.status ?? null,
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
  if (changes.meal_name !== undefined) changes.meal_name = changes.meal_name?.trim() || null;
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
  meal_slot: MealSlot;
  meal_name: string;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
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
    carbs_g: opts.carbs_g ?? null,
    fat_g: opts.fat_g ?? null,
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

// ─── Day notes (per-date hydration + notes + approval) ────────────────────────

export async function setDayNote(opts: {
  date: string;
  hydration_ml?: number | null;
  notes?: string | null;
}): Promise<void> {
  const existing = await db.nutrition_day_notes.filter(d => d.date === opts.date && !d._deleted).first();
  const note: LocalNutritionDayNote = {
    uuid: existing?.uuid ?? genUUID(),
    date: opts.date,
    hydration_ml: opts.hydration_ml ?? existing?.hydration_ml ?? null,
    notes: opts.notes?.trim() ?? existing?.notes ?? null,
    approved_status: existing?.approved_status ?? 'pending',
    approved_at: existing?.approved_at ?? null,
    template_applied_at: existing?.template_applied_at ?? null,
    ...syncMeta(),
  };
  await db.nutrition_day_notes.put(note);
  syncEngine.schedulePush();
}

/** Mark a date as explicitly reviewed/approved by the user. */
export async function approveDayNote(date: string): Promise<void> {
  const existing = await db.nutrition_day_notes.filter(d => d.date === date && !d._deleted).first();
  const note: LocalNutritionDayNote = {
    uuid: existing?.uuid ?? genUUID(),
    date,
    hydration_ml: existing?.hydration_ml ?? null,
    notes: existing?.notes ?? null,
    approved_status: 'approved',
    approved_at: new Date().toISOString(),
    template_applied_at: existing?.template_applied_at ?? null,
    ...syncMeta(),
  };
  await db.nutrition_day_notes.put(note);
  syncEngine.schedulePush();
}

// ─── Standard-week template auto-fill ────────────────────────────────────────

/**
 * Materializes the standard-week template into nutrition_logs for a single
 * date. Idempotent — once nutrition_day_notes.template_applied_at is set for
 * the date, this is a no-op, even if the user later deletes the resulting
 * logs (deletes are intentional; we don't resurrect them).
 *
 * Created rows carry status='planned' and template_meal_id pointing back to
 * the source week_meal. They count toward macro totals exactly like added
 * logs — Lou's expectation: "if i don't action that day it auto-logs by
 * default; i can adjust if need be".
 *
 * Safe to call multiple times per render.
 */
export async function ensurePlannedLogsForDate(date: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

  const existingNote = await db.nutrition_day_notes
    .filter(d => d.date === date && !d._deleted)
    .first();

  if (existingNote?.template_applied_at) return;

  const dow = dateToDayOfWeek(date);
  const templateMeals = await db.nutrition_week_meals
    .filter(m => m.day_of_week === dow && !m._deleted)
    .toArray();

  const stampedNote: LocalNutritionDayNote = {
    uuid: existingNote?.uuid ?? genUUID(),
    date,
    hydration_ml: existingNote?.hydration_ml ?? null,
    notes: existingNote?.notes ?? null,
    approved_status: existingNote?.approved_status ?? 'pending',
    approved_at: existingNote?.approved_at ?? null,
    template_applied_at: new Date().toISOString(),
    ...syncMeta(),
  };

  // No template for this DOW: still stamp so we don't re-scan on every open.
  if (templateMeals.length === 0) {
    await db.nutrition_day_notes.put(stampedNote);
    syncEngine.schedulePush();
    return;
  }

  // Cross-device safety: another client may have already auto-filled this
  // date and the user may have edited or deleted some of those rows since.
  // Skip any template_meal_id that already shows up in nutrition_logs for
  // this date (including soft-deleted rows, so deletes are not undone).
  const existingLogs = await db.nutrition_logs
    .filter(l => typeof l.logged_at === 'string' && l.logged_at.startsWith(date))
    .toArray();
  const usedTemplateIds = new Set(
    existingLogs.map(l => l.template_meal_id).filter((v): v is string => !!v),
  );

  // Stable noon-local logged_at so rows sort predictably and slot ordering
  // is preserved via the template's sort_order (1s offset per row).
  const baseMs = Date.parse(`${date}T12:00:00.000Z`);
  const sorted = templateMeals.sort((a, b) => a.sort_order - b.sort_order);
  for (let i = 0; i < sorted.length; i++) {
    const meal = sorted[i];
    if (usedTemplateIds.has(meal.uuid)) continue;
    const log: LocalNutritionLog = {
      uuid: genUUID(),
      logged_at: new Date(baseMs + i * 1000).toISOString(),
      meal_type: meal.meal_slot,
      meal_name: meal.meal_name,
      calories: meal.calories,
      protein_g: meal.protein_g,
      carbs_g: meal.carbs_g,
      fat_g: meal.fat_g,
      notes: null,
      template_meal_id: meal.uuid,
      status: 'planned',
      ...syncMeta(),
    };
    await db.nutrition_logs.add(log);
  }

  await db.nutrition_day_notes.put(stampedNote);
  syncEngine.schedulePush();
}

// ─── Nutrition targets (singleton id=1) ──────────────────────────────────────

export async function setNutritionTargets(opts: {
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  bands?: MacroBands | null;
}): Promise<void> {
  const existing = await db.nutrition_targets.get(1);
  const row: LocalNutritionTarget = {
    id: 1,
    calories: opts.calories ?? null,
    protein_g: opts.protein_g ?? null,
    carbs_g: opts.carbs_g ?? null,
    fat_g: opts.fat_g ?? null,
    bands: opts.bands !== undefined ? opts.bands : (existing?.bands ?? null),
    ...syncMeta(),
  };
  await db.nutrition_targets.put(row);
  syncEngine.schedulePush();
}
