/**
 * Tests for src/lib/mcp/upload-tools.ts — the chunked-upload protocol.
 *
 * The DB is mocked with a small in-memory model that recognises the SQL
 * prefixes the SUT issues. Vercel Blob's `put` and the dbCreate*Photo helpers
 * are mocked so the tests stay hermetic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory DB state ───────────────────────────────────────────────────────

interface SessionRow {
  upload_id: string;
  kind: 'progress' | 'projection' | 'inspo';
  mime_type: string | null;
  created_at: string;
}

interface ChunkRow {
  sequence: number;
  data_b64: string;
  byte_length: number;
}

const sessions = new Map<string, SessionRow>();
const chunks = new Map<string, ChunkRow[]>();

// ── DB mock ──────────────────────────────────────────────────────────────────

const queryMock = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();

  // GC sweep — DELETE all sessions older than cutoff. cleanupSession is
  // already responsible for removing finalized sessions, so the GC sweep
  // only catches abandoned ones.
  if (
    s.startsWith('DELETE FROM mcp_upload_sessions WHERE created_at') ||
    (s.startsWith('DELETE FROM mcp_upload_sessions') && s.includes('finalized_at IS NULL'))
  ) {
    const cutoff = params[0] as string;
    for (const [id, sess] of sessions) {
      if (sess.created_at < cutoff) {
        sessions.delete(id);
        chunks.delete(id);
      }
    }
    return [];
  }

  // INSERT session
  if (s.startsWith('INSERT INTO mcp_upload_sessions')) {
    const [upload_id, kind, mime_type] = params as [string, SessionRow['kind'], string | null];
    sessions.set(upload_id, {
      upload_id,
      kind,
      mime_type,
      created_at: new Date().toISOString(),
    });
    return [];
  }

  // upload_chunk: combined CTE (INSERT chunk + SELECT totals).
  // The SUT calls this as `WITH ins AS (INSERT ...) SELECT total, chunks FROM ins`.
  // We model FK enforcement by throwing if the session doesn't exist.
  if (s.startsWith('WITH ins AS') && s.includes('INSERT INTO mcp_upload_chunks')) {
    const [upload_id, sequence, data_b64, byte_length] = params as [string, number, string, number];
    if (!sessions.has(upload_id)) {
      const err = new Error(
        `insert or update on table "mcp_upload_chunks" violates foreign key constraint (Postgres code 23503)`,
      );
      throw err;
    }
    const arr = chunks.get(upload_id) ?? [];
    const idx = arr.findIndex(c => c.sequence === sequence);
    if (idx >= 0) {
      arr[idx] = { sequence, data_b64, byte_length };
    } else {
      arr.push({ sequence, data_b64, byte_length });
    }
    chunks.set(upload_id, arr);
    const total = arr.reduce((a, c) => a + c.byte_length, 0);
    return [{ total: String(total), chunks: String(arr.length) }];
  }

  // loadAndAssemble: LEFT JOIN session+chunks in one shot.
  if (s.startsWith('SELECT s.upload_id, s.kind, s.mime_type')) {
    const [upload_id] = params as [string];
    const sess = sessions.get(upload_id);
    if (!sess) return [];
    const arr = (chunks.get(upload_id) ?? []).slice().sort((a, b) => a.sequence - b.sequence);
    if (arr.length === 0) {
      return [{ ...sess, sequence: null, data_b64: null, byte_length: null }];
    }
    return arr.map(c => ({ ...sess, sequence: c.sequence, data_b64: c.data_b64, byte_length: c.byte_length }));
  }

  // SELECT session (still used by getSession helper if anyone else calls it)
  if (s.startsWith('SELECT upload_id, kind, mime_type')) {
    const [upload_id] = params as [string];
    const sess = sessions.get(upload_id);
    return sess ? [sess] : [];
  }

  // DELETE session by id (cleanup after finalize)
  if (s.startsWith('DELETE FROM mcp_upload_sessions WHERE upload_id')) {
    const [upload_id] = params as [string];
    sessions.delete(upload_id);
    chunks.delete(upload_id);
    return [];
  }

  throw new Error(`Unhandled SQL in mock: ${s}`);
});

const queryOneMock = vi.fn(async (sql: string, params: unknown[] = []) => {
  const rows = await queryMock(sql, params);
  return rows.length > 0 ? rows[0] : null;
});

vi.mock('@/db/db', () => ({
  query: (...args: unknown[]) => queryMock(args[0] as string, args[1] as unknown[] | undefined),
  queryOne: (...args: unknown[]) => queryOneMock(args[0] as string, args[1] as unknown[] | undefined),
}));

// ── Vercel Blob mock ─────────────────────────────────────────────────────────

const putMock = vi.fn(async (pathname: string, _body: Buffer, _opts: unknown) => ({
  url: `https://blob.example.com/${pathname}`,
  pathname,
}));
const delMock = vi.fn(async (_url: string) => undefined);

vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => putMock(args[0] as string, args[1] as Buffer, args[2]),
  del: (...args: unknown[]) => delMock(args[0] as string),
}));

// ── DB create helpers mock ───────────────────────────────────────────────────

const createProgressPhotoMock = vi.fn(async (data: Record<string, unknown>) => ({
  uuid: 'progress-uuid-1',
  ...data,
}));
const createInspoPhotoMock = vi.fn(async (data: Record<string, unknown>) => ({
  uuid: 'inspo-uuid-1',
  ...data,
}));
const createProjectionPhotoMock = vi.fn(async (data: Record<string, unknown>) => ({
  uuid: 'projection-uuid-1',
  ...data,
}));

vi.mock('@/db/queries', () => ({
  createProgressPhoto: (data: Record<string, unknown>) => createProgressPhotoMock(data),
  createInspoPhoto: (data: Record<string, unknown>) => createInspoPhotoMock(data),
  createProjectionPhoto: (data: Record<string, unknown>) => createProjectionPhotoMock(data),
}));

// SUT — must be imported AFTER vi.mock calls.
import { uploadChunkedTools, __test } from './upload-tools';

// ── Test helpers ─────────────────────────────────────────────────────────────

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

function tool(name: string) {
  const t = uploadChunkedTools.find(x => x.name === name);
  if (!t) throw new Error(`Unknown tool: ${name}`);
  return t;
}

function parse(result: ToolResult) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await tool(name).execute(args)) as ToolResult;
}

beforeEach(() => {
  sessions.clear();
  chunks.clear();
  queryMock.mockClear();
  queryOneMock.mockClear();
  putMock.mockClear();
  delMock.mockClear();
  createProgressPhotoMock.mockClear();
  createInspoPhotoMock.mockClear();
  createProjectionPhotoMock.mockClear();
});

// ── start_upload ─────────────────────────────────────────────────────────────

describe('start_upload', () => {
  it('S1: returns upload_id + chunk_size_recommended for valid kind', async () => {
    const r = await call('start_upload', { kind: 'projection' });
    expect(r.isError).toBeUndefined();
    const body = parse(r);
    expect(typeof body.upload_id).toBe('string');
    expect(body.chunk_size_recommended).toBe(__test.CHUNK_SIZE_RECOMMENDED);
    expect(body.max_total_b64_chars).toBe(__test.MAX_TOTAL_B64_CHARS);
    expect(body.kind).toBe('projection');
    expect(sessions.size).toBe(1);
  });

  it('S2: rejects invalid kind with KIND_INVALID', async () => {
    const r = await call('start_upload', { kind: 'workout' });
    expect(r.isError).toBe(true);
    const body = parse(r);
    expect((body.error as { code: string }).code).toBe('KIND_INVALID');
  });

  it('S3: GC deletes orphan sessions older than horizon on next start_upload', async () => {
    // Manually insert an old orphan (well past the 24h horizon).
    const orphanId = '11111111-1111-4111-8111-111111111111';
    const ancientTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    sessions.set(orphanId, {
      upload_id: orphanId,
      kind: 'progress',
      mime_type: null,
      created_at: ancientTs,
    });
    chunks.set(orphanId, [{ sequence: 0, data_b64: 'aGVsbG8=', byte_length: 8 }]);
    expect(sessions.has(orphanId)).toBe(true);

    await call('start_upload', { kind: 'progress' });

    expect(sessions.has(orphanId)).toBe(false);
    expect(chunks.has(orphanId)).toBe(false);
  });

  it('S4: GC does NOT delete fresh orphans (within horizon)', async () => {
    const freshId = '22222222-2222-4222-8222-222222222222';
    sessions.set(freshId, {
      upload_id: freshId,
      kind: 'progress',
      mime_type: null,
      created_at: new Date().toISOString(),
    });
    await call('start_upload', { kind: 'progress' });
    expect(sessions.has(freshId)).toBe(true);
  });

  it('S5: rejects invalid mime_type with MIME_INVALID', async () => {
    const r = await call('start_upload', { kind: 'projection', mime_type: 'text/html' });
    expect(r.isError).toBe(true);
    const body = parse(r);
    expect((body.error as { code: string }).code).toBe('MIME_INVALID');
  });

  it('S6: accepts uppercase mime_type and lowercases it', async () => {
    const r = await call('start_upload', { kind: 'inspo', mime_type: 'IMAGE/PNG' });
    expect(r.isError).toBeUndefined();
    const id = parse(r).upload_id as string;
    await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: 'aGk=' });
    await call('finalize_inspo_photo', { upload_id: id });
    const [pathname, , opts] = putMock.mock.calls[0];
    expect(pathname).toMatch(/\.png$/);
    expect((opts as { contentType: string }).contentType).toBe('image/png');
  });
});

// ── upload_chunk ─────────────────────────────────────────────────────────────

describe('upload_chunk', () => {
  async function startProjection(): Promise<string> {
    const r = await call('start_upload', { kind: 'projection' });
    return parse(r).upload_id as string;
  }

  it('UC1: writes a new chunk and reports running total', async () => {
    const id = await startProjection();
    const r = await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: 'aGVsbG8=' });
    expect(r.isError).toBeUndefined();
    const body = parse(r);
    expect(body.ok).toBe(true);
    expect(body.chunks_received).toBe(1);
    expect(body.bytes_so_far).toBe(8);
    expect(chunks.get(id)?.length).toBe(1);
  });

  it('UC2: re-sending same sequence overwrites (idempotent)', async () => {
    const id = await startProjection();
    await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: 'first' });
    const r = await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: 'second!' });
    expect(r.isError).toBeUndefined();
    const arr = chunks.get(id)!;
    expect(arr.length).toBe(1);
    expect(arr[0].data_b64).toBe('second!');
    expect(arr[0].byte_length).toBe(7);
  });

  it('UC3: cumulative > MAX_TOTAL_B64_CHARS → SIZE_CAP_EXCEEDED', async () => {
    const id = await startProjection();
    // Two chunks each just over half the cap → second push trips it.
    const halfPlus = 'x'.repeat(Math.floor(__test.MAX_TOTAL_B64_CHARS / 2) + 1);
    await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: halfPlus });
    const r = await call('upload_chunk', { upload_id: id, sequence: 1, data_b64: halfPlus });
    expect(r.isError).toBe(true);
    const body = parse(r);
    expect((body.error as { code: string }).code).toBe('SIZE_CAP_EXCEEDED');
  });

  it('UC4: well-formed but unknown upload_id → SESSION_NOT_FOUND (FK path)', async () => {
    // Valid UUID shape passes the pre-validate, hits the CTE,
    // FK violation translates to SESSION_NOT_FOUND.
    const r = await call('upload_chunk', {
      upload_id: '00000000-0000-4000-8000-000000000000',
      sequence: 0,
      data_b64: 'aGk=',
    });
    expect(r.isError).toBe(true);
    expect((parse(r).error as { code: string }).code).toBe('SESSION_NOT_FOUND');
  });

  it('UC5: missing or malformed args → INVALID_ARGS', async () => {
    // Need a real session so we get past UUID pre-validate to the
    // sequence/data checks.
    const id = (parse(await call('start_upload', { kind: 'projection' })).upload_id) as string;
    const r1 = await call('upload_chunk', { sequence: 0, data_b64: 'aGk=' });
    expect((parse(r1).error as { code: string }).code).toBe('INVALID_ARGS');
    const r2 = await call('upload_chunk', { upload_id: id, sequence: -1, data_b64: 'aGk=' });
    expect((parse(r2).error as { code: string }).code).toBe('INVALID_ARGS');
    const r3 = await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: '' });
    expect((parse(r3).error as { code: string }).code).toBe('INVALID_ARGS');
  });
});

// ── finalize_progress_photo ──────────────────────────────────────────────────

describe('finalize_progress_photo', () => {
  it('FP1: happy path → put + createProgressPhoto + cleanup', async () => {
    const id = (parse(await call('start_upload', { kind: 'progress' })).upload_id) as string;
    const sourceBytes = Buffer.from('the quick brown fox jumps over the lazy dog');
    const b64 = sourceBytes.toString('base64');
    const half = Math.floor(b64.length / 2);
    await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: b64.slice(0, half) });
    await call('upload_chunk', { upload_id: id, sequence: 1, data_b64: b64.slice(half) });

    const r = await call('finalize_progress_photo', {
      upload_id: id,
      pose: 'front',
      notes: 'leg day',
    });
    expect(r.isError).toBeUndefined();

    expect(putMock).toHaveBeenCalledTimes(1);
    const [pathname, putBody] = putMock.mock.calls[0];
    expect(pathname).toMatch(/^progress-photos\/.+-front\.jpg$/);
    // Reassembled buffer must round-trip to the source bytes.
    expect(Buffer.compare(putBody as Buffer, sourceBytes)).toBe(0);

    expect(createProgressPhotoMock).toHaveBeenCalledTimes(1);
    const [createArg] = createProgressPhotoMock.mock.calls[0];
    expect(createArg.pose).toBe('front');
    expect(createArg.notes).toBe('leg day');
    expect((createArg.blob_url as string).startsWith('https://blob.example.com/')).toBe(true);

    // Session + chunks cleaned up
    expect(sessions.has(id)).toBe(false);
    expect(chunks.has(id)).toBe(false);
  });

  it('FP2: missing pose → POSE_REQUIRED', async () => {
    const id = (parse(await call('start_upload', { kind: 'progress' })).upload_id) as string;
    await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: 'aGVsbG8=' });
    const r = await call('finalize_progress_photo', { upload_id: id });
    expect(r.isError).toBe(true);
    expect((parse(r).error as { code: string }).code).toBe('POSE_REQUIRED');
    expect(putMock).not.toHaveBeenCalled();
  });

  it('FP3: kind mismatch → KIND_MISMATCH', async () => {
    const id = (parse(await call('start_upload', { kind: 'projection' })).upload_id) as string;
    await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: 'aGVsbG8=' });
    const r = await call('finalize_progress_photo', { upload_id: id, pose: 'front' });
    expect(r.isError).toBe(true);
    const body = parse(r);
    expect((body.error as { code: string; hint: string }).code).toBe('KIND_MISMATCH');
    expect((body.error as { hint: string }).hint).toBe('finalize_projection_photo');
    expect(putMock).not.toHaveBeenCalled();
  });
});

// ── finalize_inspo_photo ─────────────────────────────────────────────────────

describe('finalize_inspo_photo', () => {
  it('FI1: happy path with burst_group_id passthrough', async () => {
    const id = (parse(await call('start_upload', { kind: 'inspo', mime_type: 'image/png' }))
      .upload_id) as string;
    const b64 = Buffer.from('inspo bytes').toString('base64');
    await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: b64 });

    const r = await call('finalize_inspo_photo', {
      upload_id: id,
      pose: 'front',
      burst_group_id: 'burst-7',
    });
    expect(r.isError).toBeUndefined();

    const [pathname, , opts] = putMock.mock.calls[0];
    expect(pathname).toMatch(/^inspo-photos\/.+-front\.png$/);
    expect((opts as { contentType: string }).contentType).toBe('image/png');

    const [createArg] = createInspoPhotoMock.mock.calls[0];
    expect(createArg.burst_group_id).toBe('burst-7');
    expect(createArg.pose).toBe('front');
  });

  it('FI2: pose omitted → no pose suffix in pathname, pose=null in row', async () => {
    const id = (parse(await call('start_upload', { kind: 'inspo' })).upload_id) as string;
    await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: 'aGk=' });
    await call('finalize_inspo_photo', { upload_id: id });
    const [pathname] = putMock.mock.calls[0];
    expect(pathname).toMatch(/^inspo-photos\/[^/]+\.jpg$/);
    expect(pathname).not.toMatch(/-front|-back|-side/);
    expect(createInspoPhotoMock.mock.calls[0][0].pose).toBeNull();
  });
});

// ── finalize_projection_photo ────────────────────────────────────────────────

describe('finalize_projection_photo', () => {
  it('FJ1: happy path with source_progress_photo_uuid + target_horizon', async () => {
    const id = (parse(await call('start_upload', { kind: 'projection' })).upload_id) as string;
    await call('upload_chunk', {
      upload_id: id,
      sequence: 0,
      data_b64: Buffer.from('projection bytes').toString('base64'),
    });

    const r = await call('finalize_projection_photo', {
      upload_id: id,
      pose: 'back',
      source_progress_photo_uuid: 'src-uuid',
      target_horizon: '12mo',
    });
    expect(r.isError).toBeUndefined();
    const [createArg] = createProjectionPhotoMock.mock.calls[0];
    expect(createArg.pose).toBe('back');
    expect(createArg.source_progress_photo_uuid).toBe('src-uuid');
    expect(createArg.target_horizon).toBe('12mo');
  });
});

// ── Cross-cutting failure modes ──────────────────────────────────────────────

describe('finalize — failure modes', () => {
  it('FX1: zero chunks → EMPTY_UPLOAD', async () => {
    const id = (parse(await call('start_upload', { kind: 'projection' })).upload_id) as string;
    const r = await call('finalize_projection_photo', { upload_id: id, pose: 'front' });
    expect((parse(r).error as { code: string }).code).toBe('EMPTY_UPLOAD');
    expect(putMock).not.toHaveBeenCalled();
  });

  it('FX2: missing sequence in middle → MISSING_CHUNKS lists the gap', async () => {
    const id = (parse(await call('start_upload', { kind: 'projection' })).upload_id) as string;
    await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: 'aGk=' });
    // Skip seq 1
    await call('upload_chunk', { upload_id: id, sequence: 2, data_b64: 'aGk=' });
    const r = await call('finalize_projection_photo', { upload_id: id, pose: 'front' });
    const body = parse(r);
    expect((body.error as { code: string }).code).toBe('MISSING_CHUNKS');
    expect((body.error as { message: string }).message).toMatch(/\[1\]/);
    expect(putMock).not.toHaveBeenCalled();
  });

  it('FX3: re-finalize same upload_id → SESSION_NOT_FOUND on second call', async () => {
    const id = (parse(await call('start_upload', { kind: 'projection' })).upload_id) as string;
    await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: 'aGk=' });
    const first = await call('finalize_projection_photo', { upload_id: id, pose: 'front' });
    expect(first.isError).toBeUndefined();
    const second = await call('finalize_projection_photo', { upload_id: id, pose: 'front' });
    expect((parse(second).error as { code: string }).code).toBe('SESSION_NOT_FOUND');
  });

  it('FX4: corrupt base64 (zero-byte decode) → DECODE_FAILED', async () => {
    const id = (parse(await call('start_upload', { kind: 'projection' })).upload_id) as string;
    // '!' is outside the base64 alphabet — Buffer.from(.., 'base64') decodes
    // to an empty buffer rather than throwing.
    await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: '!!!!' });
    const r = await call('finalize_projection_photo', { upload_id: id, pose: 'front' });
    expect((parse(r).error as { code: string }).code).toBe('DECODE_FAILED');
    expect(putMock).not.toHaveBeenCalled();
  });

  it('FX5: SESSION_NOT_FOUND on bogus upload_id', async () => {
    const r = await call('finalize_projection_photo', {
      upload_id: '00000000-0000-4000-8000-000000000000',
      pose: 'front',
    });
    expect((parse(r).error as { code: string }).code).toBe('SESSION_NOT_FOUND');
  });
});

// ── Adversarial-review hardening ─────────────────────────────────────────────

describe('hardening (adversarial review)', () => {
  it('UC6: sequence > MAX_CHUNK_SEQUENCE → INVALID_ARGS (DoS guard)', async () => {
    const id = (parse(await call('start_upload', { kind: 'projection' })).upload_id) as string;
    const r = await call('upload_chunk', {
      upload_id: id,
      sequence: 2_147_483_647,
      data_b64: 'aGk=',
    });
    expect(r.isError).toBe(true);
    expect((parse(r).error as { code: string }).code).toBe('INVALID_ARGS');
  });

  it('UC7: non-UUID upload_id → SESSION_NOT_FOUND without hitting Postgres', async () => {
    const r = await call('upload_chunk', {
      upload_id: 'not-a-uuid',
      sequence: 0,
      data_b64: 'aGk=',
    });
    expect(r.isError).toBe(true);
    expect((parse(r).error as { code: string }).code).toBe('SESSION_NOT_FOUND');
    // Mock would throw "Unhandled SQL" if we'd reached the CTE.
  });

  it('FX9: finalize re-checks the cap (caller bypassed upload_chunk error)', async () => {
    const id = (parse(await call('start_upload', { kind: 'projection' })).upload_id) as string;
    // Manually stuff over-cap chunks into the staging map (simulating a
    // caller that ignored SIZE_CAP_EXCEEDED and wrote them out-of-band).
    const half = Math.floor(__test.MAX_TOTAL_B64_CHARS / 2) + 1;
    chunks.set(id, [
      { sequence: 0, data_b64: 'x'.repeat(half), byte_length: half },
      { sequence: 1, data_b64: 'x'.repeat(half), byte_length: half },
    ]);
    const r = await call('finalize_projection_photo', { upload_id: id, pose: 'front' });
    expect(r.isError).toBe(true);
    expect((parse(r).error as { code: string }).code).toBe('SIZE_CAP_EXCEEDED');
    expect(putMock).not.toHaveBeenCalled();
  });

  it('FX10: orphan blob is deleted when createPhoto throws after blob upload', async () => {
    const id = (parse(await call('start_upload', { kind: 'projection' })).upload_id) as string;
    await call('upload_chunk', { upload_id: id, sequence: 0, data_b64: 'aGk=' });
    createProjectionPhotoMock.mockRejectedValueOnce(new Error('Postgres timeout'));
    let threw = false;
    try {
      await call('finalize_projection_photo', { upload_id: id, pose: 'front' });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(delMock).toHaveBeenCalledTimes(1);
    expect(delMock.mock.calls[0][0]).toMatch(/^https:\/\/blob\.example\.com\/projection-photos\//);
  });
});

// ── Tool-registration regression ─────────────────────────────────────────────
//
// The chunked tools and the existing inlined tools must coexist. These tests
// assert the registry contains both surfaces with the expected names, so a
// rename or accidental delete would fail loudly.

describe('tool registration', () => {
  it('REG1: chunked-upload tools are exported with the expected names', () => {
    const names = uploadChunkedTools.map(t => t.name).sort();
    expect(names).toEqual([
      'finalize_inspo_photo',
      'finalize_progress_photo',
      'finalize_projection_photo',
      'start_upload',
      'upload_chunk',
    ]);
  });

  it('REG2: existing inlined upload tools still exist in the master registry', async () => {
    const { tools } = await import('@/lib/mcp-tools');
    const names = new Set(tools.map(t => t.name));
    expect(names.has('upload_progress_photo')).toBe(true);
    expect(names.has('upload_inspo_photo')).toBe(true);
    expect(names.has('upload_projection_photo')).toBe(true);
    // And the new ones got wired in too:
    expect(names.has('start_upload')).toBe(true);
    expect(names.has('upload_chunk')).toBe(true);
    expect(names.has('finalize_progress_photo')).toBe(true);
    expect(names.has('finalize_inspo_photo')).toBe(true);
    expect(names.has('finalize_projection_photo')).toBe(true);
  });

  it('REG3: existing tool descriptions point Claude clients at the chunked path', async () => {
    const { tools } = await import('@/lib/mcp-tools');
    const upProg = tools.find(t => t.name === 'upload_progress_photo')!;
    const upInsp = tools.find(t => t.name === 'upload_inspo_photo')!;
    const upProj = tools.find(t => t.name === 'upload_projection_photo')!;
    expect(upProg.description).toMatch(/start_upload kind=progress/);
    expect(upInsp.description).toMatch(/start_upload kind=inspo/);
    expect(upProj.description).toMatch(/start_upload kind=projection/);
  });
});
