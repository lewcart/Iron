import sharp from 'sharp';

// Split a vertically-stacked 3-panel image into 3 separate frames.
//
// Input expectation: a portrait image where the height is divisible by 3.
// gpt-image-1 returns 1024×1536; the split yields three 1024×512 buffers.
// We then resize each to a final 600×800 portrait JPEG q75 to match the
// catalog's standard aspect.
//
// Returns 3 JPEG buffers ordered top→middle→bottom (start, mid, end).

export async function splitThreePanel(input: Buffer): Promise<[Buffer, Buffer, Buffer]> {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read image dimensions');
  }
  const panelH = Math.floor(meta.height / 3);
  if (panelH <= 0) {
    throw new Error(`Image height ${meta.height} is too small to split into 3 panels`);
  }

  const out: Buffer[] = [];
  for (let i = 0; i < 3; i++) {
    const top = i * panelH;
    const buf = await sharp(input)
      .extract({ left: 0, top, width: meta.width, height: panelH })
      .resize(600, 800, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 75 })
      .toBuffer();
    out.push(buf);
  }
  return [out[0], out[1], out[2]];
}
