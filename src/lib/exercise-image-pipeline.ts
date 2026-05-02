import sharp from 'sharp';
import { toFile, type Uploadable } from 'openai';

// Pipeline helpers for AI-generated exercise demo images.
//
// Two transforms:
//   1. resizeToDisplayJpeg — convert an incoming PNG/JPEG buffer to the
//      catalog's standard 600×800 portrait JPEG q75. This is what we
//      persist to Vercel Blob and what the demo strip renders.
//   2. wrapPngForEdit — wrap an already-PNG buffer as an OpenAI Uploadable
//      so it can ride along to openai.images.edit({ image }). gpt-image-1
//      wants PNG input; raw Buffers get rejected with
//      `BadRequestError: Could not parse multipart`. Caller passes the
//      ORIGINAL openai-returned PNG buffer (not the resized JPEG) so we
//      avoid a wasted sharp decode→encode round-trip.
//
// Both helpers stay tiny on purpose. The old splitVerticalPanels file is
// gone; what survives is just `.resize(600,800).jpeg({quality:75})`.

const DISPLAY_W = 600;
const DISPLAY_H = 800;
const DISPLAY_QUALITY = 75;

/** Resize an arbitrary image buffer to the catalog's standard 600×800
 *  portrait JPEG q75. Used for the persisted Blob and the strip preview. */
export async function resizeToDisplayJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize(DISPLAY_W, DISPLAY_H, { fit: 'cover', position: 'center' })
    .jpeg({ quality: DISPLAY_QUALITY })
    .toBuffer();
}

/** Wrap an already-PNG buffer as an Uploadable suitable for
 *  openai.images.edit({ image }). gpt-image-1 rejects raw Buffers — must
 *  go through toFile() with type: 'image/png'. Pass the original PNG
 *  buffer that openai.images.generate returned (not the resized JPEG) so
 *  we don't decode and re-encode a 1024×1536 image for nothing. */
export async function wrapPngForEdit(pngBuf: Buffer, name = 'frame1.png'): Promise<Uploadable> {
  return toFile(pngBuf, name, { type: 'image/png' });
}
