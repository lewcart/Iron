import { NextResponse } from 'next/server';
import { startWorkoutFromRoutine } from '@/db/queries';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ uuid: string; routineUuid: string }> }
) {
  const { routineUuid } = await params;
  const workout = await startWorkoutFromRoutine(routineUuid);
  return NextResponse.json(workout, { status: 201 });
}
