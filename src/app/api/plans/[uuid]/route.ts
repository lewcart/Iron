import { NextRequest, NextResponse } from 'next/server';
import { getPlan, listRoutines, listRoutineExercises, updatePlan, deletePlan, activatePlan } from '@/db/queries';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  try {
    const { uuid } = await params;
    const plan = await getPlan(uuid);

    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    const routines = await listRoutines(uuid);
    const routinesWithExercises = await Promise.all(
      routines.map(async (routine) => {
        const exercises = await listRoutineExercises(routine.uuid);
        return { ...routine, exercises };
      })
    );

    return NextResponse.json({ ...plan, routines: routinesWithExercises });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  try {
    const { uuid } = await params;
    const body = await request.json();

    if (body.isActive === true) {
      await activatePlan(uuid);
    }

    const data: { title?: string; orderIndex?: number } = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.orderIndex !== undefined) data.orderIndex = body.orderIndex;

    if (!data.title && data.orderIndex === undefined && body.isActive !== true) {
      return NextResponse.json({ error: 'title, orderIndex, or isActive is required' }, { status: 400 });
    }

    const plan = data.title !== undefined || data.orderIndex !== undefined
      ? await updatePlan(uuid, data)
      : await getPlan(uuid);

    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }
    return NextResponse.json(plan);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  try {
    const { uuid } = await params;
    await deletePlan(uuid);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
