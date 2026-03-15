import { NextResponse } from 'next/server';
import { listWorkoutSets, logSet, updateSet } from '@/db/queries';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  const sets = await listWorkoutSets(uuid);
  return NextResponse.json(sets);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  const body = await request.json();

  if (body.setUuid) {
    // Update existing set
    const set = await updateSet(body.setUuid, {
      weight: body.weight,
      repetitions: body.repetitions,
      rpe: body.rpe,
      isCompleted: body.isCompleted,
    });
    return NextResponse.json(set);
  } else {
    // Log new set
    const set = await logSet({
      workoutExerciseUuid: uuid,
      weight: body.weight,
      repetitions: body.repetitions,
      rpe: body.rpe,
      tag: body.tag,
    });
    return NextResponse.json(set);
  }
}
