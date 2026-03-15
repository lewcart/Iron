import { NextRequest, NextResponse } from 'next/server';
import { updateRoutine, deleteRoutine } from '@/db/queries';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string; routineUuid: string }> }
) {
  try {
    const { routineUuid } = await params;
    const body = await request.json();

    const data: { title?: string; comment?: string; orderIndex?: number } = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.comment !== undefined) data.comment = body.comment;
    if (body.orderIndex !== undefined) data.orderIndex = body.orderIndex;

    const routine = await updateRoutine(routineUuid, data);
    if (!routine) {
      return NextResponse.json({ error: 'Routine not found' }, { status: 404 });
    }
    return NextResponse.json(routine);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ uuid: string; routineUuid: string }> }
) {
  try {
    const { routineUuid } = await params;
    await deleteRoutine(routineUuid);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
