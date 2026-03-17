import { NextResponse } from 'next/server';
import {
  listWorkoutSets,
  logSet,
  updateSet,
  getWorkoutSet,
  getWorkoutExercise,
  getHistoricalBestsForExercise,
} from '@/db/queries';
import { estimate1RM } from '@/lib/pr';

async function detectAndMarkPR(
  setUuid: string,
  workoutExerciseUuid: string,
  weight: number,
  repetitions: number,
): Promise<boolean> {
  const we = await getWorkoutExercise(workoutExerciseUuid);
  if (!we) return false;

  const bests = await getHistoricalBestsForExercise(we.exercise_uuid, we.workout_uuid);
  const new1RM = estimate1RM(weight, repetitions);

  const isPR =
    weight > bests.bestWeight ||
    repetitions > bests.bestReps ||
    new1RM > bests.best1RM;

  if (isPR) {
    await updateSet(setUuid, { isPr: true });
  }
  return isPR;
}

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
    let set = await updateSet(body.setUuid, {
      weight: body.weight,
      repetitions: body.repetitions,
      rpe: body.rpe,
      isCompleted: body.isCompleted,
    });

    // Detect PR when marking as completed with real data
    if (body.isCompleted && body.weight && body.repetitions) {
      await detectAndMarkPR(set.uuid, uuid, body.weight, body.repetitions);
      set = (await getWorkoutSet(set.uuid)) ?? set;
    }

    return NextResponse.json(set);
  } else {
    // Log new set
    let set = await logSet({
      workoutExerciseUuid: uuid,
      weight: body.weight,
      repetitions: body.repetitions,
      rpe: body.rpe,
      tag: body.tag,
    });

    // Detect PR for new completed sets with real data
    if (body.weight && body.repetitions) {
      await detectAndMarkPR(set.uuid, uuid, body.weight, body.repetitions);
      set = (await getWorkoutSet(set.uuid)) ?? set;
    }

    return NextResponse.json(set);
  }
}
