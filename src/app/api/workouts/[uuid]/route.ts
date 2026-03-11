import { NextResponse } from 'next/server';
import { getWorkout, finishWorkout, listWorkoutExercises, addExerciseToWorkout } from '@/db/queries';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  const workout = getWorkout(uuid);

  if (!workout) {
    return NextResponse.json({ error: 'Workout not found' }, { status: 404 });
  }

  const exercises = listWorkoutExercises(uuid);
  return NextResponse.json({ ...workout, exercises });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  const body = await request.json();

  if (body.action === 'finish') {
    const workout = finishWorkout(uuid);
    return NextResponse.json(workout);
  }

  if (body.action === 'add-exercise') {
    const workoutExercise = addExerciseToWorkout(uuid, body.exerciseUuid);
    return NextResponse.json(workoutExercise);
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
