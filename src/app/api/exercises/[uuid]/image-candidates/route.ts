import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/db';
import { requireApiKey } from '@/lib/api-auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/exercises/[uuid]/image-candidates
//
// Returns all candidate pairs for an exercise, grouped by batch, newest
// first. Used by the manager sheet's history grid AND by the PWA-suspend
// recovery poller (?request_id=X — returns 200 with the matching batch
// once it appears, or empty until then).
//
// Auth: requireApiKey. Single-user app; no per-user scoping.
//
// Query params:
//   limit       — default 20, max 100
//   cursor      — ISO timestamp; return pairs created STRICTLY BEFORE this
//   request_id  — if set, only return rows for that recovery request

interface BatchOut {
  batch_id: string;
  created_at: string;
  is_active: boolean;
  frame1_url: string | null;
  frame2_url: string | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(req);
  if (denied) return denied;

  const { uuid } = await params;
  if (!UUID_RE.test(uuid)) {
    return NextResponse.json({ error: 'Invalid uuid' }, { status: 400 });
  }
  const exerciseUuid = uuid.toLowerCase();

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get('limit');
  const requestedLimit = limitRaw == null ? DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isFinite(requestedLimit)) {
    return NextResponse.json({ error: 'Invalid limit' }, { status: 400 });
  }
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);

  const cursor = url.searchParams.get('cursor');
  if (cursor != null && Number.isNaN(new Date(cursor).getTime())) {
    return NextResponse.json({ error: 'Invalid cursor (expected ISO timestamp)' }, { status: 400 });
  }

  const requestIdParam = url.searchParams.get('request_id');

  // Recovery poll path — narrow to candidates produced by a specific job.
  // We join through exercise_image_generation_jobs so the client can ask
  // "did MY regenerate succeed?" by request_id alone.
  if (requestIdParam) {
    if (!UUID_RE.test(requestIdParam)) {
      return NextResponse.json({ error: 'Invalid request_id' }, { status: 400 });
    }
    const job = await query<{ batch_id: string | null; status: string }>(
      `SELECT batch_id, status
         FROM exercise_image_generation_jobs
        WHERE request_id = $1 AND exercise_uuid = $2
        ORDER BY started_at DESC
        LIMIT 1`,
      [requestIdParam.toLowerCase(), exerciseUuid],
    );
    if (job.length === 0) {
      return NextResponse.json({ batches: [], status: 'unknown' });
    }
    const j = job[0];
    if (j.status !== 'succeeded' || !j.batch_id) {
      return NextResponse.json({ batches: [], status: j.status });
    }
    const rows = await fetchBatches(exerciseUuid, j.batch_id);
    return NextResponse.json({ batches: rows, status: 'succeeded' });
  }

  // Normal listing — paginate by created_at desc + cumulative cost summary
  // for the manager footer ("This exercise: N generations · $X.XX").
  const [rows, summary] = await Promise.all([
    fetchBatches(exerciseUuid, null, cursor, limit),
    query<{ generations: string; total_cost_cents: string }>(
      `SELECT COUNT(*)::text AS generations,
              COALESCE(SUM(cost_usd_cents), 0)::text AS total_cost_cents
         FROM exercise_image_generation_jobs
        WHERE exercise_uuid = $1`,
      [exerciseUuid],
    ),
  ]);
  return NextResponse.json({
    batches: rows,
    has_more: rows.length === limit,
    summary: {
      generations: Number(summary[0]?.generations ?? 0),
      total_cost_cents: Number(summary[0]?.total_cost_cents ?? 0),
    },
  });
}

/** Group candidates into batches. If batchFilter is set, return that one
 *  batch only. */
async function fetchBatches(
  exerciseUuid: string,
  batchFilter: string | null,
  cursor: string | null = null,
  limit: number = MAX_LIMIT,
): Promise<BatchOut[]> {
  const params: unknown[] = [exerciseUuid];
  let where = 'exercise_uuid = $1';
  if (batchFilter) {
    params.push(batchFilter);
    where += ` AND batch_id = $${params.length}`;
  }
  if (cursor) {
    params.push(cursor);
    where += ` AND batch_id IN (
      SELECT batch_id FROM exercise_image_candidates
       WHERE exercise_uuid = $1
         AND created_at < $${params.length}
       GROUP BY batch_id
    )`;
  }

  const raw = await query<{
    batch_id: string;
    frame_index: number;
    url: string;
    is_active: boolean;
    created_at: string;
  }>(
    `SELECT batch_id, frame_index, url, is_active, created_at
       FROM exercise_image_candidates
      WHERE ${where}
      ORDER BY created_at DESC, frame_index ASC`,
    params,
  );

  // Group into batches, preserve created_at-desc order.
  const order: string[] = [];
  const grouped = new Map<string, BatchOut>();
  for (const r of raw) {
    let b = grouped.get(r.batch_id);
    if (!b) {
      b = {
        batch_id: r.batch_id,
        created_at: typeof r.created_at === 'string'
          ? r.created_at
          : new Date(r.created_at).toISOString(),
        is_active: false,
        frame1_url: null,
        frame2_url: null,
      };
      grouped.set(r.batch_id, b);
      order.push(r.batch_id);
    }
    if (r.frame_index === 1) b.frame1_url = r.url;
    if (r.frame_index === 2) b.frame2_url = r.url;
    if (r.is_active) b.is_active = true;
  }

  const batches = order.map(id => grouped.get(id)!);
  // Apply limit AFTER grouping so a half-pair (shouldn't happen but defend
  // against partial DB state) doesn't eat the slot.
  return batches.slice(0, limit);
}
