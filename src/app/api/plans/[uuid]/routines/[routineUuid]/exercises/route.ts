import { NextResponse } from 'next/server';
import { listRoutineExercises, addExerciseToRoutine } from '@/db/queries';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ uuid: string; routineUuid: string }> }
) {
  const { routineUuid } = await params;
  const exercises = await listRoutineExercises(routineUuid);
  return NextResponse.json(exercises);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ uuid: string; routineUuid: string }> }
) {
  const { routineUuid } = await params;
  const body = await request.json();
  if (!body.exerciseUuid) {
    return NextResponse.json({ error: 'exerciseUuid is required' }, { status: 400 });
  }
  const exercise = await addExerciseToRoutine(routineUuid, body.exerciseUuid);
  return NextResponse.json(exercise, { status: 201 });
}
