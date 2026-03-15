import { NextRequest, NextResponse } from 'next/server';
import {
  getExerciseProgress,
  getExercisePRs,
  getExerciseVolumeTrend,
  getExerciseRecentSets,
} from '@/db/queries';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  try {
    const { uuid } = await params;

    const [progress, prs, volumeTrend, recentSets] = await Promise.all([
      getExerciseProgress(uuid),
      getExercisePRs(uuid),
      getExerciseVolumeTrend(uuid),
      getExerciseRecentSets(uuid),
    ]);

    return NextResponse.json({ progress, prs, volumeTrend, recentSets });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
