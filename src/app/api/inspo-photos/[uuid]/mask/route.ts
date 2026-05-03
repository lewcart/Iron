import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { requireApiKey } from '@/lib/api-auth';
import { updateInspoPhoto } from '@/db/queries';

export const runtime = 'nodejs';

const MAX_MASK_BYTES = 5 * 1024 * 1024;

/** POST /api/inspo-photos/[uuid]/mask
 *
 * Same shape as /api/progress-photos/[uuid]/mask. Stores a person-segmentation
 * mask PNG in Vercel Blob and writes the URL to inspo_photos.mask_url.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await ctx.params;

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (file.type && file.type !== 'image/png') {
    return NextResponse.json({ error: 'mask must be image/png' }, { status: 400 });
  }
  if (file.size > MAX_MASK_BYTES) {
    return NextResponse.json({ error: `mask exceeds ${MAX_MASK_BYTES} bytes` }, { status: 413 });
  }

  const blob = await put(`inspo-photos/masks/${uuid}-${crypto.randomUUID()}.png`, file, {
    access: 'public',
    contentType: 'image/png',
  });

  const updated = await updateInspoPhoto(uuid, { mask_url: blob.url });
  if (!updated) return NextResponse.json({ error: 'photo not found' }, { status: 404 });

  return NextResponse.json({ mask_url: blob.url });
}
