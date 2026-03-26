import { NextRequest, NextResponse } from 'next/server';
import { getStatsData } from '@/lib/server/stats-data';
import { getSummaryData } from '@/lib/server/summary-data';
import { getTimelineEntries } from '@/lib/server/timeline-entries';

/** Single round-trip bundle for the home feed (one HTTP request from the client). */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(parseInt(searchParams.get('days') ?? '30', 10), 90);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 200);

  const [stats, summary, timeline] = await Promise.all([
    getStatsData(),
    getSummaryData(),
    getTimelineEntries(days, limit),
  ]);

  return NextResponse.json({ stats, summary, timeline });
}
