import { NextRequest, NextResponse } from 'next/server';
import { listHrtLogs, createHrtLog } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '90', 10);
  const logs = await listHrtLogs(limit);
  return NextResponse.json(logs);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  if (!body.medication) {
    return NextResponse.json({ error: 'medication is required' }, { status: 400 });
  }
  const log = await createHrtLog({
    logged_at: body.logged_at,
    medication: body.medication,
    dose_mg: body.dose_mg != null ? parseFloat(body.dose_mg) : null,
    route: body.route ?? null,
    notes: body.notes ?? null,
  });
  return NextResponse.json(log, { status: 201 });
}
