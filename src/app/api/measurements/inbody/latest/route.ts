import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { getLatestInbodyScan } from '@/db/queries';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const scan = await getLatestInbodyScan();
  if (!scan) return NextResponse.json(null);
  return NextResponse.json(scan);
}
