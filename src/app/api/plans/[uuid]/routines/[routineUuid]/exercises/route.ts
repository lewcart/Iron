import { NextRequest, NextResponse } from 'next/server';
import { listRoutineExercises, listRoutineSets, addExerciseToRoutine } from '@/db/queries';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ uuid: string; routineUuid: string }> }
) {
  try {
    const { routineUuid } = await params;
    const exercises = await listRoutineExercises(routineUuid);
    const exercisesWithSets = await Promise.all(
      exercises.map(async (exercise) => {
        const sets = await listRoutineSets(exercise.uuid);
        return { ...exercise, sets };
      })
    );
    return NextResponse.json(exercisesWithSets);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string; routineUuid: string }> }
) {
  try {
    const { routineUuid } = await params;
    const body = await request.json();

    if (!body.exerciseUuid) {
      return NextResponse.json({ error: 'exerciseUuid is required' }, { status: 400 });
    }

    const exercise = await addExerciseToRoutine(routineUuid, body.exerciseUuid);
    return NextResponse.json(exercise, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
