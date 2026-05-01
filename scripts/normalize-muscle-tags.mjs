#!/usr/bin/env node
/**
 * One-shot rewrite of bundled exercise catalogs to use canonical muscle slugs.
 *
 * Targets two files with different schemas:
 *   - src/db/exercises.json          (Everkinetic source: primary/secondary)
 *   - public/exercises-catalog.json  (DB-row dump: primary_muscles/secondary_muscles)
 *
 * Synonym map is duplicated from src/db/migrations/026_canonical_muscles.sql.
 * If you edit the synonym map there, mirror it here and re-run this script.
 *
 * Run: node scripts/normalize-muscle-tags.mjs
 *
 * Exits non-zero if any value can't be mapped (so commits don't include silent
 * data loss).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ─── Synonym map (must mirror migration 026) ─────────────────────────────────

const SYNONYMS = {
  // chest
  'chest': 'chest',
  'pectoralis major': 'chest',
  'pectorals': 'chest',
  'pecs': 'chest',
  // lats
  'lats': 'lats',
  'latissimus dorsi': 'lats',
  'latissimus': 'lats',
  // rhomboids
  'rhomboids': 'rhomboids',
  // mid/lower traps. trapezius defaults to mid_traps; audit pass refines.
  'mid_traps': 'mid_traps',
  'mid traps': 'mid_traps',
  'trapezius': 'mid_traps',
  'lower_traps': 'lower_traps',
  'lower traps': 'lower_traps',
  // erectors
  'erectors': 'erectors',
  'erector spinae': 'erectors',
  'lower back': 'erectors',
  // delts
  'delts': 'delts',
  'deltoid': 'delts',
  'deltoids': 'delts',
  'shoulders': 'delts',
  // rotator cuff
  'rotator_cuff': 'rotator_cuff',
  'rotator cuff': 'rotator_cuff',
  // biceps
  'biceps': 'biceps',
  'biceps brachii': 'biceps',
  // triceps
  'triceps': 'triceps',
  'triceps brachii': 'triceps',
  // forearms
  'forearms': 'forearms',
  'forearm': 'forearms',
  'forerm': 'forearms', // typo in seed data
  // core
  'core': 'core',
  'abdominals': 'core',
  'abs': 'core',
  'obliques': 'core',
  // glutes
  'glutes': 'glutes',
  'glutaeus maximus': 'glutes',
  'gluteus maximus': 'glutes',
  // quads
  'quads': 'quads',
  'quadriceps': 'quads',
  // hamstrings
  'hamstrings': 'hamstrings',
  'ischiocrural muscles': 'hamstrings',
  // hip abductors / adductors. tensor fasciae latae → hip_abductors per role.
  'hip_abductors': 'hip_abductors',
  'hip abductors': 'hip_abductors',
  'tensor fasciae latae': 'hip_abductors',
  'hip_adductors': 'hip_adductors',
  'hip adductors': 'hip_adductors',
  // calves
  'calves': 'calves',
  'gastrocnemius': 'calves',
  'soleus': 'calves',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const unmapped = new Set();

function mapMuscle(value) {
  const slug = SYNONYMS[value];
  if (!slug) {
    unmapped.add(value);
    return null;
  }
  return slug;
}

function mapArray(arr) {
  if (!Array.isArray(arr)) return [];
  const out = new Set();
  for (const v of arr) {
    const slug = mapMuscle(v);
    if (slug) out.add(slug);
  }
  return [...out].sort();
}

// ─── Rewrite source files ────────────────────────────────────────────────────

function rewriteSrcCatalog() {
  const path = join(ROOT, 'src/db/exercises.json');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  let changed = 0;

  for (const ex of data) {
    const before = JSON.stringify({ p: ex.primary, s: ex.secondary });
    ex.primary = mapArray(ex.primary);
    ex.secondary = mapArray(ex.secondary);
    if (JSON.stringify({ p: ex.primary, s: ex.secondary }) !== before) changed++;
  }

  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ src/db/exercises.json: ${data.length} rows total, ${changed} muscle arrays rewritten`);
  return data.length;
}

function rewritePublicCatalog() {
  const path = join(ROOT, 'public/exercises-catalog.json');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  let changed = 0;

  for (const ex of data) {
    const before = JSON.stringify({ p: ex.primary_muscles, s: ex.secondary_muscles });
    ex.primary_muscles = mapArray(ex.primary_muscles);
    ex.secondary_muscles = mapArray(ex.secondary_muscles);
    if (JSON.stringify({ p: ex.primary_muscles, s: ex.secondary_muscles }) !== before) changed++;
  }

  // Match the existing minified format (single line, no trailing newline).
  writeFileSync(path, JSON.stringify(data));
  console.log(`✓ public/exercises-catalog.json: ${data.length} rows total, ${changed} muscle arrays rewritten`);
  return data.length;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const srcCount = rewriteSrcCatalog();
const publicCount = rewritePublicCatalog();

if (unmapped.size > 0) {
  console.error('');
  console.error(`✗ FAIL: ${unmapped.size} muscle value(s) had no synonym mapping:`);
  for (const v of [...unmapped].sort()) console.error(`    "${v}"`);
  console.error('');
  console.error('Add them to SYNONYMS above AND to muscle_synonyms in migration 026.');
  process.exit(1);
}

console.log(`✓ All values mapped to canonical slugs.`);
console.log(`  Source rows: ${srcCount}, public rows: ${publicCount}.`);
