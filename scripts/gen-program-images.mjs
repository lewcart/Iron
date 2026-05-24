// Generate AI image pairs for exercises in Lou's Q2+Q3 programs that have
// image_count = 0. POSTs to the deployed generate-images endpoint, which
// runs the existing gpt-image-1 frame1+frame2 pipeline, persists to Vercel
// Blob, and updates the exercises table.
//
// Tracks state in scripts/data/image-review.json so this is resumable and
// Claude can iterate the review-then-regen loop in subsequent passes.
//
// Usage:
//   node scripts/gen-program-images.mjs                  # generate any pending
//   node scripts/gen-program-images.mjs --uuid <uuid>    # one exercise
//   node scripts/gen-program-images.mjs --regen          # re-run any tagged FAIL in the review JSON
//   node scripts/gen-program-images.mjs --dry-run        # show plan, no calls
//
// The deployed endpoint is https://iron-swart.vercel.app (Lou's alias).

import { Pool } from '@neondatabase/serverless';
import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import path from 'path';

const env = readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) process.env[m[1]] ??= m[2];
}

const API_URL = 'https://iron-swart.vercel.app';
const API_KEY = process.env.REBIRTH_API_KEY;
if (!API_KEY) { console.error('REBIRTH_API_KEY missing'); process.exit(1); }

const Q2 = '4d31af5f-edf2-4bb6-b272-5d90959f919b';
const Q3 = '6621e65a-a617-4205-89f9-443ccdf5c92d';

const REVIEW_PATH = 'scripts/data/image-review.json';
const REVIEW_DIR = 'scripts/data/review';

const args = process.argv.slice(2);
const onlyUuid = (() => { const i = args.indexOf('--uuid'); return i >= 0 ? args[i + 1] : null; })();
const regenMode = args.includes('--regen');
const dryRun = args.includes('--dry-run');

mkdirSync(REVIEW_DIR, { recursive: true });

function loadReview() {
  if (!existsSync(REVIEW_PATH)) return {};
  return JSON.parse(readFileSync(REVIEW_PATH, 'utf-8'));
}
function saveReview(state) {
  writeFileSync(REVIEW_PATH, JSON.stringify(state, null, 2));
}

const state = loadReview();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Build the target list.
async function pickTargets() {
  if (regenMode) {
    // All entries marked FAIL — we'll regen using their queued `next_notes`.
    return Object.values(state).filter(e => e.review === 'fail' && (e.attempts ?? 1) < 3);
  }
  if (onlyUuid) {
    const r = await pool.query(
      `SELECT uuid, title, image_count FROM exercises WHERE uuid = $1`,
      [onlyUuid],
    );
    return r.rows.map(row => ({ uuid: row.uuid, title: row.title }));
  }
  const r = await pool.query(`
    SELECT DISTINCT e.uuid, e.title
    FROM workout_routine_exercises wre
    JOIN workout_routines wr ON wre.workout_routine_uuid = wr.uuid
    JOIN workout_plans wp ON wr.workout_plan_uuid = wp.uuid
    JOIN exercises e ON wre.exercise_uuid = e.uuid
    WHERE wp.uuid IN ($1, $2)
      AND (e.image_count IS NULL OR e.image_count = 0)
    ORDER BY e.title
  `, [Q2, Q3]);
  return r.rows;
}

async function downloadTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} → ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function generateOne(target) {
  const { uuid, title } = target;
  const existing = state[uuid];
  const requestId = crypto.randomUUID();
  const notes = existing?.next_notes ?? null;
  const attemptNum = (existing?.attempts ?? 0) + 1;

  const body = { request_id: requestId };
  if (notes) body.notes = notes;
  console.log(`[${attemptNum}] ${title}  →  POST /api/exercises/${uuid}/generate-images${notes ? `   notes: "${notes}"` : ''}`);
  if (dryRun) return { skipped: true };

  const res = await fetch(`${API_URL}/api/exercises/${uuid}/generate-images`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    console.error(`  ✗ ${res.status}: ${json.error || text.slice(0, 200)}`);
    return { error: json.error || text.slice(0, 200), status: res.status };
  }
  const [u1, u2] = json.image_urls || [];
  if (!u1 || !u2) {
    console.error(`  ✗ no image_urls in response: ${text.slice(0, 200)}`);
    return { error: 'no image_urls', status: res.status };
  }

  // Download both for local review.
  const dir = path.join(REVIEW_DIR, uuid);
  mkdirSync(dir, { recursive: true });
  const localA = path.join(dir, `attempt-${attemptNum}-01.jpg`);
  const localB = path.join(dir, `attempt-${attemptNum}-02.jpg`);
  await downloadTo(u1, localA);
  await downloadTo(u2, localB);

  // Update state.
  state[uuid] = {
    uuid,
    title,
    attempts: attemptNum,
    last_url1: u1,
    last_url2: u2,
    last_local1: localA,
    last_local2: localB,
    last_request_id: requestId,
    last_cost_cents: json.cost_usd_cents ?? 50,
    cost_total_cents: (existing?.cost_total_cents ?? 0) + (json.cost_usd_cents ?? 50),
    review: 'pending',  // Claude will set this to 'pass' / 'fail' + next_notes
    next_notes: null,
    notes_used: notes,
  };
  saveReview(state);
  console.log(`  ✓ frame1+frame2 saved, attempt=${attemptNum}, cumulative_cost=¢${state[uuid].cost_total_cents}`);
  return { ok: true };
}

const targets = await pickTargets();
if (targets.length === 0) {
  console.log(regenMode ? 'No FAIL entries with retries remaining.' : 'No exercises pending image gen.');
  await pool.end();
  process.exit(0);
}

const totalCost = targets.length * 50;
console.log(`${regenMode ? 'REGEN' : 'GENERATE'}: ${targets.length} exercises  (est ¢${totalCost} / $${(totalCost/100).toFixed(2)})\n`);

let ok = 0, errs = 0, totalCents = 0;
for (const t of targets) {
  try {
    const result = await generateOne(t);
    if (result.error) errs++;
    else if (result.ok) {
      ok++;
      totalCents += state[t.uuid]?.last_cost_cents ?? 50;
    }
  } catch (err) {
    console.error(`  ✗ ${t.title}: ${err.message}`);
    errs++;
  }
}

await pool.end();
console.log(`\n${regenMode ? 'Regen' : 'Gen'} done: ${ok} success, ${errs} errors. Cost this run: $${(totalCents/100).toFixed(2)}`);
