import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/db/db';
import { requireApiKey } from '@/lib/api-auth';
import { computeDayAdherence, computeStreak, DEFAULT_BANDS } from '@/lib/adherence';
import type { MacroBands } from '@/db/local';

interface DayRow {
  date: string;
  calories: string | number | null;
  protein_g: string | number | null;
  carbs_g: string | number | null;
  fat_g: string | number | null;
  log_count: string | number;
  approved_status: string | null;
  max_updated: string | null;
}

interface TargetsRow {
  calories: string | number | null;
  protein_g: string | number | null;
  carbs_g: string | number | null;
  fat_g: string | number | null;
  bands: MacroBands | null;
}

// Source of truth lives in src/lib/nutrition-history-types.ts so the
// Capacitor build can import it from client code (cap build moves
// src/app/api out of the tree before next build).
export type { SummaryDay } from '@/lib/nutrition-history-types';
import type { SummaryDay } from '@/lib/nutrition-history-types';

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

function rangeToDays(range: string): number {
  if (range === 'week') return 7;
  if (range === 'month') return 30;
  if (range === 'all') return 365 * 5;
  return 7;
}

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') ?? 'week';
  const days = rangeToDays(range);

  const targetsRow = await queryOne<TargetsRow>(
    `SELECT calories, protein_g, carbs_g, fat_g, bands FROM nutrition_targets WHERE id = 1`,
  );
  const targets = targetsRow
    ? {
        id: 1 as const,
        calories: num(targetsRow.calories),
        protein_g: num(targetsRow.protein_g),
        carbs_g: num(targetsRow.carbs_g),
        fat_g: num(targetsRow.fat_g),
        bands: targetsRow.bands,
        _synced: true as const,
        _updated_at: 0,
        _deleted: false as const,
      }
    : null;

  const bands = (targets?.bands ?? DEFAULT_BANDS) as MacroBands;

  const rows = await query<DayRow>(
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
              COUNT(*) AS log_count,
              MAX(updated_at) AS max_updated
       FROM nutrition_logs
       WHERE logged_at >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
       GROUP BY 1
     )
     SELECT
       to_char(r.d, 'YYYY-MM-DD') AS date,
       la.calories, la.protein_g, la.carbs_g, la.fat_g,
       COALESCE(la.log_count, 0) AS log_count,
       nd.approved_status,
       GREATEST(la.max_updated, nd.updated_at)::text AS max_updated
     FROM range r
     LEFT JOIN log_agg la ON la.d = r.d
     LEFT JOIN nutrition_day_notes nd ON nd.date = to_char(r.d, 'YYYY-MM-DD')
     ORDER BY r.d DESC`,
    [days],
  );

  let approved = 0;
  let auto_logged = 0;
  let missed = 0;
  let in_band_count = 0;
  let denominator = 0;
  let latestUpdate = 0;

  const summaryDays: SummaryDay[] = rows.map((r) => {
    const macros = {
      calories: num(r.calories),
      protein_g: num(r.protein_g),
      carbs_g: num(r.carbs_g),
      fat_g: num(r.fat_g),
    };
    const hasData = Number(r.log_count) > 0;
    const adh = computeDayAdherence(macros, targets, bands);
    const status: 'pending' | 'approved' = r.approved_status === 'approved' ? 'approved' : 'pending';

    if (status === 'approved') approved++;
    else if (hasData) auto_logged++;
    else missed++;

    if (hasData && adh.target_count > 0) {
      denominator++;
      if (adh.in_band) in_band_count++;
    }

    if (r.max_updated) {
      const t = Date.parse(r.max_updated);
      if (Number.isFinite(t) && t > latestUpdate) latestUpdate = t;
    }

    return {
      date: r.date,
      calories: macros.calories,
      protein_g: macros.protein_g,
      carbs_g: macros.carbs_g,
      fat_g: macros.fat_g,
      hit_count: adh.hit_count,
      target_count: adh.target_count,
      has_data: hasData,
      approved_status: status,
    };
  });

  const adherence_pct = denominator > 0 ? Math.round((in_band_count / denominator) * 100) : null;
  const streak = computeStreak(
    summaryDays.map((d) => ({
      adherence: { hit_count: d.hit_count, target_count: d.target_count, in_band: d.target_count > 0 && d.hit_count === d.target_count },
      has_data: d.has_data,
    })),
  );

  const etag = `W/"${range}-${latestUpdate || 0}-${denominator}-${in_band_count}"`;
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return NextResponse.json(
    {
      range,
      days: summaryDays,
      targets: targets
        ? {
            calories: targets.calories,
            protein_g: targets.protein_g,
            carbs_g: targets.carbs_g,
            fat_g: targets.fat_g,
            bands,
          }
        : null,
      derived: {
        adherence_pct,
        streak_days: streak,
        approval_counts: { approved, auto_logged, missed },
      },
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=30',
        ETag: etag,
      },
    },
  );
}
