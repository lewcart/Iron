import { neon } from '@neondatabase/serverless';
import { readFileSync, writeFileSync } from 'fs';

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
    e.primary_muscles, e.secondary_muscles, e.equipment,
    e.movement_pattern, e.tracking_mode
  FROM workout_routine_exercises wre
  JOIN workout_routines wr ON wre.workout_routine_uuid = wr.uuid
  JOIN workout_plans wp ON wr.workout_plan_uuid = wp.uuid
  JOIN exercises e ON wre.exercise_uuid = e.uuid
  WHERE wp.uuid IN (${Q2}, ${Q3})
  ORDER BY e.title
`;

function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

const needs = [];
for (const r of rows) {
  const steps = parseArr(r.steps);
  const tips = parseArr(r.tips);
  const description = (r.description || '').trim();
  const missing = {
    description: !description,
    steps: steps.length === 0,
    tips: tips.length === 0,
  };
  if (missing.description || missing.steps || missing.tips) {
    needs.push({
      uuid: r.uuid,
      title: r.title,
      primary_muscles: parseArr(r.primary_muscles),
      secondary_muscles: parseArr(r.secondary_muscles),
      equipment: parseArr(r.equipment),
      movement_pattern: r.movement_pattern,
      tracking_mode: r.tracking_mode,
      existing: { description, steps, tips },
      missing,
    });
  }
}

writeFileSync('scripts/data/program-content-gaps.json', JSON.stringify(needs, null, 2));
console.log(`Wrote ${needs.length} entries to scripts/data/program-content-gaps.json`);
