import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { listExercises } from '@/db/queries';

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
