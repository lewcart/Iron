// Apply primary/secondary muscle tags + equipment + movement_pattern to
// exercises that were added to routines untagged (empty muscle arrays =
// no muscle map). Validates muscle slugs against the canonical 18-slug
// taxonomy. Run when no gen/sync process is writing the state.

import { Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) process.env[m[1]] ??= m[2];
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CANONICAL = new Set([
  'chest', 'lats', 'rhomboids', 'mid_traps', 'lower_traps', 'erectors',
  'delts', 'rotator_cuff', 'biceps', 'triceps', 'forearms', 'core',
  'glutes', 'quads', 'hamstrings', 'hip_abductors', 'hip_adductors', 'calves',
]);

const dryRun = process.argv.includes('--dry-run');
const data = JSON.parse(readFileSync('scripts/data/program-muscle-deltas.json', 'utf-8'));

let ok = 0, errs = 0;
for (const e of data) {
  const bad = [...e.primary_muscles, ...e.secondary_muscles].filter(s => !CANONICAL.has(s));
  if (bad.length) { console.error(`✗ ${e.title}: non-canonical slugs ${JSON.stringify(bad)}`); errs++; continue; }
  if (e.primary_muscles.length === 0) { console.error(`✗ ${e.title}: empty primary_muscles`); errs++; continue; }
  if (dryRun) { console.log(`✓ ${e.title} — would set primary=${JSON.stringify(e.primary_muscles)} sec=${JSON.stringify(e.secondary_muscles)} equip=${JSON.stringify(e.equipment)} mp=${e.movement_pattern}`); ok++; continue; }
  try {
    await pool.query(
      `UPDATE exercises
         SET primary_muscles = $1::jsonb, secondary_muscles = $2::jsonb,
             equipment = $3::jsonb, movement_pattern = $4, updated_at = NOW()
       WHERE uuid = $5`,
      [JSON.stringify(e.primary_muscles), JSON.stringify(e.secondary_muscles),
       JSON.stringify(e.equipment), e.movement_pattern, e.uuid],
    );
    console.log(`✓ ${e.title} — tagged`);
    ok++;
  } catch (err) {
    console.error(`✗ ${e.title}: ${err.message}`);
    errs++;
  }
}
await pool.end();
console.log(`\nDone: ${ok} ok, ${errs} errors${dryRun ? ' (dry run)' : ''}`);
process.exit(errs > 0 ? 1 : 0);
