/**
 * Adherence helpers — computing whether a day's macros fall inside the
 * user's bands.
 *
 * Single rule: a macro hits when actual ∈ [target * (1 + low), target * (1 + high)].
 *   - low is signed (negative for under-tolerance).
 *   - high is signed (positive for over-tolerance) or null for "no upper bound".
 *
 * If a target is null (e.g. fat unset), that macro is excluded from the count.
 * `hit_count` is the number of macros that hit; `target_count` is the number
 * of macros with non-null targets. A day is "in band" when hit_count == target_count.
 */

import type { MacroBands, MacroBand, LocalNutritionTarget } from '@/db/local';

export const DEFAULT_BANDS: MacroBands = {
  cal:  { low: -0.10, high: 0.10 },
  pro:  { low: -0.10, high: null },
  carb: { low: -0.15, high: 0.15 },
  fat:  { low: -0.15, high: 0.20 },
};

export interface DayMacros {
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface DayAdherence {
  hit_count: number;
  target_count: number;
  /** True when target_count > 0 and hit_count === target_count. */
  in_band: boolean;
}

function macroHits(
  actual: number | null | undefined,
  target: number | null | undefined,
  band: MacroBand | undefined,
): boolean {
  if (target == null || target <= 0) return false;
  if (actual == null) return false;
  const low = band?.low ?? -0.10;
  const high = band?.high;
  const ratio = actual / target;
  if (ratio < 1 + low) return false;
  if (high == null) return true;
  return ratio <= 1 + high;
}

export function computeDayAdherence(
  macros: DayMacros,
  targets: LocalNutritionTarget | null | undefined,
  bands: MacroBands = DEFAULT_BANDS,
): DayAdherence {
  let hit = 0;
  let target_count = 0;

  if (targets?.calories != null) {
    target_count++;
    if (macroHits(macros.calories, targets.calories, bands.cal)) hit++;
  }
  if (targets?.protein_g != null) {
    target_count++;
    if (macroHits(macros.protein_g, targets.protein_g, bands.pro)) hit++;
  }
  if (targets?.carbs_g != null) {
    target_count++;
    if (macroHits(macros.carbs_g, targets.carbs_g, bands.carb)) hit++;
  }
  if (targets?.fat_g != null) {
    target_count++;
    if (macroHits(macros.fat_g, targets.fat_g, bands.fat)) hit++;
  }

  return {
    hit_count: hit,
    target_count,
    in_band: target_count > 0 && hit === target_count,
  };
}

/**
 * Streak: number of consecutive most-recent days where a day was in_band.
 * Days with no targets or no data are excluded — they don't extend the streak,
 * but they don't break it either.
 */
export function computeStreak(
  days: Array<{ adherence: DayAdherence; has_data: boolean }>,
): number {
  // days is assumed sorted most-recent first.
  let streak = 0;
  for (const d of days) {
    if (!d.has_data || d.adherence.target_count === 0) continue;
    if (d.adherence.in_band) streak++;
    else break;
  }
  return streak;
}
