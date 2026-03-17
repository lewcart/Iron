import { NextResponse } from 'next/server';
import { getWorkout, getCurrentWorkout, repeatWorkout } from '@/db/queries';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;

  const source = await getWorkout(uuid);
  if (!source) {
    return NextResponse.json({ error: 'Workout not found' }, { status: 404 });
  }

  const current = await getCurrentWorkout();
  if (current) {
    return NextResponse.json({ error: 'A workout is already in progress' }, { status: 409 });
  }

  const workout = await repeatWorkout(uuid);
  return NextResponse.json({ uuid: workout.uuid });
}
