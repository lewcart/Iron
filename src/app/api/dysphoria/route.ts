import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { listDysphoriaLogs, createDysphoriaLog } from '@/db/queries';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '90', 10);
  const logs = await listDysphoriaLogs(limit);
  return NextResponse.json(logs);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  if (body.scale == null) {
    return NextResponse.json({ error: 'scale is required' }, { status: 400 });
  }
  const log = await createDysphoriaLog({
    logged_at: body.logged_at,
    scale: parseInt(body.scale, 10),
    note: body.note ?? null,
  });
  return NextResponse.json(log, { status: 201 });
}
