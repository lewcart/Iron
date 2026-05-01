#!/usr/bin/env node
// Fetch demo images for catalog exercises from the everkinetic-data
// open library and bundle them into public/exercise-images/{uuid}/.
//
// The everkinetic-data repo (github.com/everkinetic/data) hosts exercise
// images at a stable raw.githubusercontent.com URL pattern. Each exercise
// has a few frames showing different phases of the movement. This script:
//
//   1. Reads public/exercises-catalog.json
//   2. For each is_custom=false row with a valid everkinetic_id (>0)
//   3. Probes the URL for frame 0, 1, 2 (continues until 404)
//   4. Downloads each frame, resizes to 600×800 portrait JPEG q75 via sharp
//   5. Saves to public/exercise-images/{uuid}/{01,02,03}.jpg
//   6. Records the count in scripts/data/exercise-image-manifest.json
//
// Override the everkinetic URL pattern via env if the repo layout changes:
//   EVERKINETIC_URL_TMPL='https://raw.githubusercontent.com/.../{id}/{frame}.jpg'
//
// Usage:
//   node scripts/fetch-everkinetic-images.mjs              # all rows
//   node scripts/fetch-everkinetic-images.mjs --uuid abc   # single row
//   node scripts/fetch-everkinetic-images.mjs --limit 50   # smoke test

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const CATALOG_PATH = join(ROOT, 'public/exercises-catalog.json');
const IMAGES_DIR = join(ROOT, 'public/exercise-images');
const MANIFEST_PATH = join(ROOT, 'scripts/data/exercise-image-manifest.json');

const URL_TMPL = process.env.EVERKINETIC_URL_TMPL
  ?? 'https://raw.githubusercontent.com/everkinetic/data/master/exercises/{id}/0.jpg';

function buildUrl(everkineticId, frame) {
  return URL_TMPL.replace('{id}', String(everkineticId)).replace('{frame}', String(frame));
}

const args = process.argv.slice(2);
const onlyUuid = (() => {
  const i = args.indexOf('--uuid');
  return i >= 0 ? args[i + 1] : null;
})();
const limit = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) : Infinity;
})();

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'));
const manifest = existsSync(MANIFEST_PATH)
  ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
  : {};

const rows = catalog
  .filter(ex => !ex.is_custom && Number.isFinite(ex.everkinetic_id) && ex.everkinetic_id > 0)
  .filter(ex => !onlyUuid || ex.uuid === onlyUuid)
  .slice(0, limit);

console.log(`Processing ${rows.length} exercises (URL_TMPL=${URL_TMPL})`);

let processed = 0;
let withImages = 0;
let skipped = 0;

for (const ex of rows) {
  const dir = join(IMAGES_DIR, ex.uuid);
  if (manifest[ex.uuid] && manifest[ex.uuid] > 0) {
    skipped++;
    continue;
  }

  const frames = [];
  // Probe frames 0,1,2. Stop on first 404.
  for (let f = 0; f < 3; f++) {
    const url = buildUrl(ex.everkinetic_id, f);
    let res;
    try {
      res = await fetch(url);
    } catch {
      break;
    }
    if (!res.ok) break;
    const buf = Buffer.from(await res.arrayBuffer());
    frames.push(buf);
  }

  if (frames.length === 0) {
    console.log(`  ${ex.uuid} (${ex.title}): no frames`);
    continue;
  }

  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < frames.length; i++) {
    const out = await sharp(frames[i])
      .resize(600, 800, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 75 })
      .toBuffer();
    writeFileSync(join(dir, `${String(i + 1).padStart(2, '0')}.jpg`), out);
  }

  manifest[ex.uuid] = frames.length;
  withImages++;
  if (++processed % 25 === 0) {
    console.log(`  …${processed} processed, ${withImages} got images`);
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  }
}

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
console.log(`\nDone. processed=${processed} with-images=${withImages} skipped=${skipped}`);
console.log(`Manifest: ${MANIFEST_PATH}`);
