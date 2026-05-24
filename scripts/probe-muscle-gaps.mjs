import { Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf-8');
for (const l of env.split('\n')){const m=l.match(/^([A-Z_]+)="?([^"]*)"?$/);if(m)process.env[m[1]]??=m[2];}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const Q2='4d31af5f-edf2-4bb6-b272-5d90959f919b', Q3='6621e65a-a617-4205-89f9-443ccdf5c92d';
const r = await pool.query(`
  SELECT DISTINCT e.uuid, e.title, e.primary_muscles, e.secondary_muscles, e.equipment, e.movement_pattern
  FROM workout_routine_exercises wre
  JOIN workout_routines wr ON wre.workout_routine_uuid = wr.uuid
  JOIN workout_plans wp ON wr.workout_plan_uuid = wp.uuid
  JOIN exercises e ON wre.exercise_uuid = e.uuid
  WHERE wp.uuid IN ($1,$2)
  ORDER BY e.title`, [Q2,Q3]);
function arr(v){return Array.isArray(v)?v:(typeof v==='string'?JSON.parse(v||'[]'):[]);}
let n=0;
for (const row of r.rows){
  const pm=arr(row.primary_muscles);
  if (pm.length===0){
    n++;
    console.log(`${row.title}  | sec=${JSON.stringify(arr(row.secondary_muscles))} equip=${JSON.stringify(arr(row.equipment))} mp=${row.movement_pattern}  | ${row.uuid}`);
  }
}
console.log(`\n${n} Q2+Q3 exercises with EMPTY primary_muscles (no muscle map)`);
await pool.end();
