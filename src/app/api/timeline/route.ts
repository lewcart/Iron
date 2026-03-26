import { NextRequest, NextResponse } from 'next/server';
import {
  getTimelineEntries,
  type TimelineEntry,
  type TimelineModule,
} from '@/lib/server/timeline-entries';

export type { TimelineEntry, TimelineModule };

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(parseInt(searchParams.get('days') ?? '30', 10), 90);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);

  const entries = await getTimelineEntries(days, limit);
  return NextResponse.json(entries);
}
