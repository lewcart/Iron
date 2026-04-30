'use client';

import { useEffect, useState } from 'react';
import { rebirthJsonHeaders } from '@/lib/api/headers';

interface WorkoutsResponse {
  date: string;
  total_kcal: number;
  workout_count: number;
}

/**
 * Fetches the day's burned calories from `healthkit_workouts`. Refreshes on
 * date change. Returns 0 while loading or on error so the UI never shows
 * stale numbers.
 */
export function useTodayWorkoutCalories(date: string | null): number {
  const [kcal, setKcal] = useState(0);

  useEffect(() => {
    if (!date) {
      setKcal(0);
      return;
    }
    let cancelled = false;
    fetch(`/api/nutrition/today-workouts?date=${encodeURIComponent(date)}`, {
      headers: rebirthJsonHeaders(),
    })
      .then((r) => (r.ok ? (r.json() as Promise<WorkoutsResponse>) : null))
      .then((data) => {
        if (!cancelled) setKcal(data?.total_kcal ?? 0);
      })
      .catch(() => {
        if (!cancelled) setKcal(0);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  return kcal;
}
