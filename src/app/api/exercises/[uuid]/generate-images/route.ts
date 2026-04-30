import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getExercise } from '@/db/queries';
import { query } from '@/db/db';
import { buildExerciseImagePrompt } from '@/lib/exercise-image-prompt';
import { splitThreePanel } from '@/lib/split-three-panel';

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not configured on server' },
      { status: 500 },
    );
  }

  const { uuid } = await params;
  const exercise = await getExercise(uuid);
  if (!exercise) {
    return NextResponse.json({ error: 'Exercise not found' }, { status: 404 });
  }

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

  // Split the composite into 3 portrait frames
  const composite = Buffer.from(imageBase64, 'base64');
  let frames: [Buffer, Buffer, Buffer];
  try {
    frames = await splitThreePanel(composite);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[generate-images] split error:', err);
    return NextResponse.json(
      { error: `Image split failed: ${msg}` },
      { status: 500 },
    );
  }

  // Upload all 3 to Vercel Blob in parallel
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

  // Persist to Postgres. image_urls = the three Blob URLs in order.
  // Sync push will roll the row out to other clients via change_log.
  await query(
    'UPDATE exercises SET image_count = $1, image_urls = $2, updated_at = NOW() WHERE uuid = $3',
    [3, urls, uuid.toLowerCase()],
  );

  return NextResponse.json({ image_count: 3, image_urls: urls });
}
