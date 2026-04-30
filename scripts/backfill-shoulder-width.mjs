// Backfill measurement_logs.site='shoulder_width' from scripts/data/body-measurements.json
// (data sourced from the Notion "Body" database via MCP).
//
// Usage:
//   node scripts/backfill-shoulder-width.mjs           # dry run
//   node scripts/backfill-shoulder-width.mjs --apply   # actually writes to DB
//
// What it does:
//   1. Renames any legacy site='shoulders' rows to site='shoulder_width'
//      (one-shot migration; idempotent — only matches the legacy literal).
//   2. Inserts shoulder cir from Notion as new site='shoulder_width' rows.
//      Skips entries with null/implausible (<60cm or >130cm) values.
//      Skips dates that already have a shoulder_width row in the DB so
//      MCP-logged history isn't duplicated by the Notion backfill.
//
// Inserts use source='notion_body_db' and source_ref=<notion page_id> so
// re-runs are idempotent against prior backfill runs as well.

import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../.env.local') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Missing DATABASE_URL in .env.local');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const dataPath = join(__dirname, 'data/body-measurements.json');
const entries = JSON.parse(readFileSync(dataPath, 'utf-8'));

const SOURCE = 'notion_body_db';
const MIN_PLAUSIBLE_CM = 60;
const MAX_PLAUSIBLE_CM = 130;

const planned = [];
const skippedImplausible = [];
for (const e of entries) {
  if (e.shoulder_cir_cm == null) continue;
  const v = Number(e.shoulder_cir_cm);
  if (!Number.isFinite(v)) continue;
  if (v < MIN_PLAUSIBLE_CM || v > MAX_PLAUSIBLE_CM) {
    skippedImplausible.push({ date: e.entry_date, value: v, page_id: e.page_id });
    continue;
  }
  planned.push({
    isoDate: e.entry_date,
    value: v,
    sourceRef: e.page_id,
  });
}

console.log(`Loaded ${entries.length} entries from JSON`);
console.log(`${planned.length} have valid shoulder cir (${MIN_PLAUSIBLE_CM}-${MAX_PLAUSIBLE_CM} cm range)`);
if (skippedImplausible.length > 0) {
  console.log(`Skipping ${skippedImplausible.length} implausible:`);
  for (const s of skippedImplausible) {
    console.log(`  ${s.date}: ${s.value} cm (page ${s.page_id})`);
  }
}

const sql = neon(url);

// Step 0: count legacy 'shoulders' rows that need migration
const legacyRows = await sql`
  SELECT uuid, value_cm, measured_at FROM measurement_logs WHERE site = 'shoulders'
`;
console.log(`\nLegacy rows with site='shoulders': ${legacyRows.length}`);

// Step 1: find which Notion source_refs are already imported (idempotency)
const alreadyImported = await sql`
  SELECT source_ref FROM measurement_logs
  WHERE site = 'shoulder_width' AND source = ${SOURCE}
`;
const importedRefs = new Set(alreadyImported.map(r => r.source_ref));

// Step 2: find which dates already have ANY shoulder_width row (after migration
// will include the legacy 'shoulders' rows). We block inserts on date collisions
// to avoid duplicating MCP-logged values.
const existingDates = await sql`
  SELECT DISTINCT (measured_at::DATE)::TEXT AS day
  FROM measurement_logs
  WHERE site IN ('shoulder_width', 'shoulders')
`;
const existingDaySet = new Set(existingDates.map(r => r.day));

const toInsert = [];
const skippedAlreadyImported = [];
const skippedDateCollision = [];
for (const p of planned) {
  if (importedRefs.has(p.sourceRef)) {
    skippedAlreadyImported.push(p);
    continue;
  }
  if (existingDaySet.has(p.isoDate)) {
    skippedDateCollision.push(p);
    continue;
  }
  toInsert.push(p);
}

console.log(`\nMigration plan:`);
console.log(`  Rename legacy 'shoulders' → 'shoulder_width': ${legacyRows.length} rows`);
console.log(`  Insert new (no collision):                    ${toInsert.length} rows`);
console.log(`  Skip — already imported by source_ref:        ${skippedAlreadyImported.length} rows`);
console.log(`  Skip — date already has a shoulder row:       ${skippedDateCollision.length} rows`);

if (!apply) {
  console.log('\nDry run. First 5 rows that would be inserted:');
  for (const p of toInsert.slice(0, 5)) {
    console.log(`  ${p.isoDate}: ${p.value} cm`);
  }
  if (skippedDateCollision.length > 0) {
    console.log('\nFirst 5 rows skipped due to existing shoulder data on same date:');
    for (const p of skippedDateCollision.slice(0, 5)) {
      console.log(`  ${p.isoDate}: ${p.value} cm (page ${p.sourceRef})`);
    }
  }
  console.log('\nRe-run with --apply to migrate + insert.');
  process.exit(0);
}

// Apply: migrate first, then insert.
const renamed = await sql`
  UPDATE measurement_logs SET site = 'shoulder_width' WHERE site = 'shoulders'
`;
console.log(`Renamed ${renamed.length ?? legacyRows.length} legacy rows`);

let inserted = 0;
for (const p of toInsert) {
  await sql`
    INSERT INTO measurement_logs (uuid, site, value_cm, measured_at, source, source_ref)
    VALUES (${randomUUID()}, 'shoulder_width', ${p.value}, ${p.isoDate}::TIMESTAMP, ${SOURCE}, ${p.sourceRef})
  `;
  inserted++;
}
console.log(`Inserted ${inserted} new rows`);
