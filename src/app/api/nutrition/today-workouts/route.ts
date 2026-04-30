import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/db';
import { requireApiKey } from '@/lib/api-auth';

/**
 * Sum of `total_energy_kcal` from `healthkit_workouts` for the given local
 * calendar day. Powers the "Workouts" line on the CalorieBalanceCard so that
 * the day's calorie remainder reflects what was burned, not just consumed.
 *
 * `healthkit_workouts` is server-only (not in the local-first sync set), so
 * we expose this aggregate via a small endpoint instead of a Dexie query.
 */

interface AggRow {
  total_kcal: string | number | null;
  workout_count: string | number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') ?? '';

  if (!DATE_RE.test(date)) {
    return NextResponse.json(
      { error: 'date is required (YYYY-MM-DD)' },
      { status: 400 },
    );
  }

  // start_at is TIMESTAMPTZ. Compare against the LOCAL calendar day so that a
  // workout finishing at 23:30 local on the 14th doesn't get counted on the
  // 15th if the underlying timestamp happened to fall after UTC midnight.
  const rows = await query<AggRow>(
    `SELECT
       COALESCE(SUM(total_energy_kcal), 0) AS total_kcal,
       COUNT(*) AS workout_count
     FROM healthkit_workouts
     WHERE (start_at AT TIME ZONE 'UTC' AT TIME ZONE current_setting('TimeZone'))::date = $1::date
        OR start_at::date = $1::date`,
    [date],
  );

  const r = rows[0];
  const total = r?.total_kcal == null ? 0 : Number(r.total_kcal);

  return NextResponse.json(
    {
      date,
      total_kcal: Number.isFinite(total) ? total : 0,
      workout_count: r ? Number(r.workout_count) : 0,
    },
    { headers: { 'Cache-Control': 'private, max-age=30' } },
  );
}
