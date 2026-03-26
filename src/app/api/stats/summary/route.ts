import { NextResponse } from 'next/server';
import { getSummaryData } from '@/lib/server/summary-data';

export async function GET() {
  const data = await getSummaryData();
  return NextResponse.json(data);
}
