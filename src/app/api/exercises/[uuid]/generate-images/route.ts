import { NextRequest, NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import { getExercise } from '@/db/queries';
import { query } from '@/db/db';
import { requireApiKey } from '@/lib/api-auth';
import { buildExerciseImagePrompt } from '@/lib/exercise-image-prompt';
import { splitVerticalPanels } from '@/lib/split-vertical-panels';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/exercises/[uuid]/generate-images
//
// Generates 3 demo frames for an exercise via OpenAI gpt-image-1, splits the
// 3-panel composite into individual portrait JPEGs, uploads to Vercel Blob,
// and updates the exercises row with image_count=3 + image_urls=[...].
//
// Requires OPENAI_API_KEY env var. Costs ~$0.19 per call (gpt-image-1
// 1024×1536 portrait, high quality). Rate-limited by OpenAI; bubble up
// errors as 5xx so the client can retry.

export const maxDuration = 90; // OpenAI image gen can take 30-60s; give headroom

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  // Auth gate first — this endpoint costs ~$0.19/call against an external
  // billed API. No anonymous access, even with REBIRTH_API_KEY unset locally
  // (in that case it's already permissive).
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
  // Reject malformed UUIDs before any DB or Blob call so a crafted path
  // can't fan-out into weird blob keys (`exercise-images/../foo/`).
  if (!UUID_RE.test(uuid)) {
    return NextResponse.json({ error: 'Invalid uuid' }, { status: 400 });
  }

  const exercise = await getExercise(uuid);
  if (!exercise) {
    return NextResponse.json({ error: 'Exercise not found' }, { status: 404 });
  }
  // Note on concurrency: the UI disables the button while a request is in
  // flight, so spam-protection is at the client layer. The auth gate above
  // bounds external abuse. Single-user single-device makes a server-side
  // lock not worth the schema column it'd cost.

  const prompt = buildExerciseImagePrompt({
    title: exercise.title,
    description: exercise.description,
    steps: exercise.steps,
    equipment: exercise.equipment,
  });

  // Lazy-import openai so the client bundle never sees it. The Node SDK
  // is fine to construct per-request — it's just a thin fetch wrapper.
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey });

  let imageBase64: string;
  try {
    const result = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size: '1024x1536',
      quality: 'high',
      n: 1,
    });
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json(
        { error: 'OpenAI returned no image data' },
        { status: 502 },
      );
    }
    imageBase64 = b64;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[generate-images] OpenAI error:', err);
    return NextResponse.json(
      { error: `Image generation failed: ${msg}` },
      { status: 502 },
    );
  }

  // Split the composite into 2 portrait frames (start + end positions).
  // gpt-image-1 places 50%-split panels reliably; the prior 3-panel split
  // mid-cut content because the model doesn't honor 33%/66% boundaries.
  const composite = Buffer.from(imageBase64, 'base64');
  let frames: [Buffer, Buffer];
  try {
    frames = await splitVerticalPanels(composite);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[generate-images] split error:', err);
    return NextResponse.json(
      { error: `Image split failed: ${msg}` },
      { status: 500 },
    );
  }

  // Upload both frames to Vercel Blob in parallel.
  let urls: string[];
  try {
    const ts = Date.now(); // bust any old-cache reference
    const uploads = await Promise.all(
      frames.map((buf, i) =>
        put(
          `exercise-images/${uuid}/${ts}-${String(i + 1).padStart(2, '0')}.jpg`,
          buf,
          { access: 'public', contentType: 'image/jpeg' },
        ),
      ),
    );
    urls = uploads.map(u => u.url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[generate-images] blob upload error:', err);
    return NextResponse.json(
      { error: `Blob upload failed: ${msg}` },
      { status: 502 },
    );
  }

  // Persist to Postgres. image_urls = the two Blob URLs in order.
  // If the UPDATE fails, clean up the just-uploaded blobs so we don't
  // accumulate orphan storage on retries.
  try {
    await query(
      'UPDATE exercises SET image_count = $1, image_urls = $2, updated_at = NOW() WHERE uuid = $3',
      [2, urls, uuid.toLowerCase()],
    );
  } catch (err) {
    // Best-effort cleanup. Don't fail the response over cleanup errors —
    // the blobs are still orphan but the user already has the original
    // failure context.
    await Promise.allSettled(urls.map(u => del(u)));
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[generate-images] DB update failed; orphan blobs cleaned:', err);
    return NextResponse.json(
      { error: `Failed to persist images: ${msg}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ image_count: 2, image_urls: urls });
}
