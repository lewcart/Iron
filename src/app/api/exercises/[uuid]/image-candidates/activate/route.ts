import { NextRequest, NextResponse } from 'next/server';
import { query, transaction } from '@/db/db';
import { requireApiKey } from '@/lib/api-auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/exercises/[uuid]/image-candidates/activate
//
// Body: { batch_id: uuid }
// Activates an existing batch (sets is_active=true on its rows, false on
// every other batch's rows for this exercise) and mirrors the URLs into
// exercises.image_urls / image_count so the demo strip picks up the swap.
//
// Ownership predicate: the WHERE filter on `exercise_uuid` prevents a
// crafted batch_id from a different exercise being activated cross-exercise.
//
// Auth: requireApiKey.

interface PostBody {
  batch_id?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  if (!UUID_RE.test(uuid)) {
    return NextResponse.json({ error: 'Invalid uuid' }, { status: 400 });
  }
  const exerciseUuid = uuid.toLowerCase();

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.batch_id || !UUID_RE.test(body.batch_id)) {
    return NextResponse.json({ error: 'Invalid batch_id' }, { status: 400 });
  }
  const batchId = body.batch_id.toLowerCase();

  // Ownership check — also confirms the batch exists for this exercise
  // and gives us the URLs to mirror.
  const rows = await query<{ frame_index: number; url: string }>(
    `SELECT frame_index, url
       FROM exercise_image_candidates
      WHERE exercise_uuid = $1 AND batch_id = $2
      ORDER BY frame_index ASC`,
    [exerciseUuid, batchId],
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Batch not found for this exercise' }, { status: 404 });
  }

  const frame1Url = rows.find(r => r.frame_index === 1)?.url ?? null;
  const frame2Url = rows.find(r => r.frame_index === 2)?.url ?? null;
  if (!frame1Url || !frame2Url) {
    return NextResponse.json({ error: 'Batch is incomplete' }, { status: 409 });
  }

  try {
    await transaction([
      {
        text: `UPDATE exercise_image_candidates
                  SET is_active = (batch_id = $1)
                WHERE exercise_uuid = $2`,
        params: [batchId, exerciseUuid],
      },
      {
        text: `UPDATE exercises
                  SET image_urls = ARRAY[$1, $2]::text[],
                      image_count = 2,
                      updated_at = NOW()
                WHERE uuid = $3`,
        params: [frame1Url, frame2Url, exerciseUuid],
      },
    ]);
  } catch (err) {
    console.error('[image-candidates/activate] tx error:', err);
    // Postgres SQLSTATE 23505 = unique_violation. The only reachable
    // unique-violation here is the partial unique index on
    // (exercise_uuid, frame_index) WHERE is_active — i.e. a concurrent
    // activate race. Anything else (connection drop, FK error, syntax)
    // is a real 500.
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      return NextResponse.json(
        { error: 'Activation conflict — another activation just completed. Refresh and retry.' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: 'Activation failed.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    batch_id: batchId,
    image_urls: [frame1Url, frame2Url],
    image_count: 2,
  });
}
