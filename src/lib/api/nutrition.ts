import type { NutritionDayNote, NutritionLog, NutritionWeekMeal } from '@/types';
import { fetchJsonAuthed } from './client';
import { rebirthJsonHeaders } from './headers';

/** YYYY-MM-DD → day_of_week (0=Mon … 6=Sun) */
export function dateToDayOfWeek(dateStr: string): number {
  const jsDay = new Date(dateStr + 'T12:00:00').getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

export interface NutritionDayBundle {
  templateMeals: NutritionWeekMeal[];
  loggedMeals: NutritionLog[];
  dayNote: NutritionDayNote | null;
}

export async function fetchNutritionDayBundle(date: string): Promise<NutritionDayBundle> {
  const h = rebirthJsonHeaders();
  const dow = dateToDayOfWeek(date);
  const [tmRes, logRes, noteRes] = await Promise.all([
    fetch(`/api/nutrition/week?day=${dow}`, { headers: h }),
    fetch(`/api/nutrition?from=${date}&to=${date}&limit=100`, { headers: h }),
    fetch(`/api/nutrition/day-notes?date=${date}`, { headers: h }),
  ]);
  const templateMeals = tmRes.ok ? await tmRes.json() : [];
  const loggedMeals = logRes.ok ? await logRes.json() : [];
  const dayNote = noteRes.ok ? await noteRes.json() : null;
  return { templateMeals, loggedMeals, dayNote };
}

export async function fetchNutritionWeekAll(): Promise<NutritionWeekMeal[]> {
  return fetchJsonAuthed<NutritionWeekMeal[]>('/api/nutrition/week');
}

export { fetchJsonAuthed as nutritionAuthedJson };
