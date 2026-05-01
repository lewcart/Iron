#!/usr/bin/env node
// Fetch demo images for catalog exercises from the everkinetic-data
// open library and bundle them into public/exercise-images/{uuid}/.
//
// The everkinetic-data repo (github.com/everkinetic/data) hosts exercise
// images at:
//   https://raw.githubusercontent.com/everkinetic/data/main/dist/png/{padded4}-relaxation.png
//   https://raw.githubusercontent.com/everkinetic/data/main/dist/png/{padded4}-tension.png
//
// Two frames per exercise: relaxation (start position) + tension (peak/end).
// {padded4} is the everkinetic_id zero-padded to 4 digits ("0006", "0284").
//
// This script:
//   1. Reads public/exercises-catalog.json
//   2. For each is_custom=false row with a valid everkinetic_id (>0)
//   3. Tries to download both frames
//   4. If both succeed: resize to 600×800 portrait JPEG q75 via sharp,
//      save to public/exercise-images/{uuid}/{01,02}.jpg
//   5. Records image_count=2 in scripts/data/exercise-image-manifest.json
//   6. Skips silently when neither frame is available (catalog gap; AI gen
//      can fill these via gen-exercise-images.mjs).
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

const URL_BASE = 'https://raw.githubusercontent.com/everkinetic/data/main/dist/png';
// Frame keys to fetch in order. Maps to 01.jpg, 02.jpg in the output dir.
const FRAME_KEYS = ['relaxation', 'tension'];

function buildUrl(everkineticId, key) {
  const padded = String(everkineticId).padStart(4, '0');
  return `${URL_BASE}/${padded}-${key}.png`;
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

console.log(`Processing ${rows.length} exercises from everkinetic-data...`);

const CONCURRENCY = 12;
let processed = 0;
let withImages = 0;
let skipped = 0;

async function processOne(ex) {
  if (manifest[ex.uuid] && manifest[ex.uuid] > 0) {
    skipped++;
    return;
  }
  const dir = join(IMAGES_DIR, ex.uuid);
  const frames = [];
  for (const key of FRAME_KEYS) {
    const url = buildUrl(ex.everkinetic_id, key);
    let res;
    try {
      res = await fetch(url);
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    frames.push(buf);
  }

  processed++;
  if (frames.length === 0) return;

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
}

// Process in batches of CONCURRENCY for parallelism without DOS'ing GitHub.
for (let i = 0; i < rows.length; i += CONCURRENCY) {
  const batch = rows.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(processOne));
  if (i % (CONCURRENCY * 10) === 0 && i > 0) {
    console.log(`  …${processed}/${rows.length} processed, ${withImages} got images`);
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  }
}

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
console.log(`\nDone. processed=${processed} with-images=${withImages} skipped=${skipped} no-images=${processed - withImages}`);
console.log(`Manifest: ${MANIFEST_PATH}`);
