// Apply hand-written description/steps/tips deltas to the exercises table.
//
// Reads scripts/data/program-content-deltas.json, validates each entry
// against the same length bounds the API enforces, and updates only the
// fields named in `delta`. Idempotent: re-running with an empty delta is
// a no-op. Use `--dry-run` to preview the queries.

import { Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) process.env[m[1]] ??= m[2];
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const dryRun = process.argv.includes('--dry-run');

const BOUNDS = {
  description: { maxLength: 280 },
  steps: { minItems: 3, maxItems: 8, itemMaxLength: 120 },
  tips: { minItems: 2, maxItems: 6, itemMaxLength: 100 },
};

function validate(entry) {
  const d = entry.delta || {};
  const errs = [];
  if ('description' in d) {
    if (typeof d.description !== 'string' || !d.description.trim()) errs.push('description empty');
    if (d.description.length > BOUNDS.description.maxLength) errs.push(`description ${d.description.length} > ${BOUNDS.description.maxLength}`);
  }
  for (const key of ['steps', 'tips']) {
    if (!(key in d)) continue;
    const arr = d[key];
    const b = BOUNDS[key];
    if (!Array.isArray(arr)) { errs.push(`${key} not array`); continue; }
    if (arr.length < b.minItems) errs.push(`${key} length ${arr.length} < ${b.minItems}`);
    if (arr.length > b.maxItems) errs.push(`${key} length ${arr.length} > ${b.maxItems}`);
    arr.forEach((item, i) => {
      if (typeof item !== 'string' || !item.trim()) errs.push(`${key}[${i}] empty`);
      if (item.length > b.itemMaxLength) errs.push(`${key}[${i}] ${item.length} > ${b.itemMaxLength}`);
    });
  }
  return errs;
}

const data = JSON.parse(readFileSync('scripts/data/program-content-deltas.json', 'utf-8'));

let okCount = 0, errCount = 0;
for (const entry of data) {
  const errs = validate(entry);
  if (errs.length) {
    console.error(`✗ ${entry.title} (${entry.uuid})`);
    errs.forEach(e => console.error('    ' + e));
    errCount++;
    continue;
  }
  if (dryRun) {
    console.log(`✓ ${entry.title} — would update keys: ${Object.keys(entry.delta).join(', ')}`);
    okCount++;
    continue;
  }
  const d = entry.delta;
  // Build a dynamic update — only set columns present in delta.
  // neon serverless-driver doesn't have a tagged-template "set" helper,
  // so build separate queries for each combination.
  const sets = [];
  const params = [];
  if ('description' in d) { sets.push(`description = $${params.length + 1}`); params.push(d.description); }
  if ('steps' in d)       { sets.push(`steps = $${params.length + 1}::jsonb`); params.push(JSON.stringify(d.steps)); }
  if ('tips' in d)        { sets.push(`tips = $${params.length + 1}::jsonb`);  params.push(JSON.stringify(d.tips)); }
  sets.push(`updated_at = NOW()`);
  const sqlText = `UPDATE exercises SET ${sets.join(', ')} WHERE uuid = $${params.length + 1}`;
  params.push(entry.uuid);
  try {
    await pool.query(sqlText, params);
    console.log(`✓ ${entry.title} — updated ${Object.keys(d).join(', ')}`);
    okCount++;
  } catch (err) {
    console.error(`✗ ${entry.title} — update failed: ${err.message}`);
    errCount++;
  }
}

await pool.end();
console.log(`\nDone: ${okCount} updated, ${errCount} errors${dryRun ? ' (dry run, no changes written)' : ''}`);
process.exit(errCount > 0 ? 1 : 0);
