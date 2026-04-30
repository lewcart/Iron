import { NextRequest, NextResponse } from 'next/server';
import { getExerciseSessionHistoryPaged } from '@/db/queries';

/** GET /api/exercises/[uuid]/sessions
 *
 * Paginated session-grouped history for an exercise. Used as a server-side
 * fallback when local Dexie history is exhausted (PR-C offline-first modal:
 * the modal reads from Dexie first; this endpoint backfills older sessions
 * the local cache might not hold).
 *
 * Query params:
 *   - cursor: keyset cursor `${start_time}|${workout_uuid}` from the previous
 *     page's nextCursor. Omit/null for first page.
 *   - limit: page size, default 10, hard-capped at 100.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  try {
    const { uuid } = await params;
    const cursor = request.nextUrl.searchParams.get('cursor');
    const limitRaw = parseInt(request.nextUrl.searchParams.get('limit') ?? '10', 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 100)
      : 10;

    const result = await getExerciseSessionHistoryPaged(uuid, cursor, limit);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Exercise sessions error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
