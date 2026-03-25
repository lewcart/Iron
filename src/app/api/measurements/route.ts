import { NextRequest, NextResponse } from 'next/server';
import { listMeasurementLogs, createMeasurementLog } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '90', 10);
  const site = searchParams.get('site') ?? undefined;
  const logs = await listMeasurementLogs({ limit, site });
  return NextResponse.json(logs);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  if (!body.site || body.value_cm == null) {
    return NextResponse.json({ error: 'site and value_cm are required' }, { status: 400 });
  }
  const log = await createMeasurementLog({
    site: body.site,
    value_cm: parseFloat(body.value_cm),
    notes: body.notes ?? null,
    measured_at: body.measured_at,
  });
  return NextResponse.json(log, { status: 201 });
}
