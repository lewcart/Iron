import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { getMotivationCorrelation } from '@/db/queries';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') ?? '30', 10);
  const data = await getMotivationCorrelation(days);
  return NextResponse.json(data);
}
