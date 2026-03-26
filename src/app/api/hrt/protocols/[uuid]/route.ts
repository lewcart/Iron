import { NextRequest, NextResponse } from 'next/server';
import { getHrtProtocol, updateHrtProtocol, deleteHrtProtocol } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  const protocol = await getHrtProtocol(uuid);
  if (!protocol) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(protocol);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  const body = await request.json();
  const protocol = await updateHrtProtocol(uuid, body);
  if (!protocol) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(protocol);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  await deleteHrtProtocol(uuid);
  return new NextResponse(null, { status: 204 });
}
