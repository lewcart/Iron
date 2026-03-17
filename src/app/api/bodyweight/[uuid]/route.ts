import { NextResponse } from 'next/server';
import { deleteBodyweightLog } from '@/db/queries';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  await deleteBodyweightLog(uuid);
  return new NextResponse(null, { status: 204 });
}
