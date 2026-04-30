#!/usr/bin/env node
// Apply scripts/data/exercise-image-manifest.json (the source of truth for
// "which UUIDs have how many bundled frames") to:
//   1. Postgres (DATABASE_URL): UPDATE exercises SET image_count=$1 WHERE uuid=$2
//   2. public/exercises-catalog.json: bake the count into the bundled seed
//      so first-install hydration sees the right values without waiting for
//      the first sync pull.
//
// Idempotent. Safe to re-run after every batch of image generations.
//
// Usage:
//   node scripts/db-apply-image-counts.mjs

import { neon } from '@neondatabase/serverless';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
config({ path: join(ROOT, '.env.local') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const MANIFEST_PATH = join(ROOT, 'scripts/data/exercise-image-manifest.json');
const CATALOG_PATH = join(ROOT, 'public/exercises-catalog.json');

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
const entries = Object.entries(manifest).filter(([, count]) => count > 0);

console.log(`Applying ${entries.length} image_count updates...`);

const sql = neon(url);

let pgUpdated = 0;
for (const [uuid, count] of entries) {
  const rows = await sql`
    UPDATE exercises SET image_count = ${count}, updated_at = NOW()
    WHERE uuid = ${uuid.toLowerCase()}
    RETURNING uuid
  `;
  if (rows.length > 0) pgUpdated++;
}

console.log(`Postgres: ${pgUpdated}/${entries.length} rows updated`);

// Now regenerate the bundled catalog JSON so fresh-install hydration
// sees the same image_count without needing to sync first.
const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'));
let jsonUpdated = 0;
for (const row of catalog) {
  const count = manifest[row.uuid];
  if (count && count > 0 && row.image_count !== count) {
    row.image_count = count;
    jsonUpdated++;
  }
  // Also ensure the field exists with a default on every row, even ones
  // not in the manifest (otherwise old catalog entries lack the field
  // and bundled hydration leaves image_count undefined).
  if (row.image_count === undefined) row.image_count = 0;
  if (row.youtube_url === undefined) row.youtube_url = null;
  if (row.image_urls === undefined) row.image_urls = null;
}
writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Catalog JSON: ${jsonUpdated} rows updated, defaults backfilled on the rest`);

console.log('Done.');
