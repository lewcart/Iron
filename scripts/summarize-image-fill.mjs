// Summarize the program-image fill: per-exercise verdicts, cumulative cost,
// remaining gaps, and any anomalies (e.g., image_count not updated in DB).
//
// Reads scripts/data/image-review.json + queries the live DB.

import { Pool } from '@neondatabase/serverless';
import { readFileSync, existsSync } from 'fs';

const env = readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) process.env[m[1]] ??= m[2];
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const Q2 = '4d31af5f-edf2-4bb6-b272-5d90959f919b';
const Q3 = '6621e65a-a617-4205-89f9-443ccdf5c92d';

const REVIEW_PATH = 'scripts/data/image-review.json';
const review = existsSync(REVIEW_PATH) ? JSON.parse(readFileSync(REVIEW_PATH, 'utf-8')) : {};

const rows = (await pool.query(`
  SELECT DISTINCT e.uuid, e.title, e.image_count, e.image_urls
  FROM workout_routine_exercises wre
  JOIN workout_routines wr ON wre.workout_routine_uuid = wr.uuid
  JOIN workout_plans wp ON wr.workout_plan_uuid = wp.uuid
  JOIN exercises e ON wre.exercise_uuid = e.uuid
  WHERE wp.uuid IN ($1, $2)
  ORDER BY e.title
`, [Q2, Q3])).rows;

let totalCost = 0;
let pass = 0, fail = 0, pending = 0, notGenerated = 0;
let stillNoImage = 0;

const lines = [];
for (const r of rows) {
  const entry = review[r.uuid];
  let status = '';
  if (!entry) {
    if (r.image_count > 0) status = '— (pre-existing images, not regenerated)';
    else { status = '⚠ NO GEN ATTEMPTED'; notGenerated++; stillNoImage++; }
  } else {
    totalCost += entry.cost_total_cents ?? 0;
    if (entry.review === 'pass') { status = `✓ pass (attempts=${entry.attempts})`; pass++; }
    else if (entry.review === 'fail') { status = `✗ fail (attempts=${entry.attempts}, next: regen with notes)`; fail++; }
    else { status = `⏳ pending review (attempts=${entry.attempts})`; pending++; }
    if (!r.image_count || r.image_count === 0) stillNoImage++;
  }
  lines.push(`  ${r.title.padEnd(45)} img_count=${r.image_count ?? 0}  ${status}`);
}

console.log('PROGRAM IMAGE FILL — Q2 + Q3 SUMMARY\n');
console.log(`Total exercises in Q2+Q3:  ${rows.length}`);
console.log(`  ✓ pass:               ${pass}`);
console.log(`  ✗ fail:               ${fail}  (queued for regen)`);
console.log(`  ⏳ pending review:     ${pending}`);
console.log(`  — pre-existing/skip:  ${rows.length - pass - fail - pending - notGenerated}`);
console.log(`  ⚠ not generated:      ${notGenerated}`);
console.log(`\nDB sanity — exercises still with image_count=0: ${stillNoImage}`);
console.log(`\nCumulative spend: $${(totalCost / 100).toFixed(2)} (${totalCost}¢)\n`);
console.log('Detail:');
console.log(lines.join('\n'));

await pool.end();
