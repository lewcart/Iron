import { NextRequest, NextResponse } from 'next/server';
import { startWorkoutFromRoutine } from '@/db/queries';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ uuid: string; routineUuid: string }> }
) {
  try {
    const { routineUuid } = await params;
    const workout = await startWorkoutFromRoutine(routineUuid);
    return NextResponse.json(workout, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
