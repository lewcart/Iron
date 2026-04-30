'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/local';
import type {
  LocalNutritionLog,
  LocalNutritionWeekMeal,
  LocalNutritionDayNote,
  LocalNutritionTarget,
} from '@/db/local';

// ─── Nutrition logs (meals) ──────────────────────────────────────────────────

/** All meals logged on a specific date (ISO YYYY-MM-DD, user-local). */
export function useNutritionLogsForDate(date: string | null): LocalNutritionLog[] {
  return useLiveQuery(
    async () => {
      if (!date) return [] as LocalNutritionLog[];
      const all = await db.nutrition_logs.filter(l => !l._deleted).toArray();
      return all
        .filter(l => {
          // Compare against the LOCAL calendar day. The raw ISO timestamp is
          // UTC, so slicing the first 10 chars drifts for users east/west of
          // UTC eating near midnight.
          const t = Date.parse(l.logged_at);
          if (!Number.isFinite(t)) return false;
          const d = new Date(t);
          const yr = d.getFullYear();
          const mo = String(d.getMonth() + 1).padStart(2, '0');
          const da = String(d.getDate()).padStart(2, '0');
          return `${yr}-${mo}-${da}` === date;
        })
        .sort((a, b) => a.logged_at.localeCompare(b.logged_at));
    },
    [date],
    [],
  );
}

export function useRecentNutritionLogs(limit = 50): LocalNutritionLog[] {
  return useLiveQuery(
    async () => {
      const all = await db.nutrition_logs.filter(l => !l._deleted).toArray();
      return all
        .sort((a, b) => b.logged_at.localeCompare(a.logged_at))
        .slice(0, limit);
    },
    [limit],
    [],
  );
}

// ─── Week meals (planned schedule) ───────────────────────────────────────────

export function useWeekMeals(): LocalNutritionWeekMeal[] {
  return useLiveQuery(
    async () => {
      const all = await db.nutrition_week_meals.filter(m => !m._deleted).toArray();
      return all.sort((a, b) =>
        a.day_of_week !== b.day_of_week
          ? a.day_of_week - b.day_of_week
          : a.sort_order - b.sort_order,
      );
    },
    [],
    [],
  );
}

// ─── Day notes (per-date hydration + notes) ──────────────────────────────────

export function useDayNote(date: string | null): LocalNutritionDayNote | undefined {
  return useLiveQuery(
    async () => {
      if (!date) return undefined;
      return db.nutrition_day_notes.filter(d => d.date === date && !d._deleted).first();
    },
    [date],
  );
}

// ─── Targets (singleton id=1) ────────────────────────────────────────────────

export function useNutritionTargets(): LocalNutritionTarget | undefined {
  return useLiveQuery(
    async () => db.nutrition_targets.filter(t => !t._deleted).first(),
    [],
  );
}
