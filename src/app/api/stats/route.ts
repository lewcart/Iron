import { NextResponse } from 'next/server';
import { query } from '@/db/db';

export async function GET() {
  // Last 28 days of activity
  const twentyEightDaysAgo = new Date();
  twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 27);
  twentyEightDaysAgo.setHours(0, 0, 0, 0);

  const activityRows = await query<{ day: string }>(
    `SELECT DISTINCT DATE(start_time AT TIME ZONE 'UTC') as day
     FROM workouts
     WHERE is_current = false
       AND start_time >= $1
     ORDER BY day`,
    [twentyEightDaysAgo.toISOString()]
  );
  const activeDays = activityRows.map(r => String(r.day).slice(0, 10));

  // Workouts per week for last 8 weeks
  const eightWeeksAgo = new Date();
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 55);
  eightWeeksAgo.setHours(0, 0, 0, 0);

  const weeklyRows = await query<{ week_start: string; count: string }>(
    `SELECT
       DATE_TRUNC('week', start_time AT TIME ZONE 'UTC') as week_start,
       COUNT(*) as count
     FROM workouts
     WHERE is_current = false
       AND start_time >= $1
     GROUP BY week_start
     ORDER BY week_start`,
    [eightWeeksAgo.toISOString()]
  );

  const weeklyData = weeklyRows.map(r => ({
    week: String(r.week_start).slice(0, 10),
    count: parseInt(r.count),
  }));

  return NextResponse.json({ activeDays, weeklyData });
}
