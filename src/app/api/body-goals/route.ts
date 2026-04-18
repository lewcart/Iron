import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { getBodyGoals } from '@/db/queries';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const goals = await getBodyGoals();
  return NextResponse.json(goals);
}
