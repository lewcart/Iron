import { NextRequest, NextResponse } from 'next/server';
import { listWellbeingLogs, createWellbeingLog } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '90', 10);
  const logs = await listWellbeingLogs(limit);
  return NextResponse.json(logs);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  const log = await createWellbeingLog({
    logged_at: body.logged_at,
    mood: body.mood != null ? parseInt(body.mood, 10) : null,
    energy: body.energy != null ? parseInt(body.energy, 10) : null,
    sleep_hours: body.sleep_hours != null ? parseFloat(body.sleep_hours) : null,
    sleep_quality: body.sleep_quality != null ? parseInt(body.sleep_quality, 10) : null,
    stress: body.stress != null ? parseInt(body.stress, 10) : null,
    notes: body.notes ?? null,
  });
  return NextResponse.json(log, { status: 201 });
}
