import { NextRequest, NextResponse } from 'next/server';
import { getWellbeingLog, updateWellbeingLog, deleteWellbeingLog } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  const log = await getWellbeingLog(uuid);
  if (!log) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(log);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  const body = await request.json();
  const log = await updateWellbeingLog(uuid, body);
  if (!log) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(log);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  await deleteWellbeingLog(uuid);
  return new NextResponse(null, { status: 204 });
}
