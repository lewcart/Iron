import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) process.env[m[1]] ??= m[2];
}
const sql = neon(process.env.DATABASE_URL);

const Q2 = '4d31af5f-edf2-4bb6-b272-5d90959f919b';
const Q3 = '6621e65a-a617-4205-89f9-443ccdf5c92d';

const rows = await sql`
  SELECT DISTINCT e.uuid, e.title,
    e.description, e.steps, e.tips,
    e.image_count, e.image_urls,
    string_agg(DISTINCT CASE WHEN wp.uuid = ${Q2} THEN 'Q2' WHEN wp.uuid = ${Q3} THEN 'Q3' END, ',') AS plans
  FROM workout_routine_exercises wre
  JOIN workout_routines wr ON wre.workout_routine_uuid = wr.uuid
  JOIN workout_plans wp ON wr.workout_plan_uuid = wp.uuid
  JOIN exercises e ON wre.exercise_uuid = e.uuid
  WHERE wp.uuid IN (${Q2}, ${Q3})
  GROUP BY e.uuid, e.title, e.description, e.steps, e.tips, e.image_count, e.image_urls
  ORDER BY e.title
`;
function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
  return [];
}

let missContent = 0, missImage = 0;
const list = [];
for (const r of rows) {
  const steps = parseArr(r.steps);
  const tips = parseArr(r.tips);
  const desc = (r.description || '').trim();
  const needContent = !desc || steps.length === 0 || tips.length === 0;
  const needImage = !r.image_count || r.image_count === 0;
  if (needContent) missContent++;
  if (needImage) missImage++;
  list.push({ uuid: r.uuid, title: r.title, plans: r.plans, needContent, needImage, no_desc: !desc, no_steps: steps.length === 0, no_tips: tips.length === 0, image_count: r.image_count });
}

console.log(`Q2+Q3 unique exercises: ${rows.length}`);
console.log(`  need content: ${missContent}`);
console.log(`  need images:  ${missImage}`);
console.log(`Estimated cost (images only, $0.50/ex): $${(missImage * 0.5).toFixed(2)}`);
console.log();
console.log('Detailed:');
for (const r of list) {
  if (r.needContent || r.needImage) {
    const c = r.needContent ? '📝' : '  ';
    const i = r.needImage ? '🖼️ ' : '  ';
    console.log(`${c}${i} [${r.plans}] ${r.title}   (desc:${!r.no_desc} steps:${!r.no_steps} tips:${!r.no_tips} img:${r.image_count})   ${r.uuid}`);
  }
}
