import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { getBodyNormRanges } from '@/db/queries';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const sex = searchParams.get('sex');
  if (sex !== 'M' && sex !== 'F') {
    return NextResponse.json({ error: 'sex query param must be M or F' }, { status: 400 });
  }
  const ranges = await getBodyNormRanges(sex);
  return NextResponse.json(ranges);
}
