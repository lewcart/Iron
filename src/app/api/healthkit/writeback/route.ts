/**
 * HealthKit writeback tracking.
 *
 * Records the HK sample UUIDs Rebirth authored (nutrition meals, InBody scans)
 * so that subsequent edits/deletes can clean up old HK samples before writing
 * fresh ones. Without this we'd double-count in Apple Health every time the
 * user edits a meal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, transaction } from '@/db/db';

interface WritebackSample {
  hk_type: string;
  hk_uuid: string;
}

interface RecordBody {
  source_kind: 'meal' | 'inbody' | 'workout';
  source_uuid: string;
  samples: WritebackSample[];
}

// GET ?source_kind=meal&source_uuid=...
// Returns existing writeback rows for a source (used to find HK UUIDs to delete
// before writing replacements on an edit).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get('source_kind');
  const uuid = searchParams.get('source_uuid');

  if (!kind || !uuid) {
    return NextResponse.json({ error: 'source_kind and source_uuid required' }, { status: 400 });
  }
  if (!['meal', 'inbody', 'workout'].includes(kind)) {
    return NextResponse.json({ error: 'invalid source_kind' }, { status: 400 });
  }

  const rows = await query<{ hk_type: string; hk_uuid: string; pending_delete: boolean }>(
    `SELECT hk_type, hk_uuid, pending_delete
       FROM healthkit_writeback
       WHERE source_kind = $1 AND source_uuid = $2`,
    [kind, uuid]
  );

  return NextResponse.json({ samples: rows });
}

// POST: record writeback rows after a successful native save. On conflict
// (same source_kind/source_uuid/hk_type) we overwrite with the new hk_uuid,
// which is what we want after an edit cycle (delete-old → save-new → record-new).
export async function POST(request: NextRequest) {
  let body: RecordBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.source_kind || !body.source_uuid || !Array.isArray(body.samples)) {
    return NextResponse.json({ error: 'source_kind, source_uuid, samples[] required' }, { status: 400 });
  }

  const statements = body.samples.map(s => ({
    text: `INSERT INTO healthkit_writeback
             (source_kind, source_uuid, hk_type, hk_uuid, pending_delete, written_at)
           VALUES ($1, $2, $3, $4, FALSE, NOW())
           ON CONFLICT (source_kind, source_uuid, hk_type) DO UPDATE SET
             hk_uuid = EXCLUDED.hk_uuid,
             pending_delete = FALSE,
             written_at = NOW()`,
    params: [body.source_kind, body.source_uuid, s.hk_type, s.hk_uuid],
  }));

  if (statements.length > 0) {
    await transaction(statements);
  }

  return NextResponse.json({ recorded: statements.length });
}

// DELETE ?source_kind=meal&source_uuid=...
// Drops writeback rows for a source (after a successful HK delete).
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get('source_kind');
  const uuid = searchParams.get('source_uuid');

  if (!kind || !uuid) {
    return NextResponse.json({ error: 'source_kind and source_uuid required' }, { status: 400 });
  }

  await query(
    `DELETE FROM healthkit_writeback WHERE source_kind = $1 AND source_uuid = $2`,
    [kind, uuid]
  );
  return NextResponse.json({ deleted: true });
}
