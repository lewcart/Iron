import { NextRequest, NextResponse } from 'next/server';
import { getExercisePRs } from '@/db/queries';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  try {
    const { uuid } = await params;
    const { estimated1RM, heaviestWeight, mostReps } = await getExercisePRs(uuid);
    return NextResponse.json({ estimated1RM, heaviestWeight, mostReps });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
