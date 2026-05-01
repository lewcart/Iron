import {
  getWeekWorkouts,
  getWeekVolume,
  getWorkoutStreak,
  getWeekMuscleFrequency,
  getWeekSetsPerMuscle,
  getLastWorkoutsWithDetails,
} from '@/db/queries';
import { muscleStatus, type MuscleStatus } from '@/lib/muscles';
import type { SetsByMuscleRow } from '@/lib/api/feed-types';

function computeStreak(weekRows: { week_start: string }[]): number {
  if (weekRows.length === 0) return 0;

  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const currentWeekMonday = new Date(now);
  currentWeekMonday.setDate(now.getDate() + mondayOffset);
  currentWeekMonday.setHours(0, 0, 0, 0);

  const weekSet = new Set(weekRows.map(r => String(r.week_start).slice(0, 10)));

  let streak = 0;
  const checkDate = new Date(currentWeekMonday);

  while (true) {
    const iso = checkDate.toISOString().slice(0, 10);
    if (weekSet.has(iso)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 7);
    } else {
      break;
    }
  }

  return streak;
}

function aggregateMuscleFrequency(rows: { primary_muscles: string[] | string }[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const row of rows) {
    const muscles = Array.isArray(row.primary_muscles)
      ? row.primary_muscles
      : JSON.parse((row.primary_muscles as string) || '[]');
    for (const muscle of muscles) {
      const key = String(muscle).toLowerCase();
      freq[key] = (freq[key] ?? 0) + 1;
    }
  }
  return freq;
}

export interface SummaryPayload {
  weekWorkouts: number;
  weekVolume: number;
  currentStreak: number;
  lastWorkouts: {
    uuid: string;
    start_time: string;
    end_time: string | null;
    title: string | null;
    exercises: string[];
    volume: number;
  }[];
  /** @deprecated Use setsByMuscle. Kept for one release while UI migrates. */
  muscleFrequency: Record<string, number>;
  setsByMuscle: SetsByMuscleRow[];
}

export async function getSummaryData(): Promise<SummaryPayload> {
  const [weekWorkoutsRows, weekVolume, streakRows, muscleRows, setsRows, lastWorkouts] = await Promise.all([
    getWeekWorkouts(),
    getWeekVolume(),
    getWorkoutStreak(),
    getWeekMuscleFrequency(),
    getWeekSetsPerMuscle(0),
    getLastWorkoutsWithDetails(3),
  ]);

  const currentStreak = computeStreak(streakRows);
  const muscleFrequency = aggregateMuscleFrequency(muscleRows);

  const setsByMuscle: SetsByMuscleRow[] = setsRows.map(r => ({
    slug: r.slug,
    display_name: r.display_name,
    parent_group: r.parent_group,
    set_count: r.set_count,
    effective_set_count: r.effective_set_count,
    optimal_min: r.optimal_sets_min,
    optimal_max: r.optimal_sets_max,
    display_order: r.display_order,
    status: muscleStatus(r.set_count, r.optimal_sets_min, r.optimal_sets_max) as MuscleStatus,
    coverage: r.coverage,
    kg_volume: r.kg_volume,
  }));

  return {
    weekWorkouts: weekWorkoutsRows.length,
    weekVolume,
    currentStreak,
    lastWorkouts,
    muscleFrequency,
    setsByMuscle,
  };
}
