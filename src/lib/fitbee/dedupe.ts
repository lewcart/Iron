import { createHash } from 'crypto';
import type { FitbeeActivityRowParsed, FitbeeFoodRowParsed, FitbeeWeightRowParsed } from '@/types';

export function foodEntryDedupeKey(row: FitbeeFoodRowParsed): string {
  const payload = JSON.stringify({
    d: row.day_local,
    m: row.meal_type,
    f: row.food_name,
    cal: row.calories,
    p: row.protein_g,
    c: row.carbs_g,
    fat: row.fat_g,
    t: row.logged_at_iso,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function activityDedupeKey(row: FitbeeActivityRowParsed): string {
  const payload = `${row.logged_at_iso}|${row.activity_name}|${row.calories_burned ?? ''}`;
  return createHash('sha256').update(payload).digest('hex');
}

export function weightDedupeKey(row: FitbeeWeightRowParsed): string {
  const payload = `${row.logged_at_iso}|${row.weight_kg}|${row.note ?? ''}`;
  return createHash('sha256').update(payload).digest('hex');
}

export function fitbeeAggregateExternalRef(dayLocal: string, mealType: string): string {
  return `fitbee:agg:${dayLocal}:${mealType}`;
}
