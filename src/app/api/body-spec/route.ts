import { NextRequest, NextResponse } from 'next/server';
import { listBodySpecLogs, createBodySpecLog } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '90', 10);
  const logs = await listBodySpecLogs(limit);
  return NextResponse.json(logs);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  const log = await createBodySpecLog({
    height_cm: body.height_cm != null ? parseFloat(body.height_cm) : null,
    weight_kg: body.weight_kg != null ? parseFloat(body.weight_kg) : null,
    body_fat_pct: body.body_fat_pct != null ? parseFloat(body.body_fat_pct) : null,
    lean_mass_kg: body.lean_mass_kg != null ? parseFloat(body.lean_mass_kg) : null,
    notes: body.notes ?? null,
    measured_at: body.measured_at,
  });
  return NextResponse.json(log, { status: 201 });
}
