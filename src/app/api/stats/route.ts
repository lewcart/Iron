import { NextResponse } from 'next/server';
import { getStatsData } from '@/lib/server/stats-data';

export async function GET() {
  const data = await getStatsData();
  return NextResponse.json(data);
}
