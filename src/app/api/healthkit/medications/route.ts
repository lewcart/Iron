/**
 * GET /api/healthkit/medications
 *
 * Returns Apple Health medication records the iOS sync layer has captured.
 * Mirrors the MCP get_hk_medications tool but as a plain JSON endpoint the
 * /hrt Meds tab can hit directly without going through MCP auth.
 *
 * Query params:
 *   days       — look-back window in days (default 30, max 365)
 *   medication — optional ILIKE filter on medication_name
 *   summary    — when "true", returns aggregated counts per medication
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(Number(searchParams.get('days') ?? 30), 1), 365);
  const medication = searchParams.get('medication');
  const summary = searchParams.get('summary') === 'true';

  if (summary) {
    const rows = await query<{
      medication_name: string;
      doses_in_window: number;
      last_taken_at: string;
    }>(
      `SELECT medication_name,
              COUNT(*)::int AS doses_in_window,
              MAX(taken_at) AS last_taken_at
         FROM healthkit_medications
        WHERE taken_at >= NOW() - ($1 || ' days')::interval
        GROUP BY medication_name
        ORDER BY doses_in_window DESC`,
      [days],
    );
    return NextResponse.json({
      window_days: days,
      medications: rows.map(r => ({
        ...r,
        last_taken_at: new Date(r.last_taken_at).toISOString(),
      })),
    });
  }

  const params: unknown[] = [days];
  let where = `taken_at >= NOW() - ($1 || ' days')::interval`;
  if (medication) {
    params.push(`%${medication}%`);
    where += ` AND medication_name ILIKE $${params.length}`;
  }

  const rows = await query<{
    hk_uuid: string;
    medication_name: string;
    dose_string: string | null;
    taken_at: string;
    scheduled_at: string | null;
    source_name: string | null;
  }>(
    `SELECT hk_uuid, medication_name, dose_string, taken_at, scheduled_at, source_name
       FROM healthkit_medications
      WHERE ${where}
      ORDER BY taken_at DESC
      LIMIT 1000`,
    params,
  );

  return NextResponse.json({
    medications: rows.map(r => ({
      ...r,
      taken_at: new Date(r.taken_at).toISOString(),
      scheduled_at: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
    })),
  });
}
