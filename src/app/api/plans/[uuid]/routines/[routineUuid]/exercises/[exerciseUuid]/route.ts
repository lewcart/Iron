import { NextRequest, NextResponse } from 'next/server';
import { removeExerciseFromRoutine } from '@/db/queries';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ uuid: string; routineUuid: string; exerciseUuid: string }> }
) {
  try {
    const { exerciseUuid } = await params;
    await removeExerciseFromRoutine(exerciseUuid);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
