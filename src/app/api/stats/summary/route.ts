import { NextResponse } from 'next/server';
import {
  getWeekWorkouts,
  getWeekVolume,
  getWorkoutStreak,
  getWeekMuscleFrequency,
  getLastWorkoutsWithDetails,
} from '@/db/queries';

function computeStreak(weekRows: { week_start: string }[]): number {
  if (weekRows.length === 0) return 0;

  // Get current week's Monday (date_trunc week)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
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
      : JSON.parse(row.primary_muscles as string || '[]');
    for (const muscle of muscles) {
      const key = String(muscle).toLowerCase();
      freq[key] = (freq[key] ?? 0) + 1;
    }
  }
  return freq;
}

export async function GET() {
  const [weekWorkoutsRows, weekVolume, streakRows, muscleRows, lastWorkouts] = await Promise.all([
    getWeekWorkouts(),
    getWeekVolume(),
    getWorkoutStreak(),
    getWeekMuscleFrequency(),
    getLastWorkoutsWithDetails(3),
  ]);

  const currentStreak = computeStreak(streakRows);
  const muscleFrequency = aggregateMuscleFrequency(muscleRows);

  return NextResponse.json({
    weekWorkouts: weekWorkoutsRows.length,
    weekVolume,
    currentStreak,
    lastWorkouts,
    muscleFrequency,
  });
}
