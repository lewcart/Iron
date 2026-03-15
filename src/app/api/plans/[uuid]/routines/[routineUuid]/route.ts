import { NextResponse } from 'next/server';
import { updateRoutine, deleteRoutine } from '@/db/queries';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ uuid: string; routineUuid: string }> }
) {
  const { routineUuid } = await params;
  const body = await request.json();
  if (!body.title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const routine = await updateRoutine(routineUuid, body.title);
  return NextResponse.json(routine);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ uuid: string; routineUuid: string }> }
) {
  const { routineUuid } = await params;
  await deleteRoutine(routineUuid);
  return new NextResponse(null, { status: 204 });
}
