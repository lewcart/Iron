import { NextRequest, NextResponse } from 'next/server';
import { deleteProgressPhoto } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  await deleteProgressPhoto(uuid);
  return new NextResponse(null, { status: 204 });
}
