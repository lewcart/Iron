import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/db';
import { requireApiKey } from '@/lib/api-auth';

interface AggRow {
  date: string;
  calories: string | number | null;
  protein_g: string | number | null;
  carbs_g: string | number | null;
  fat_g: string | number | null;
  log_count: string | number;
  approved_status: string | null;
}

// Re-exported from src/lib/nutrition-history-types.ts so the Capacitor build
// (which moves src/app/api out of the tree) can still type-import it.
export type { HistoryDay } from '@/lib/nutrition-history-types';
import type { HistoryDay } from '@/lib/nutrition-history-types';

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

function rangeToDays(range: string): number {
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  if (range === '90d') return 90;
  if (range === 'all') return 365 * 5; // 5 years cap
  return 30;
}

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') ?? '30d';
  const days = rangeToDays(range);

  // Aggregate macros per local-day from nutrition_logs, joined to day_notes
  // for approval state. Uses generate_series for densely populated date axis
  // (so empty days appear too).
  const rows = await query<AggRow>(
    `WITH range AS (
       SELECT generate_series(
         (CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day')::date,
         CURRENT_DATE,
         INTERVAL '1 day'
       )::date AS d
     ),
     log_agg AS (
       SELECT date_trunc('day', logged_at)::date AS d,
              SUM(calories) AS calories,
              SUM(protein_g) AS protein_g,
              SUM(carbs_g) AS carbs_g,
              SUM(fat_g) AS fat_g,
              COUNT(*) AS log_count
       FROM nutrition_logs
       WHERE logged_at >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
       GROUP BY 1
     )
     SELECT
       to_char(r.d, 'YYYY-MM-DD') AS date,
       la.calories, la.protein_g, la.carbs_g, la.fat_g,
       COALESCE(la.log_count, 0) AS log_count,
       nd.approved_status
     FROM range r
     LEFT JOIN log_agg la ON la.d = r.d
     LEFT JOIN nutrition_day_notes nd ON nd.date = to_char(r.d, 'YYYY-MM-DD')
     ORDER BY r.d DESC`,
    [days],
  );

  const out: HistoryDay[] = rows.map((r) => ({
    date: r.date,
    calories: num(r.calories),
    protein_g: num(r.protein_g),
    carbs_g: num(r.carbs_g),
    fat_g: num(r.fat_g),
    log_count: Number(r.log_count),
    approved_status: r.approved_status === 'approved' ? 'approved' : 'pending',
  }));

  return NextResponse.json(
    { days: out, range },
    { headers: { 'Cache-Control': 'private, max-age=30' } },
  );
}
