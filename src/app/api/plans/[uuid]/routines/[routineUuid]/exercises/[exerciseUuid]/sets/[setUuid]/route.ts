import { NextRequest, NextResponse } from 'next/server';
import { updateRoutineSet, deleteRoutineSet } from '@/db/queries';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ setUuid: string }> }
) {
  try {
    const { setUuid } = await params;
    const body = await request.json();
    const set = await updateRoutineSet(setUuid, {
      min_repetitions: body.minRepetitions !== undefined ? (body.minRepetitions === '' ? null : Number(body.minRepetitions)) : undefined,
      max_repetitions: body.maxRepetitions !== undefined ? (body.maxRepetitions === '' ? null : Number(body.maxRepetitions)) : undefined,
    });
    if (!set) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(set);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ setUuid: string }> }
) {
  try {
    const { setUuid } = await params;
    await deleteRoutineSet(setUuid);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
