import { NextRequest, NextResponse } from 'next/server';
import { startWorkoutFromRoutine } from '@/db/queries';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ uuid: string; routineUuid: string }> }
) {
  try {
    const { routineUuid } = await params;
    const result = await startWorkoutFromRoutine(routineUuid);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('start-workout error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
