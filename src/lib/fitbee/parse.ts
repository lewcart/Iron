import type {
  FitbeeActivityRowParsed,
  FitbeeFoodRowParsed,
  FitbeeWaterRowParsed,
  FitbeeWeightRowParsed,
  MealType,
} from '@/types';
import { parseCsv } from './csv';
import { normaliseFitbeeMeal } from './meal';

function colIndex(headers: string[], ...candidates: string[]): number {
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const c of candidates) {
    const i = norm.indexOf(c.trim().toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function parseNum(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = parseFloat(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** YYYY-MM-DD from Fitbee food date (local calendar day at export TZ). */
export function dayLocalFromFoodDate(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return iso.slice(0, 10);
}

export interface ParseFoodResult {
  rows: FitbeeFoodRowParsed[];
  warnings: string[];
}

export function parseFoodEntriesCsv(text: string): ParseFoodResult {
  const warnings: string[] = [];
  const { headers, rows } = parseCsv(text);
  if (headers.length === 0) {
    warnings.push('food_entries: empty or missing header');
    return { rows: [], warnings };
  }

  const iDate = colIndex(headers, 'date');
  const iMeal = colIndex(headers, 'meal');
  const iFood = colIndex(headers, 'food_name', 'food name');
  const iCal = colIndex(headers, 'calories (kcal)', 'calories');
  const iProt = colIndex(headers, 'protein (g)', 'protein');
  const iCarb = colIndex(
    headers,
    'total_carbohydrate (g)',
    'total carbohydrate (g)',
    'carbohydrate (g)',
    'carbohydrate',
  );
  const iFat = colIndex(headers, 'total_fat (g)', 'total fat (g)', 'fat (g)');

  if (iDate < 0 || iMeal < 0 || iFood < 0) {
    warnings.push('food_entries: required columns date, meal, or food_name missing');
    return { rows: [], warnings };
  }

  const macroIdx = new Set([iDate, iMeal, iFood, iCal, iProt, iCarb, iFat].filter((i) => i >= 0));
  const numericHeaderHints = ['(g)', '(kcal)', '(mg)', 'alcohol', 'salt'];

  const out: FitbeeFoodRowParsed[] = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const cells = rows[ri];
    const dateStr = (cells[iDate] ?? '').trim();
    const mealRaw = (cells[iMeal] ?? '').trim();
    const foodName = (cells[iFood] ?? '').trim();
    if (!dateStr || !foodName) {
      warnings.push(`food_entries: row ${ri + 2} skipped (empty date or food_name)`);
      continue;
    }
    const meal_type = normaliseFitbeeMeal(mealRaw);
    if (!meal_type) {
      warnings.push(`food_entries: row ${ri + 2} unknown meal "${mealRaw}" — skipped`);
      continue;
    }

    const nutrients: Record<string, number | string | null> = {};
    for (let hi = 0; hi < headers.length; hi++) {
      if (macroIdx.has(hi)) continue;
      const name = headers[hi];
      const cell = (cells[hi] ?? '').trim();
      if (cell === '') {
        nutrients[name] = null;
        continue;
      }
      const isLikelyNum = numericHeaderHints.some((h) => name.toLowerCase().includes(h.replace(/[()]/g, '')));
      const n = parseNum(cell);
      if (n !== null && (isLikelyNum || /^-?\d/.test(cell))) nutrients[name] = n;
      else nutrients[name] = cell;
    }

    const calories = iCal >= 0 ? parseNum(cells[iCal] ?? '') : null;
    const protein_g = iProt >= 0 ? parseNum(cells[iProt] ?? '') : null;
    const carbs_g = iCarb >= 0 ? parseNum(cells[iCarb] ?? '') : null;
    const fat_g = iFat >= 0 ? parseNum(cells[iFat] ?? '') : null;

    let logged_at_iso = dateStr;
    const t = Date.parse(dateStr);
    if (!Number.isNaN(t)) {
      logged_at_iso = new Date(t).toISOString();
    }

    out.push({
      logged_at_iso,
      day_local: dayLocalFromFoodDate(dateStr),
      meal_type: meal_type as MealType,
      food_name: foodName,
      calories,
      protein_g,
      carbs_g,
      fat_g,
      nutrients,
    });
  }

  return { rows: out, warnings };
}

export function parseWaterCsv(text: string): { rows: FitbeeWaterRowParsed[]; warnings: string[] } {
  const warnings: string[] = [];
  const { headers, rows } = parseCsv(text);
  if (headers.length === 0) return { rows: [], warnings };
  const iDate = colIndex(headers, 'date');
  const iMl = colIndex(headers, 'water (ml)', 'water (mL)', 'water');
  if (iDate < 0 || iMl < 0) {
    warnings.push('water: expected columns date and water (mL)');
    return { rows: [], warnings };
  }
  const out: FitbeeWaterRowParsed[] = [];
  for (const cells of rows) {
    const d = (cells[iDate] ?? '').trim();
    const ml = parseNum(cells[iMl] ?? '');
    if (!d || ml === null) continue;
    const date = d.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? d.slice(0, 10);
    out.push({ date, ml });
  }
  return { rows: out, warnings };
}

export function parseWeightCsv(text: string): { rows: FitbeeWeightRowParsed[]; warnings: string[] } {
  const warnings: string[] = [];
  const { headers, rows } = parseCsv(text);
  if (headers.length === 0) return { rows: [], warnings };
  const iDate = colIndex(headers, 'date');
  const iKg = colIndex(headers, 'weight_entry (kg)', 'weight (kg)', 'weight_kg');
  const iNotes = colIndex(headers, 'notes', 'note');
  if (iDate < 0 || iKg < 0) {
    warnings.push('weight_entries: expected date and weight_entry (kg)');
    return { rows: [], warnings };
  }
  const out: FitbeeWeightRowParsed[] = [];
  for (const cells of rows) {
    const ds = (cells[iDate] ?? '').trim();
    const w = parseNum(cells[iKg] ?? '');
    if (!ds || w === null || w <= 0) continue;
    let logged_at_iso = ds;
    const t = Date.parse(ds);
    if (!Number.isNaN(t)) logged_at_iso = new Date(t).toISOString();
    const note = iNotes >= 0 ? (cells[iNotes] ?? '').trim() || null : null;
    out.push({ logged_at_iso, weight_kg: w, note });
  }
  return { rows: out, warnings };
}

export function parseActivityCsv(text: string): { rows: FitbeeActivityRowParsed[]; warnings: string[] } {
  const warnings: string[] = [];
  const { headers, rows } = parseCsv(text);
  if (headers.length === 0) return { rows: [], warnings };
  const iDate = colIndex(headers, 'date');
  const iWorkout = colIndex(headers, 'workout', 'activity');
  const iEnergy = colIndex(headers, 'energy burned (cal)', 'energy burned', 'calories');
  if (iDate < 0 || iWorkout < 0) {
    warnings.push('workouts: expected date and workout columns');
    return { rows: [], warnings };
  }
  const out: FitbeeActivityRowParsed[] = [];
  for (const cells of rows) {
    const ds = (cells[iDate] ?? '').trim();
    const name = (cells[iWorkout] ?? '').trim();
    if (!ds || !name) continue;
    let logged_at_iso = ds;
    const t = Date.parse(ds);
    if (!Number.isNaN(t)) logged_at_iso = new Date(t).toISOString();
    const calories_burned = iEnergy >= 0 ? parseNum(cells[iEnergy] ?? '') : null;
    out.push({ logged_at_iso, activity_name: name, calories_burned });
  }
  return { rows: out, warnings };
}

export interface ParsedFitbeeFiles {
  food: ParseFoodResult;
  water: { rows: FitbeeWaterRowParsed[]; warnings: string[] };
  weight: { rows: FitbeeWeightRowParsed[]; warnings: string[] };
  activity: { rows: FitbeeActivityRowParsed[]; warnings: string[] };
}

export function parseFitbeeExportFiles(files: {
  food_entries?: string;
  water?: string;
  weight_entries?: string;
  workouts?: string;
}): ParsedFitbeeFiles {
  return {
    food: files.food_entries ? parseFoodEntriesCsv(files.food_entries) : { rows: [], warnings: [] },
    water: files.water ? parseWaterCsv(files.water) : { rows: [], warnings: [] },
    weight: files.weight_entries ? parseWeightCsv(files.weight_entries) : { rows: [], warnings: [] },
    activity: files.workouts ? parseActivityCsv(files.workouts) : { rows: [], warnings: [] },
  };
}
