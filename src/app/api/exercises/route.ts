import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { listExercises, createCustomExercise } from '@/db/queries';

const getCachedExercises = unstable_cache(
  async (search: string, muscleGroup: string, equipment: string) =>
    listExercises({
      search: search || undefined,
      muscleGroup: muscleGroup || undefined,
      equipment: equipment || undefined,
    }),
  ['exercises-api'],
  { revalidate: 3600 }
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') ?? '';
  const muscleGroup = searchParams.get('muscleGroup') ?? '';
  const equipment = searchParams.get('equipment') ?? '';

  // unstable_cache requires Next incremental cache (not available in Vitest).
  const exercises =
    process.env.VITEST === 'true' || process.env.NODE_ENV === 'test'
      ? await listExercises({
          search: search || undefined,
          muscleGroup: muscleGroup || undefined,
          equipment: equipment || undefined,
        })
      : await getCachedExercises(search, muscleGroup, equipment);

  return NextResponse.json(exercises);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const data = body as Record<string, unknown>;
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const primaryMuscles = Array.isArray(data.primary_muscles)
    ? (data.primary_muscles as unknown[]).filter((m): m is string => typeof m === 'string')
    : [];
  if (primaryMuscles.length === 0) {
    return NextResponse.json({ error: 'primary_muscles is required' }, { status: 400 });
  }

  const secondaryMuscles = Array.isArray(data.secondary_muscles)
    ? (data.secondary_muscles as unknown[]).filter((m): m is string => typeof m === 'string')
    : [];
  const equipment = Array.isArray(data.equipment)
    ? (data.equipment as unknown[]).filter((e): e is string => typeof e === 'string')
    : [];
  const description = typeof data.description === 'string' ? data.description.trim() || undefined : undefined;
  const movementPattern = typeof data.movement_pattern === 'string' ? data.movement_pattern.trim() || undefined : undefined;

  const exercise = await createCustomExercise({
    title,
    description,
    primaryMuscles,
    secondaryMuscles,
    equipment,
    movementPattern,
  });

  return NextResponse.json(exercise, { status: 201 });
}
