#!/usr/bin/env node
// AI-generate demo images for an exercise via OpenAI gpt-image-1.
//
// Strategy: ONE generation produces a 1024×1536 portrait composite with
// 3 phases stacked vertically. We split via sharp, resize each to 600×800
// portrait JPEG q75, save under public/exercise-images/{uuid}/.
//
// One generation = ~$0.19 (high quality 1024×1536). The script opens
// the saved frames in your image viewer (macOS `open`) for an eyeball
// check before declaring victory. If they look wrong, re-run.
//
// Usage:
//   node scripts/gen-exercise-images.mjs --uuid <exercise-uuid>
//   node scripts/gen-exercise-images.mjs --all-missing      # fill catalog gaps
//   node scripts/gen-exercise-images.mjs --uuid <uuid> --skip-review
//
// Requires OPENAI_API_KEY in .env.local.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import sharp from 'sharp';
import OpenAI from 'openai';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
config({ path: join(ROOT, '.env.local') });

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OPENAI_API_KEY is required (set it in .env.local)');
  process.exit(1);
}

const CATALOG_PATH = join(ROOT, 'public/exercises-catalog.json');
const IMAGES_DIR = join(ROOT, 'public/exercise-images');
const MANIFEST_PATH = join(ROOT, 'scripts/data/exercise-image-manifest.json');

const args = process.argv.slice(2);
const onlyUuid = (() => { const i = args.indexOf('--uuid'); return i >= 0 ? args[i + 1] : null; })();
const allMissing = args.includes('--all-missing');
const skipReview = args.includes('--skip-review');

if (!onlyUuid && !allMissing) {
  console.error('Usage: gen-exercise-images.mjs --uuid <uuid> | --all-missing');
  process.exit(1);
}

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'));
const manifest = existsSync(MANIFEST_PATH)
  ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
  : {};

const targets = onlyUuid
  ? catalog.filter(ex => ex.uuid === onlyUuid)
  : catalog.filter(ex => !manifest[ex.uuid] || manifest[ex.uuid] === 0);

if (targets.length === 0) {
  console.log('Nothing to generate');
  process.exit(0);
}

console.log(`Will generate for ${targets.length} exercises (~$${(targets.length * 0.19).toFixed(2)} estimated cost)`);
if (targets.length > 5 && !skipReview) {
  console.log('Type Y to confirm, anything else to abort:');
  const ok = await readChar();
  if (ok.toLowerCase() !== 'y') process.exit(0);
}

const openai = new OpenAI({ apiKey });

for (const ex of targets) {
  console.log(`\n[${ex.uuid}] ${ex.title}`);
  const prompt = buildPrompt(ex);

  let buf;
  try {
    const res = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size: '1024x1536',
      quality: 'high',
      n: 1,
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error('No image in response');
    buf = Buffer.from(b64, 'base64');
  } catch (err) {
    console.error(`  generate failed: ${err.message}`);
    continue;
  }

  const dir = join(IMAGES_DIR, ex.uuid);
  mkdirSync(dir, { recursive: true });

  // Split into 3 panels (vertical stack). Each panel becomes a 600×800 JPEG.
  const meta = await sharp(buf).metadata();
  const panelH = Math.floor(meta.height / 3);
  for (let i = 0; i < 3; i++) {
    const out = await sharp(buf)
      .extract({ left: 0, top: i * panelH, width: meta.width, height: panelH })
      .resize(600, 800, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 75 })
      .toBuffer();
    writeFileSync(join(dir, `${String(i + 1).padStart(2, '0')}.jpg`), out);
  }

  console.log(`  saved 3 frames to ${dir}`);

  if (!skipReview) {
    spawn('open', [dir], { stdio: 'ignore', detached: true });
    console.log('  Review the frames in Finder. Press Y to keep, R to regenerate, S to skip:');
    const k = (await readChar()).toLowerCase();
    if (k === 'r') {
      // Don't update manifest; redo on next pass.
      continue;
    }
    if (k === 's') {
      // Don't update manifest; user will skip this exercise.
      console.log('  skipped (manifest unchanged)');
      continue;
    }
  }

  manifest[ex.uuid] = 3;
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

console.log('\nDone. Run `npm run db:apply-image-counts` to push image_count to Postgres + regen catalog JSON.');

function buildPrompt(ex) {
  const equipment = (ex.equipment ?? []).join(', ') || 'bodyweight';
  const firstSteps = (ex.steps ?? []).slice(0, 3).join('. ');
  const desc = ex.description?.trim() || '';
  return [
    `Three-panel exercise demonstration showing the "${ex.title}" exercise.`,
    'Render as ONE single PORTRAIT image with three panels STACKED VERTICALLY (one above the other), each panel showing a different phase:',
    '  Top panel: Starting position',
    '  Middle panel: Mid-movement',
    '  Bottom panel: End position',
    '',
    'Strict constraints — identical across all three panels:',
    '- Same gender-neutral athlete',
    '- Same gym setting and lighting',
    '- Same camera angle (side-view, full body visible)',
    '- Plain neutral light-grey background',
    `- Equipment: ${equipment}`,
    '- Style: clean line-art / anatomy-textbook illustration',
    '- Each panel separated by a thin horizontal line',
    '- No text, no labels, no numbers',
    '',
    desc ? `Movement description: ${desc}` : '',
    firstSteps ? `Key steps: ${firstSteps}` : '',
  ].filter(Boolean).join('\n');
}

async function readChar() {
  process.stdin.setRawMode(true);
  return new Promise(resolve => {
    process.stdin.once('data', data => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(data.toString());
    });
    process.stdin.resume();
  });
}
