import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { getClothesTestLog, updateClothesTestLog, deleteClothesTestLog } from '@/db/queries';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  const log = await getClothesTestLog(uuid);
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
  const log = await updateClothesTestLog(uuid, body);
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
  await deleteClothesTestLog(uuid);
  return new NextResponse(null, { status: 204 });
}
