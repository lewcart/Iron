import { NextRequest, NextResponse } from 'next/server';
import { removeExerciseFromRoutine, updateRoutineExercise } from '@/db/queries';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string; routineUuid: string; exerciseUuid: string }> }
) {
  try {
    const { exerciseUuid } = await params;
    const body = await request.json();
    const updated = await updateRoutineExercise(exerciseUuid, { comment: body.comment ?? null });
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ uuid: string; routineUuid: string; exerciseUuid: string }> }
) {
  try {
    const { exerciseUuid } = await params;
    await removeExerciseFromRoutine(exerciseUuid);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
