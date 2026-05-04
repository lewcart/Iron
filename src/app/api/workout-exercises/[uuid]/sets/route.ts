import { NextResponse } from 'next/server';
import {
  listWorkoutSets,
  logSet,
  updateSet,
  getWorkoutSet,
  getWorkoutExercise,
  recomputePRFlagsForExercise,
} from '@/db/queries';

/**
 * Run the canonical-group is_pr recompute for the exercise that owns
 * `workoutExerciseUuid`. Idempotent and self-correcting; safe to call
 * after any set mutation that could shift the historical PR position
 * (new set, weight/reps edit, completion toggle, excluded_from_pb flip).
 */
async function recomputeForWE(workoutExerciseUuid: string): Promise<void> {
  const we = await getWorkoutExercise(workoutExerciseUuid);
  if (!we) return;
  await recomputePRFlagsForExercise(we.exercise_uuid);
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
    // Update existing set. Any of these fields can shift the PR landscape:
    //   - weight, repetitions: changes the e1RM of this set
    //   - isCompleted: changes whether this set is even a PR candidate
    //   - excludedFromPb: hides/unhides this set from PR calculations
    let set = await updateSet(body.setUuid, {
      weight: body.weight,
      repetitions: body.repetitions,
      rpe: body.rpe,
      rir: body.rir,
      isCompleted: body.isCompleted,
      excludedFromPb: body.excludedFromPb,
    });

    const fieldsAffectingPR =
      body.weight !== undefined
      || body.repetitions !== undefined
      || body.isCompleted !== undefined
      || body.excludedFromPb !== undefined;

    if (fieldsAffectingPR) {
      await recomputeForWE(uuid);
      set = (await getWorkoutSet(set.uuid)) ?? set;
    }

    return NextResponse.json(set);
  } else {
    // Log new set. recomputePRFlagsForExercise handles is_pr stamping for
    // every set in the canonical group — including this brand-new one.
    let set = await logSet({
      workoutExerciseUuid: uuid,
      weight: body.weight,
      repetitions: body.repetitions,
      rpe: body.rpe,
      rir: body.rir,
      tag: body.tag,
    });

    if (body.weight && body.repetitions) {
      await recomputeForWE(uuid);
      set = (await getWorkoutSet(set.uuid)) ?? set;
    }

    return NextResponse.json(set);
  }
}
