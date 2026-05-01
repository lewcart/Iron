import sharp from 'sharp';

// Split a vertically-stacked 2-panel image into 2 separate frames.
//
// Input expectation: a portrait image where the height is divisible by 2.
// gpt-image-1 returns 1024×1536; the split yields two 1024×768 buffers.
// We then resize each to a final 600×800 portrait JPEG q75 to match the
// catalog's standard aspect.
//
// Returns 2 JPEG buffers ordered top→bottom (start position, end position).
//
// Why 2 not 3: gpt-image-1 doesn't reliably place panel boundaries at
// exact 33%/66% intervals — the model produces panels of varying height,
// so a fixed 3-way split mid-cuts content. The 50% split for 2 panels is
// far more reliable, and matches the everkinetic-data
// `relaxation`/`tension` 2-frame paradigm we already use for the catalog.

export async function splitVerticalPanels(input: Buffer): Promise<[Buffer, Buffer]> {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read image dimensions');
  }
  const panelH = Math.floor(meta.height / 2);
  if (panelH <= 0) {
    throw new Error(`Image height ${meta.height} is too small to split into 2 panels`);
  }

  const out: Buffer[] = [];
  for (let i = 0; i < 2; i++) {
    const top = i * panelH;
    const buf = await sharp(input)
      .extract({ left: 0, top, width: meta.width, height: panelH })
      .resize(600, 800, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 75 })
      .toBuffer();
    out.push(buf);
  }
  return [out[0], out[1]];
}
