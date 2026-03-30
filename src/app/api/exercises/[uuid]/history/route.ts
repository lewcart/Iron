import { NextRequest, NextResponse } from 'next/server';
import {
  getExerciseProgress,
  getExercisePRs,
  getExerciseVolumeTrend,
  getExerciseRecentSets,
} from '@/db/queries';

function sinceDate(range: string): Date | undefined {
  const now = new Date();
  if (range === '1m') return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  if (range === '3m') return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  if (range === '6m') return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
  return undefined; // 'all'
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  try {
    const { uuid } = await params;
    const range = request.nextUrl.searchParams.get('range') ?? 'all';
    const since = sinceDate(range);

    const [progress, prs, volumeTrend, recentSets] = await Promise.all([
      getExerciseProgress(uuid, since),
      getExercisePRs(uuid),
      getExerciseVolumeTrend(uuid, since),
      getExerciseRecentSets(uuid),
    ]);

    return NextResponse.json({ progress, prs, volumeTrend, recentSets });
  } catch (err) {
    console.error('Exercise history error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
