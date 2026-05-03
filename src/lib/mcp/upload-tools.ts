/**
 * Rebirth MCP — chunked-upload tools.
 *
 * Why this exists: Anthropic's mobile MCP client silently rejects tool calls
 * whose serialized arguments exceed a sub-64k char threshold ("Error: No
 * approval received"). The request never reaches the server. The existing
 * upload_progress_photo / upload_inspo_photo / upload_projection_photo tools
 * accept image_base64 directly, which is unusable from Claude iOS for any
 * image larger than ~48KB binary.
 *
 * Protocol:
 *
 *   start_upload(kind)               → { upload_id, chunk_size_recommended }
 *   upload_chunk(upload_id, seq, b64) → { ok, chunks_received, bytes_so_far }   (idempotent)
 *   finalize_<kind>_photo(upload_id, ...) → photo row
 *
 * The existing image_base64 / image_url paths on the original three tools are
 * preserved unchanged for server-to-server clients (curl, Codex agents,
 * future tools) where the inline-payload gate does not apply.
 *
 * Single-user app (Lou only): no per-user scoping on staging rows. GC is
 * opportunistic — start_upload AND every finalize call sweep orphan sessions
 * older than GC_HORIZON_MS. No cron needed.
 */

import { randomUUID } from 'crypto';
import { query, queryOne } from '@/db/db';
import type { MCPTool } from '@/lib/mcp-tools';
import { ALL_POSES, isPose } from '@/lib/poses';
import {
  createProgressPhoto,
  createInspoPhoto,
  createProjectionPhoto,
} from '@/db/queries';
import type { ProgressPhotoPose } from '@/types';

// Inlined to avoid the runtime cycle with mcp-tools.ts (which imports
// uploadChunkedTools from this file). Same shape as the canonical helpers
// in mcp-tools.ts; the nutrition-tools module uses the same trick.
function toolResult(content: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(content, null, 2) }] };
}
function toolErrorEnvelope(code: string, message: string, hint?: string) {
  return {
    content: [
      { type: 'text', text: JSON.stringify({ error: { code, message, hint } }, null, 2) },
    ],
    isError: true,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Recommended chunk size in characters. Anthropic's mobile MCP client gate
 * sits sub-64k chars on serialized tool-call arguments. 30k leaves comfortable
 * headroom for the JSON-RPC envelope (method/id/upload_id/sequence wrapper)
 * plus future-proofing if Anthropic tightens the threshold. Hardcoded
 * deliberately: single-user app, easy to redeploy if Anthropic changes the
 * gate.
 */
const CHUNK_SIZE_RECOMMENDED = 30_000;

/**
 * Hard cap on cumulative decoded image size per upload. 25MB is generous for
 * a phone JPEG (typical 3–5MB) but rules out video / accidental gigabyte
 * payloads OOM-ing the Vercel function during finalize. Enforced at
 * upload_chunk receive time so a runaway upload fails fast at chunk N rather
 * than crashing the function at chunk N+50.
 *
 * Cap is on cumulative *base64 character length* (not decoded bytes), which
 * is ~33% larger than the binary size. So 25MB binary ≈ 33MB of b64 chars.
 * Choosing the b64-char ceiling keeps the bookkeeping cheap (one column).
 */
const MAX_TOTAL_B64_CHARS = 33_000_000;

/**
 * Sweep horizon for orphan sessions (1 hour). Any mcp_upload_sessions row
 * with finalized_at IS NULL and created_at older than this gets DELETEd by
 * GC, which cascades to its chunks.
 */
const GC_HORIZON_MS = 60 * 60 * 1000;

const VALID_KINDS = ['progress', 'projection', 'inspo'] as const;
type UploadKind = typeof VALID_KINDS[number];

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
};

// ── Internal helpers ──────────────────────────────────────────────────────────

interface SessionRow {
  upload_id: string;
  kind: UploadKind;
  mime_type: string | null;
  created_at: string;
}

interface ChunkRow {
  sequence: number;
  data_b64: string;
  byte_length: number;
}

/**
 * Sweep orphan sessions (created > 1h ago, still in the staging table).
 * Cheap one-shot DELETE — finalized sessions are already removed by
 * cleanupSession, so this only catches abandoned uploads. Safe to call
 * from any tool; does not throw on Postgres errors (best-effort cleanup).
 */
async function gcOrphans(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - GC_HORIZON_MS).toISOString();
    await query(
      `DELETE FROM mcp_upload_sessions WHERE created_at < $1`,
      [cutoff],
    );
  } catch {
    // Best-effort. Failure to GC must not break the user's actual upload.
  }
}

/**
 * Load all chunks for a session, verify contiguity, concat + decode.
 *
 * Single roundtrip: a LEFT JOIN pulls the session row + all chunk rows in
 * one shot. Session columns repeat on every row (denormalized), which is
 * fine for the ~30 rows we typically see and saves a Postgres roundtrip on
 * the finalize hot path.
 *
 * Returns either the assembled buffer (with kind + mime_type lifted from the
 * session row) or a structured error envelope ready to return from the tool.
 */
async function loadAndAssemble(
  uploadId: string,
  expectedKind: UploadKind,
): Promise<
  | { ok: true; buffer: Buffer; mime_type: string; session: SessionRow }
  | { ok: false; error: ReturnType<typeof toolErrorEnvelope> }
> {
  type JoinedRow = {
    upload_id: string;
    kind: UploadKind;
    mime_type: string | null;
    created_at: string;
    sequence: number | null;
    data_b64: string | null;
    byte_length: number | null;
  };
  const rows = await query<JoinedRow>(
    `SELECT s.upload_id, s.kind, s.mime_type, s.created_at,
            c.sequence, c.data_b64, c.byte_length
       FROM mcp_upload_sessions s
       LEFT JOIN mcp_upload_chunks c ON c.upload_id = s.upload_id
      WHERE s.upload_id = $1
      ORDER BY c.sequence ASC NULLS FIRST`,
    [uploadId],
  );

  if (rows.length === 0) {
    return {
      ok: false,
      error: toolErrorEnvelope(
        'SESSION_NOT_FOUND',
        `No upload session for upload_id=${uploadId}. Sessions are auto-deleted after finalize or after ${GC_HORIZON_MS / 60_000} minutes of inactivity.`,
        'start_upload',
      ),
    };
  }

  const session: SessionRow = {
    upload_id: rows[0].upload_id,
    kind: rows[0].kind,
    mime_type: rows[0].mime_type,
    created_at: rows[0].created_at,
  };

  if (session.kind !== expectedKind) {
    return {
      ok: false,
      error: toolErrorEnvelope(
        'KIND_MISMATCH',
        `Upload session kind is "${session.kind}" but you called finalize_${expectedKind}_photo. Use finalize_${session.kind}_photo instead.`,
        `finalize_${session.kind}_photo`,
      ),
    };
  }

  // LEFT JOIN gives us one row with NULL chunk fields when no chunks exist.
  const chunks: ChunkRow[] = rows
    .filter(r => r.sequence !== null)
    .map(r => ({
      sequence: r.sequence as number,
      data_b64: r.data_b64 as string,
      byte_length: r.byte_length as number,
    }));

  if (chunks.length === 0) {
    return {
      ok: false,
      error: toolErrorEnvelope(
        'EMPTY_UPLOAD',
        'No chunks were uploaded for this session. Call upload_chunk at least once before finalizing.',
        'upload_chunk',
      ),
    };
  }

  // Contiguity check: sequences must be exactly 0..N-1.
  const missing: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].sequence !== i) {
      // Walk forward to enumerate all gaps below the highest present seq.
      const present = new Set(chunks.map(c => c.sequence));
      const max = chunks[chunks.length - 1].sequence;
      for (let s = 0; s <= max; s++) {
        if (!present.has(s)) missing.push(s);
      }
      return {
        ok: false,
        error: toolErrorEnvelope(
          'MISSING_CHUNKS',
          `Chunk sequence is non-contiguous. Missing: [${missing.join(', ')}]. Re-send the missing chunks via upload_chunk, then call finalize again.`,
          'upload_chunk',
        ),
      };
    }
  }

  // Must join the b64 string first, THEN decode — chunks can split mid-
  // quartet and per-chunk decode would corrupt the assembly. Buffer.from
  // silently skips invalid chars rather than throwing, so the only
  // meaningful "decode failed" signal is an empty result buffer.
  const joined = chunks.map(c => c.data_b64).join('');
  const buffer = Buffer.from(joined, 'base64');
  if (buffer.length === 0) {
    return {
      ok: false,
      error: toolErrorEnvelope(
        'DECODE_FAILED',
        'Reassembled chunks decoded to an empty buffer. Check that each upload_chunk passed raw base64 (no data: URL prefix, no surrounding JSON).',
      ),
    };
  }

  return {
    ok: true,
    buffer,
    mime_type: session.mime_type ?? 'image/jpeg',
    session,
  };
}

function extForMime(mime: string): string {
  return MIME_TO_EXT[mime.toLowerCase()] ?? 'jpg';
}

/**
 * Lazy-load @vercel/blob so the SDK stays out of the cold-start path for
 * every other MCP tool call (read tools vastly outnumber finalize calls).
 */
async function putToBlob(
  pathname: string,
  body: Buffer,
  contentType: string,
): Promise<{ url: string }> {
  const { put } = await import('@vercel/blob');
  return put(pathname, body, { access: 'public', contentType });
}

/**
 * Explicit DELETE on finalize success — cascade clears chunks. Keeps the
 * staging tables holding only pending uploads. Best-effort; if it fails,
 * gcOrphans() will sweep the row within GC_HORIZON_MS.
 */
async function cleanupSession(uploadId: string): Promise<void> {
  try {
    await query(`DELETE FROM mcp_upload_sessions WHERE upload_id = $1`, [uploadId]);
  } catch {
    // Best-effort. The next gcOrphans() sweep will pick it up.
  }
}

// ── Tool: start_upload ────────────────────────────────────────────────────────

async function startUpload(args: Record<string, unknown>) {
  const kind = args.kind;
  if (typeof kind !== 'string' || !VALID_KINDS.includes(kind as UploadKind)) {
    return toolErrorEnvelope(
      'KIND_INVALID',
      `kind must be one of: ${VALID_KINDS.join(', ')}`,
    );
  }

  // Allowlist mime_type. If unset we default to image/jpeg at finalize.
  // Validating here means the contentType served back by Vercel Blob can
  // never be set to text/html or application/javascript by the caller —
  // a small defense even with a single trusted operator.
  let mimeType: string | null = null;
  if (typeof args.mime_type === 'string' && args.mime_type.length > 0) {
    const lowered = args.mime_type.toLowerCase();
    if (!(lowered in MIME_TO_EXT)) {
      return toolErrorEnvelope(
        'MIME_INVALID',
        `mime_type "${args.mime_type}" is not in the image allowlist. Accepted: ${Object.keys(MIME_TO_EXT).join(', ')}.`,
      );
    }
    mimeType = lowered;
  }

  // Fire GC opportunistically. Don't block on it.
  await gcOrphans();

  const uploadId = randomUUID();
  await query(
    `INSERT INTO mcp_upload_sessions (upload_id, kind, mime_type)
     VALUES ($1, $2, $3)`,
    [uploadId, kind, mimeType],
  );

  return toolResult({
    upload_id: uploadId,
    chunk_size_recommended: CHUNK_SIZE_RECOMMENDED,
    max_total_b64_chars: MAX_TOTAL_B64_CHARS,
    kind,
  });
}

// ── Tool: upload_chunk ────────────────────────────────────────────────────────

async function uploadChunk(args: Record<string, unknown>) {
  const uploadId = args.upload_id;
  const sequence = args.sequence;
  const dataB64 = args.data_b64;

  if (typeof uploadId !== 'string' || uploadId.length === 0) {
    return toolErrorEnvelope('INVALID_ARGS', 'upload_id is required (string)');
  }
  if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 0) {
    return toolErrorEnvelope('INVALID_ARGS', 'sequence must be a non-negative integer');
  }
  if (typeof dataB64 !== 'string' || dataB64.length === 0) {
    return toolErrorEnvelope('INVALID_ARGS', 'data_b64 must be a non-empty base64 string');
  }

  // Single-roundtrip insert + totals via CTEs. The FK constraint on
  // mcp_upload_chunks(upload_id) → mcp_upload_sessions(upload_id) makes
  // this throw 23503 if the session doesn't exist; we translate to
  // SESSION_NOT_FOUND below. ON CONFLICT makes re-sends idempotent.
  //
  // The trailing SELECT reads from a snapshot taken before `ins` ran, so
  // it would otherwise miss the just-inserted row. We compute totals by
  // unioning the snapshot (excluding this sequence to avoid double-count
  // on overwrite) with the RETURNING from `ins` itself.
  let totals: { total: string; chunks: string } | null;
  try {
    totals = await queryOne<{ total: string; chunks: string }>(
      `WITH ins AS (
         INSERT INTO mcp_upload_chunks (upload_id, sequence, data_b64, byte_length)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (upload_id, sequence)
         DO UPDATE SET data_b64 = EXCLUDED.data_b64, byte_length = EXCLUDED.byte_length
         RETURNING sequence, byte_length
       )
       SELECT
         (COALESCE((SELECT SUM(byte_length) FROM mcp_upload_chunks
                     WHERE upload_id = $1 AND sequence != $2), 0)
          + (SELECT byte_length FROM ins))::TEXT AS total,
         ((SELECT COUNT(*) FROM mcp_upload_chunks
            WHERE upload_id = $1 AND sequence != $2)
          + (SELECT COUNT(*) FROM ins))::TEXT AS chunks
       FROM ins`,
      [uploadId, sequence, dataB64, dataB64.length],
    );
  } catch (e) {
    // Postgres 23503 = foreign_key_violation → session row doesn't exist.
    const msg = e instanceof Error ? e.message : String(e);
    if (/23503|foreign key|violates foreign/i.test(msg)) {
      return toolErrorEnvelope(
        'SESSION_NOT_FOUND',
        `No upload session for upload_id=${uploadId}. Call start_upload first.`,
        'start_upload',
      );
    }
    throw e;
  }
  const totalChars = Number(totals?.total ?? 0);
  const chunkCount = Number(totals?.chunks ?? 0);

  if (totalChars > MAX_TOTAL_B64_CHARS) {
    return toolErrorEnvelope(
      'SIZE_CAP_EXCEEDED',
      `Cumulative upload size ${totalChars} chars exceeds cap of ${MAX_TOTAL_B64_CHARS}. The session has been kept (will be auto-GCed in ${GC_HORIZON_MS / 60_000} min). Re-compress and start a new upload with start_upload.`,
      'start_upload',
    );
  }

  return toolResult({
    ok: true,
    chunks_received: chunkCount,
    bytes_so_far: totalChars,
  });
}

// ── Finalize helpers (one per kind) ───────────────────────────────────────────

function pathnameFor(kind: UploadKind, pose: string | null, ext: string): string {
  const base = randomUUID();
  if (kind === 'progress') return `progress-photos/${base}-${pose}.${ext}`;
  if (kind === 'projection') return `projection-photos/${base}-${pose}.${ext}`;
  // inspo: pose is optional, omit from pathname when absent
  return pose ? `inspo-photos/${base}-${pose}.${ext}` : `inspo-photos/${base}.${ext}`;
}

/**
 * Common finalize flow:
 *   1. loadAndAssemble (validates session, contiguity, decode)
 *   2. put() to Vercel Blob
 *   3. dbCreate*Photo
 *   4. cleanupSession
 *
 * The kind-specific tool wrappers handle pose validation and pass the
 * correct dbCreate fn + extra metadata.
 */

async function finalizeProgressPhoto(args: Record<string, unknown>) {
  const uploadId = args.upload_id;
  if (typeof uploadId !== 'string' || uploadId.length === 0) {
    return toolErrorEnvelope('INVALID_ARGS', 'upload_id is required (string)');
  }
  const pose = args.pose;
  if (!isPose(pose)) {
    return toolErrorEnvelope(
      'POSE_REQUIRED',
      `pose must be one of: ${ALL_POSES.join(', ')}`,
    );
  }

  const assembled = await loadAndAssemble(uploadId, 'progress');
  if (!assembled.ok) return assembled.error;

  const ext = extForMime(assembled.mime_type);
  const pathname = pathnameFor('progress', pose, ext);
  const blob = await putToBlob(pathname, assembled.buffer, assembled.mime_type);

  const photo = await createProgressPhoto({
    blob_url: blob.url,
    pose,
    notes: typeof args.notes === 'string' ? args.notes : null,
    taken_at: typeof args.taken_at === 'string' ? args.taken_at : undefined,
  });

  await cleanupSession(uploadId);
  return toolResult(photo);
}

async function finalizeInspoPhoto(args: Record<string, unknown>) {
  const uploadId = args.upload_id;
  if (typeof uploadId !== 'string' || uploadId.length === 0) {
    return toolErrorEnvelope('INVALID_ARGS', 'upload_id is required (string)');
  }

  // pose is optional on inspo. Validate only if present.
  let pose: ProgressPhotoPose | null = null;
  if (typeof args.pose === 'string') {
    if (!isPose(args.pose)) {
      return toolErrorEnvelope(
        'POSE_INVALID',
        `If passed, pose must be one of: ${ALL_POSES.join(', ')}`,
      );
    }
    pose = args.pose;
  }

  const assembled = await loadAndAssemble(uploadId, 'inspo');
  if (!assembled.ok) return assembled.error;

  const ext = extForMime(assembled.mime_type);
  const pathname = pathnameFor('inspo', pose, ext);
  const blob = await putToBlob(pathname, assembled.buffer, assembled.mime_type);

  const photo = await createInspoPhoto({
    blob_url: blob.url,
    notes: typeof args.notes === 'string' ? args.notes : null,
    taken_at: typeof args.taken_at === 'string' ? args.taken_at : undefined,
    burst_group_id:
      typeof args.burst_group_id === 'string' ? args.burst_group_id : null,
    pose,
  });

  await cleanupSession(uploadId);
  return toolResult(photo);
}

async function finalizeProjectionPhoto(args: Record<string, unknown>) {
  const uploadId = args.upload_id;
  if (typeof uploadId !== 'string' || uploadId.length === 0) {
    return toolErrorEnvelope('INVALID_ARGS', 'upload_id is required (string)');
  }
  const pose = args.pose;
  if (!isPose(pose)) {
    return toolErrorEnvelope(
      'POSE_REQUIRED',
      `pose must be one of: ${ALL_POSES.join(', ')}`,
    );
  }

  const assembled = await loadAndAssemble(uploadId, 'projection');
  if (!assembled.ok) return assembled.error;

  const ext = extForMime(assembled.mime_type);
  const pathname = pathnameFor('projection', pose, ext);
  const blob = await putToBlob(pathname, assembled.buffer, assembled.mime_type);

  const photo = await createProjectionPhoto({
    blob_url: blob.url,
    pose,
    notes: typeof args.notes === 'string' ? args.notes : null,
    taken_at: typeof args.taken_at === 'string' ? args.taken_at : undefined,
    source_progress_photo_uuid:
      typeof args.source_progress_photo_uuid === 'string'
        ? args.source_progress_photo_uuid
        : null,
    target_horizon:
      typeof args.target_horizon === 'string' ? args.target_horizon : null,
  });

  await cleanupSession(uploadId);
  return toolResult(photo);
}

// ── Tool registrations ────────────────────────────────────────────────────────

export const uploadChunkedTools: MCPTool[] = [
  {
    name: 'start_upload',
    description:
      'Open a chunked-upload session for an image that exceeds the Claude mobile MCP client\'s ~64k-char inline-arg limit. Returns { upload_id, chunk_size_recommended, max_total_b64_chars }. Use ~30k-char base64 chunks via upload_chunk, then call finalize_<kind>_photo. Sessions auto-GC after 1h of inactivity.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: VALID_KINDS as unknown as string[],
          description: 'Which photo kind this upload will finalize as.',
        },
        mime_type: {
          type: 'string',
          description: 'Optional MIME type override (e.g. image/png). Defaults to image/jpeg at finalize.',
        },
      },
      required: ['kind'],
    },
    execute: startUpload,
  },
  {
    name: 'upload_chunk',
    description:
      'Append one base64 chunk to an upload session. Sequences are 0-indexed and must be contiguous at finalize time, but order of arrival does not matter (re-sending the same sequence with different data overwrites — idempotent on retry). Cumulative cap is 33M base64 chars (~25MB binary).',
    inputSchema: {
      type: 'object',
      properties: {
        upload_id: { type: 'string', description: 'From start_upload.' },
        sequence: { type: 'number', description: '0-indexed chunk position.' },
        data_b64: {
          type: 'string',
          description: 'Raw base64 (no data: URL prefix). ~30k chars per chunk recommended.',
        },
      },
      required: ['upload_id', 'sequence', 'data_b64'],
    },
    execute: uploadChunk,
  },
  {
    name: 'finalize_progress_photo',
    description:
      'Reassemble chunks for a kind=progress upload, push to Vercel Blob, and create the progress_photos row. Returns the created row. Cleans up the session + chunks on success. pose is required.',
    inputSchema: {
      type: 'object',
      properties: {
        upload_id: { type: 'string' },
        pose: { type: 'string', enum: ALL_POSES, description: 'Required pose tag.' },
        notes: { type: 'string' },
        taken_at: { type: 'string', description: 'ISO timestamp; defaults to now.' },
      },
      required: ['upload_id', 'pose'],
    },
    execute: finalizeProgressPhoto,
  },
  {
    name: 'finalize_inspo_photo',
    description:
      'Reassemble chunks for a kind=inspo upload, push to Vercel Blob, and create the inspo_photos row. Returns the created row. pose is optional (mirrors progress_photos pose tags so the compare viewer can mix them); burst_group_id is optional.',
    inputSchema: {
      type: 'object',
      properties: {
        upload_id: { type: 'string' },
        pose: { type: 'string', enum: ALL_POSES },
        notes: { type: 'string' },
        taken_at: { type: 'string' },
        burst_group_id: { type: 'string' },
      },
      required: ['upload_id'],
    },
    execute: finalizeInspoPhoto,
  },
  {
    name: 'finalize_projection_photo',
    description:
      'Reassemble chunks for a kind=projection upload, push to Vercel Blob, and create the projection_photos row. Returns the created row. pose is required. Optional source_progress_photo_uuid links the projection to the photo it was generated from. Optional target_horizon is a label like "3mo" / "6mo" / "12mo".',
    inputSchema: {
      type: 'object',
      properties: {
        upload_id: { type: 'string' },
        pose: { type: 'string', enum: ALL_POSES, description: 'Required pose tag.' },
        notes: { type: 'string' },
        taken_at: { type: 'string' },
        source_progress_photo_uuid: { type: 'string' },
        target_horizon: { type: 'string' },
      },
      required: ['upload_id', 'pose'],
    },
    execute: finalizeProjectionPhoto,
  },
];

// ── Test-only exports ─────────────────────────────────────────────────────────
//
// These constants are exposed for tests so they can fabricate at-cap inputs
// without hardcoding magic numbers. Not part of the public API.
export const __test = {
  CHUNK_SIZE_RECOMMENDED,
  MAX_TOTAL_B64_CHARS,
  GC_HORIZON_MS,
};
