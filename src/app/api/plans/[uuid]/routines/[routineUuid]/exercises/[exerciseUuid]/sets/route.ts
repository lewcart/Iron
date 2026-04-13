import { NextRequest, NextResponse } from 'next/server';
import { addRoutineSet } from '@/db/queries';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string; routineUuid: string; exerciseUuid: string }> }
) {
  try {
    const { exerciseUuid } = await params;
    const body = await request.json().catch(() => ({}));
    const set = await addRoutineSet(exerciseUuid, {
      minRepetitions: body.minRepetitions,
      maxRepetitions: body.maxRepetitions,
    });
    return NextResponse.json(set, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
