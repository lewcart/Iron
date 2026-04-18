import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import {
  getInbodyScan,
  updateInbodyScan,
  deleteInbodyScan,
  type InbodyScanInput,
} from '@/db/queries';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const { uuid } = await params;
  const scan = await getInbodyScan(uuid);
  if (!scan) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(scan);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const { uuid } = await params;
  const body = await request.json();
  const scan = await updateInbodyScan(uuid, body as Partial<InbodyScanInput>);
  if (!scan) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(scan);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const { uuid } = await params;
  await deleteInbodyScan(uuid);
  return new NextResponse(null, { status: 204 });
}
