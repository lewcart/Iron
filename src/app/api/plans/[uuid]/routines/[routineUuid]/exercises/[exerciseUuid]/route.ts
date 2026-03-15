import { NextResponse } from 'next/server';
import { removeExerciseFromRoutine } from '@/db/queries';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ uuid: string; routineUuid: string; exerciseUuid: string }> }
) {
  const { routineUuid, exerciseUuid } = await params;
  await removeExerciseFromRoutine(routineUuid, exerciseUuid);
  return new NextResponse(null, { status: 204 });
}
