import { NextRequest, NextResponse } from 'next/server';
import { getStatsData } from '@/lib/server/stats-data';
import { getSummaryData } from '@/lib/server/summary-data';
import { getTimelineEntries } from '@/lib/server/timeline-entries';
import { resolveTz } from '@/lib/app-tz';

/** Single round-trip bundle for the home feed (one HTTP request from the client). */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(parseInt(searchParams.get('days') ?? '30', 10), 90);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 200);
  const tz = resolveTz(searchParams.get('tz'));
  // Clamp week_offset: 0 = this week, negatives go back, positive forward
  // is rejected (the picker doesn't expose future weeks).
  const rawOffset = parseInt(searchParams.get('week_offset') ?? '0', 10);
  const weekOffset = Number.isFinite(rawOffset) ? Math.min(0, Math.max(-52, rawOffset)) : 0;

  const [stats, summary, timeline] = await Promise.all([
    getStatsData(),
    getSummaryData({ tz, weekOffset }),
    getTimelineEntries(days, limit),
  ]);

  return NextResponse.json({ stats, summary, timeline });
}
