import { NextResponse } from 'next/server';
import {
  getExerciseProgress,
  getExerciseVolumeTrend,
  getExerciseRecentSets,
  getExercisePRs,
} from '@/db/queries';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;

  const [progress, volumeTrend, recentSets, prs] = await Promise.all([
    getExerciseProgress(uuid),
    getExerciseVolumeTrend(uuid),
    getExerciseRecentSets(uuid, 20),
    getExercisePRs(uuid),
  ]);

  return NextResponse.json({
    progress: progress.map(row => ({
      date: row.date,
      maxWeight: row.max_weight,
      totalVolume: row.total_volume,
      estimated1RM: row.estimated_1rm,
    })),
    prs: {
      estimated1RM: prs.estimated1RM
        ? {
            exerciseUuid: prs.estimated1RM.exercise_uuid,
            weight: prs.estimated1RM.weight,
            repetitions: prs.estimated1RM.repetitions,
            estimated1RM: prs.estimated1RM.estimated_1rm,
            date: prs.estimated1RM.date,
          }
        : null,
      heaviestWeight: prs.heaviestWeight
        ? {
            exerciseUuid: prs.heaviestWeight.exercise_uuid,
            weight: prs.heaviestWeight.weight,
            repetitions: prs.heaviestWeight.repetitions,
            estimated1RM: prs.heaviestWeight.estimated_1rm,
            date: prs.heaviestWeight.date,
          }
        : null,
      mostReps: prs.mostReps
        ? {
            exerciseUuid: prs.mostReps.exercise_uuid,
            weight: prs.mostReps.weight,
            repetitions: prs.mostReps.repetitions,
            estimated1RM: prs.mostReps.estimated_1rm,
            date: prs.mostReps.date,
          }
        : null,
    },
    volumeTrend: volumeTrend.map(row => ({
      date: row.date,
      totalVolume: row.total_volume,
    })),
    recentSets: recentSets.map(row => ({
      date: row.date,
      weight: row.weight,
      repetitions: row.repetitions,
      rpe: row.rpe,
      workoutUuid: row.workout_uuid,
    })),
  });
}
