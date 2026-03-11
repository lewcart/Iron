import { NextResponse } from 'next/server';
import { listWorkouts, startWorkout, getCurrentWorkout } from '@/db/queries';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const current = searchParams.get('current');

  if (current === 'true') {
    const workout = getCurrentWorkout();
    return NextResponse.json(workout);
  }

  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;
  const workouts = listWorkouts({ limit });
  return NextResponse.json(workouts);
}

export async function POST() {
  const workout = startWorkout();
  return NextResponse.json(workout);
}
