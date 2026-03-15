import { NextResponse } from 'next/server';
import { listExercises } from '@/db/queries';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || undefined;
  const muscleGroup = searchParams.get('muscleGroup') || undefined;
  const equipment = searchParams.get('equipment') || undefined;

  const exercises = await listExercises({ search, muscleGroup, equipment });
  return NextResponse.json(exercises);
}
