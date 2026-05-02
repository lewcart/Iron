import { NextRequest, NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import sharp from 'sharp';
import { getExercise } from '@/db/queries';
import { query, transaction } from '@/db/db';
import { requireApiKey } from '@/lib/api-auth';
import {
  buildExerciseImagePromptFrame1,
  buildExerciseImagePromptFrame2,
} from '@/lib/exercise-image-prompt';
import {
  resizeToDisplayJpeg,
  wrapPngForEdit,
} from '@/lib/exercise-image-pipeline';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/exercises/[uuid]/generate-images
//
// Generates a new candidate pair for an exercise.
//
// Body shape — two paths:
//   • application/json
//       { request_id?: uuid, notes?: string }
//   • multipart/form-data
//       request_id?: uuid (string field)
//       notes?:      string (≤280 chars, server-validated)
//       reference?:  File (PNG/JPEG/WebP, ≤8MB)
//
// Generation flow:
//   1. Frame 1 — openai.images.generate, OR images.edit with the user's
//      reference image as the seed (when uploaded). 1024×1536.        ~$0.20
//   2. Frame 2 — openai.images.edit({ image: frame1Png }) chained off
//      frame 1. 1024×1536.                                            ~$0.20
//   3. Resize each to 600×800 JPEG, upload to Vercel Blob.
//   4. INSERT 2 candidate rows + activate batch + mirror to exercises.
//
// Atomicity: pair is the unit. If frame 2 fails, frame 1 blob is deleted
// best-effort (no candidate rows persisted). The user's reference blob is
// PRESERVED on rollback — it's a source artifact, not part of the candidate
// pair, and retries can re-use it without re-uploading.
//
// Auth: requireApiKey (single-user; bounds external abuse on a paid API).
// maxDuration: 300s. Two sequential gpt-image-1 calls + uploads + DB budget
// 90-180s observed. Requires Vercel Pro+ tier.

export const maxDuration = 300;

interface ParsedBody {
  request_id?: string;
  notes?: string;
  /** When present, the route uses images.edit() for frame 1 with this PNG as
   *  the seed. Already resized to 600×800 PNG; ready to wrap via toFile. */
  referencePng?: Buffer;
  /** Mime detected on the original upload, before resize (used for the
   *  blob filename extension). Resized output is always image/png. */
  referenceOriginalMime?: 'image/png' | 'image/jpeg' | 'image/webp';
}

const NOTES_MAX_CHARS = 280;
const REF_MAX_BYTES = 8 * 1024 * 1024;
const REF_ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

// Cost estimates in cents (US). gpt-image-1 high 1024×1536 ≈ $0.25 per output.
// Plus a small input-image-token charge on the edit call. Used for the
// cumulative-cost footer in the manager UI. If you change these, also update
// COST_CTA_LABEL in src/components/ExerciseImageManager.tsx.
const COST_FRAME1_CENTS = 25;
const COST_FRAME2_CENTS = 25;
const COST_PAIR_CENTS = COST_FRAME1_CENTS + COST_FRAME2_CENTS; // 50¢ — matches "~$0.50" label

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not configured on server' },
      { status: 500 },
    );
  }

  const { uuid } = await params;
  if (!UUID_RE.test(uuid)) {
    return NextResponse.json({ error: 'Invalid uuid' }, { status: 400 });
  }
  const exerciseUuid = uuid.toLowerCase();

  // ─── Parse + validate body ──────────────────────────────────────────────
  let parsed: ParsedBody;
  try {
    parsed = await parseBody(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid request body';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const requestId = parsed.request_id && UUID_RE.test(parsed.request_id)
    ? parsed.request_id.toLowerCase()
    : crypto.randomUUID();
  const notes = parsed.notes ?? null;

  const exercise = await getExercise(exerciseUuid);
  if (!exercise) {
    return NextResponse.json({ error: 'Exercise not found' }, { status: 404 });
  }

  // Idempotency: if a prior job with this request_id already finished
  // (either 'succeeded' or 'running'), don't kick off another OpenAI gen.
  // Service-worker retries, double-taps, and PWA-suspend resume can all
  // re-fire the same POST; without this, every retry costs another ~$0.50.
  // Terminal-failed states (failed_*) are allowed to retry — same request_id
  // can produce a fresh attempt.
  const prior = await query<{ batch_id: string | null; status: string }>(
    `SELECT batch_id, status
       FROM exercise_image_generation_jobs
      WHERE request_id = $1 AND exercise_uuid = $2
      ORDER BY started_at DESC
      LIMIT 1`,
    [requestId, exerciseUuid],
  );
  if (prior.length > 0) {
    const p = prior[0];
    if (p.status === 'succeeded' && p.batch_id) {
      // Replay the response from the prior batch's persisted rows.
      const rows = await query<{ frame_index: number; url: string }>(
        `SELECT frame_index, url
           FROM exercise_image_candidates
          WHERE exercise_uuid = $1 AND batch_id = $2
          ORDER BY frame_index ASC`,
        [exerciseUuid, p.batch_id],
      );
      const f1 = rows.find(r => r.frame_index === 1)?.url;
      const f2 = rows.find(r => r.frame_index === 2)?.url;
      if (f1 && f2) {
        return NextResponse.json({
          batch_id: p.batch_id,
          request_id: requestId,
          image_urls: [f1, f2],
          image_count: 2,
          cost_usd_cents: COST_PAIR_CENTS,
          replayed: true,
        });
      }
    }
    if (p.status === 'running') {
      return NextResponse.json(
        { error: 'A generation with this request_id is already running.', request_id: requestId, status: 'running' },
        { status: 409 },
      );
    }
    // p.status is one of failed_*/rollback_orphan → allow new attempt.
  }

  const batchId = crypto.randomUUID();
  const jobUuid = crypto.randomUUID();

  // ─── Upload reference to Blob (if present) ─────────────────────────────
  // Done BEFORE the OpenAI call so the URL is on the jobs row from the
  // start. Reference blob is preserved on rollback — it's the user's
  // source artifact and retries can re-use it.
  let referenceImageUrl: string | null = null;
  if (parsed.referencePng) {
    try {
      const u = await put(
        `exercise-images/${exerciseUuid}/${batchId}/ref.png`,
        parsed.referencePng,
        { access: 'public', contentType: 'image/png' },
      );
      referenceImageUrl = u.url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      console.error('[generate-images] reference blob upload failed:', err);
      return NextResponse.json(
        { error: `Failed to upload reference image: ${msg}` },
        { status: 502 },
      );
    }
  }

  // Track this attempt server-side from the start. The jobs row is the
  // audit trail — every status transition writes back here.
  await query(
    `INSERT INTO exercise_image_generation_jobs
       (uuid, exercise_uuid, request_id, status, started_at,
        notes, reference_image_url)
     VALUES ($1, $2, $3, 'running', NOW(), $4, $5)`,
    [jobUuid, exerciseUuid, requestId, notes, referenceImageUrl],
  );

  // Lazy-import openai so the client bundle never sees it.
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey });

  // ─── Frame 1 ───────────────────────────────────────────────────────────
  // When a user reference is attached, seed frame 1 from it via images.edit
  // instead of images.generate. Frame 2 still chains from frame 1.
  let frame1Display: Buffer;
  let frame1Png: Buffer;
  let frame1OpenAiId: string | undefined;
  try {
    const frame1Prompt = buildExerciseImagePromptFrame1(exercise, { notes });
    const result = parsed.referencePng
      ? await openai.images.edit({
          model: 'gpt-image-1',
          image: await wrapPngForEdit(parsed.referencePng, 'reference.png'),
          prompt: frame1Prompt,
          size: '1024x1536',
          quality: 'high',
          n: 1,
        })
      : await openai.images.generate({
          model: 'gpt-image-1',
          prompt: frame1Prompt,
          size: '1024x1536',
          quality: 'high',
          n: 1,
        });
    frame1OpenAiId = (result as { id?: string }).id;
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI returned no image data for frame 1');
    frame1Png = Buffer.from(b64, 'base64');
    frame1Display = await resizeToDisplayJpeg(frame1Png);
  } catch (err) {
    return await failJob(
      jobUuid,
      requestId,
      'failed_frame1',
      err,
      [frame1OpenAiId].filter(Boolean) as string[],
      0, // no frames completed
      502,
    );
  }

  // Upload frame 1 immediately so frame 2 has a stable URL we can roll back if needed.
  let frame1Url: string;
  try {
    const u = await put(
      `exercise-images/${exerciseUuid}/${batchId}/01.jpg`,
      frame1Display,
      { access: 'public', contentType: 'image/jpeg' },
    );
    frame1Url = u.url;
  } catch (err) {
    return await failJob(
      jobUuid,
      requestId,
      'failed_frame1',
      err,
      [frame1OpenAiId].filter(Boolean) as string[],
      COST_FRAME1_CENTS, // OpenAI charged even if blob upload failed
      502,
    );
  }

  // ─── Frame 2 (image-to-image, conditioned on frame 1) ──────────────────
  let frame2Display: Buffer;
  let frame2OpenAiId: string | undefined;
  try {
    const frame1File = await wrapPngForEdit(frame1Png, 'frame1.png');
    const result = await openai.images.edit({
      model: 'gpt-image-1',
      image: frame1File,
      prompt: buildExerciseImagePromptFrame2(exercise, { notes }),
      size: '1024x1536',
      quality: 'high',
      n: 1,
    });
    frame2OpenAiId = (result as { id?: string }).id;
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI returned no image data for frame 2');
    frame2Display = await resizeToDisplayJpeg(Buffer.from(b64, 'base64'));
  } catch (err) {
    // Roll back frame 1 blob best-effort. If del() fails, mark orphan
    // so we have a record for manual cleanup later. Reference blob is
    // intentionally preserved.
    const orphan = await safeDel([frame1Url]);
    return await failJob(
      jobUuid,
      requestId,
      orphan ? 'rollback_orphan' : 'failed_frame2',
      err,
      [frame1OpenAiId, frame2OpenAiId].filter(Boolean) as string[],
      COST_PAIR_CENTS,
      502,
    );
  }

  // Upload frame 2.
  let frame2Url: string;
  try {
    const u = await put(
      `exercise-images/${exerciseUuid}/${batchId}/02.jpg`,
      frame2Display,
      { access: 'public', contentType: 'image/jpeg' },
    );
    frame2Url = u.url;
  } catch (err) {
    const orphan = await safeDel([frame1Url]);
    return await failJob(
      jobUuid,
      requestId,
      orphan ? 'rollback_orphan' : 'failed_frame2',
      err,
      [frame1OpenAiId, frame2OpenAiId].filter(Boolean) as string[],
      COST_PAIR_CENTS,
      502,
    );
  }

  // ─── DB activation (atomic) ────────────────────────────────────────────
  // INSERT 2 candidate rows (initially inactive), then flip active in one
  // statement so the unique partial index sees a clean transition. Mirror
  // into exercises.image_urls for the demo strip.
  const candidate1Uuid = crypto.randomUUID();
  const candidate2Uuid = crypto.randomUUID();
  try {
    await transaction([
      {
        text: `INSERT INTO exercise_image_candidates
                 (uuid, exercise_uuid, batch_id, frame_index, url, is_active)
               VALUES ($1, $2, $3, 1, $4, FALSE)`,
        params: [candidate1Uuid, exerciseUuid, batchId, frame1Url],
      },
      {
        text: `INSERT INTO exercise_image_candidates
                 (uuid, exercise_uuid, batch_id, frame_index, url, is_active)
               VALUES ($1, $2, $3, 2, $4, FALSE)`,
        params: [candidate2Uuid, exerciseUuid, batchId, frame2Url],
      },
      {
        // Single statement: set is_active for every row of this exercise to
        // true iff it's in the new batch. Postgres checks the unique partial
        // index after the statement, so the transition is atomic from the
        // index's point of view.
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
      {
        text: `UPDATE exercise_image_generation_jobs
                  SET status = 'succeeded',
                      batch_id = $1,
                      openai_request_ids = $2::jsonb,
                      cost_usd_cents = $3,
                      completed_at = NOW()
                WHERE uuid = $4`,
        params: [
          batchId,
          JSON.stringify([frame1OpenAiId, frame2OpenAiId].filter(Boolean)),
          COST_PAIR_CENTS,
          jobUuid,
        ],
      },
    ]);
  } catch (err) {
    const orphan = await safeDel([frame1Url, frame2Url]);
    return await failJob(
      jobUuid,
      requestId,
      orphan ? 'rollback_orphan' : 'failed_db',
      err,
      [frame1OpenAiId, frame2OpenAiId].filter(Boolean) as string[],
      COST_PAIR_CENTS,
      500,
    );
  }

  return NextResponse.json({
    batch_id: batchId,
    request_id: requestId,
    image_urls: [frame1Url, frame2Url],
    image_count: 2,
    cost_usd_cents: COST_PAIR_CENTS,
    used_reference: parsed.referencePng != null,
  });
}

// ─── Body parsing + validation ──────────────────────────────────────────

/** Parse + validate the request body. Detects multipart vs JSON via
 *  Content-Type, validates notes length and reference image MIME/size,
 *  and resizes the reference to 600×800 PNG via sharp before returning.
 *  Throws Error with a public-safe message on validation failure. */
async function parseBody(request: NextRequest): Promise<ParsedBody> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.startsWith('multipart/form-data')) {
    const form = await request.formData();
    const requestId = stringField(form.get('request_id'));
    const notes = validateNotes(stringField(form.get('notes')));
    const ref = form.get('reference');

    if (!ref || typeof ref === 'string') {
      // Multipart with no file = treat like JSON body
      return { request_id: requestId, notes };
    }

    const refFile = ref as File;
    if (refFile.size === 0) {
      // Empty file slot — same as no reference
      return { request_id: requestId, notes };
    }
    if (refFile.size > REF_MAX_BYTES) {
      throw new Error(
        `Reference image too large (${formatBytes(refFile.size)}, max ${formatBytes(REF_MAX_BYTES)}).`,
      );
    }
    if (!REF_ALLOWED_MIME.has(refFile.type)) {
      throw new Error(
        `Reference image type "${refFile.type || 'unknown'}" not supported. Use PNG, JPEG, or WebP.`,
      );
    }

    // Resize to 600×800 PNG. Cover-crop matches the catalog dimensions and
    // bounds peak memory on the OpenAI edit-call wrapping.
    const refBuf = Buffer.from(await refFile.arrayBuffer());
    let referencePng: Buffer;
    try {
      referencePng = await sharp(refBuf)
        .resize(600, 800, { fit: 'cover', position: 'center' })
        .png()
        .toBuffer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new Error(`Could not process reference image: ${msg}`);
    }

    return {
      request_id: requestId,
      notes,
      referencePng,
      referenceOriginalMime: refFile.type as ParsedBody['referenceOriginalMime'],
    };
  }

  // JSON path. Tolerate empty body.
  let json: { request_id?: unknown; notes?: unknown } = {};
  try { json = await request.json(); } catch { /* empty body ok */ }
  return {
    request_id: typeof json.request_id === 'string' ? json.request_id : undefined,
    notes: validateNotes(typeof json.notes === 'string' ? json.notes : undefined),
  };
}

function stringField(v: FormDataEntryValue | null): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function validateNotes(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > NOTES_MAX_CHARS) {
    throw new Error(
      `Notes too long (${trimmed.length} chars, max ${NOTES_MAX_CHARS}).`,
    );
  }
  return trimmed;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Best-effort delete of one or more blob URLs. Returns true if any del()
 *  failed (i.e., orphan blob may exist; caller should mark rollback_orphan). */
async function safeDel(urls: string[]): Promise<boolean> {
  const results = await Promise.allSettled(urls.map(u => del(u)));
  return results.some(r => r.status === 'rejected');
}

/** Update jobs row to a failure terminal state and return a JSON error
 *  response. The full err.message is written to the server-side audit row
 *  but the client gets a phase-specific generic blurb so internal details
 *  (Postgres index names, OpenAI request ids, etc) don't leak through.
 *  Cost tracks what OpenAI actually charged (frame 1 only if we failed at
 *  frame 2; pair cost if we failed at DB). */
async function failJob(
  jobUuid: string,
  requestId: string,
  status: 'failed_frame1' | 'failed_frame2' | 'failed_db' | 'rollback_orphan',
  err: unknown,
  openAiIds: string[],
  costCents: number,
  httpStatus: number,
): Promise<NextResponse> {
  const auditMsg = err instanceof Error ? err.message : 'unknown';
  console.error(`[generate-images] ${status}:`, err);
  try {
    await query(
      `UPDATE exercise_image_generation_jobs
          SET status = $1,
              error_message = $2,
              openai_request_ids = $3::jsonb,
              cost_usd_cents = $4,
              completed_at = NOW()
        WHERE uuid = $5`,
      [status, auditMsg.slice(0, 1000), JSON.stringify(openAiIds), costCents, jobUuid],
    );
  } catch (dbErr) {
    console.error('[generate-images] failed to record job failure:', dbErr);
  }
  // Public message — generic by phase, no raw err.message.
  const publicMsg = (() => {
    switch (status) {
      case 'failed_frame1':    return 'Generation failed at frame 1.';
      case 'failed_frame2':    return 'Generation failed at frame 2.';
      case 'failed_db':        return 'Generation completed but the save step failed.';
      case 'rollback_orphan':  return 'Generation failed and partial cleanup left orphan storage.';
    }
  })();
  return NextResponse.json(
    { error: publicMsg, status, request_id: requestId, cost_usd_cents: costCents },
    { status: httpStatus },
  );
}
