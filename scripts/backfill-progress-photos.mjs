// Backfill progress_photos from the Notion "Body" database.
//
// Reads scripts/data/body-measurements.json (page_id list) and for each entry:
//   1. Fetches the page from the Notion API to get fresh signed URLs
//      (the URLs in the JSON file are stale — Notion file URLs expire in ~1hr).
//   2. Downloads each image.
//   3. Uploads to Vercel Blob.
//   4. INSERTs a progress_photos row.
//
// Pose: defaults to 'front'. Notion data has no pose tagging, and most entries
// have 4-5 photos (likely front/side/back/extra) — manually re-classify in-app
// after import if you care.
//
// Idempotency: uses notes='notion:<page_id>:<attachment_id>' as a marker.
// Re-runs skip rows where that marker already exists.
//
// Env required:
//   DATABASE_URL          (.env.local)  — Postgres
//   BLOB_READ_WRITE_TOKEN (.env.local)  — Vercel Blob
//   NOTION_TOKEN          — Notion integration secret with read access to the Body DB
//
// Usage:
//   NOTION_TOKEN=secret_xxx node scripts/backfill-progress-photos.mjs           # dry run
//   NOTION_TOKEN=secret_xxx node scripts/backfill-progress-photos.mjs --apply

import { neon } from '@neondatabase/serverless';
import { put } from '@vercel/blob';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../.env.local') });

const dbUrl = process.env.DATABASE_URL;
const notionToken = process.env.NOTION_TOKEN;
if (!dbUrl) { console.error('Missing DATABASE_URL in .env.local'); process.exit(1); }
if (!notionToken) {
  console.error('Missing NOTION_TOKEN. Create a Notion internal integration with read access to the Body DB and set NOTION_TOKEN.');
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Missing BLOB_READ_WRITE_TOKEN in .env.local');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const dataPath = join(__dirname, 'data/body-measurements.json');
const entries = JSON.parse(readFileSync(dataPath, 'utf-8'));

const sql = neon(dbUrl);

const NOTION_VERSION = '2022-06-28';
const DEFAULT_POSE = 'front';

// Build the set of already-imported markers so we can skip them.
const existing = await sql`
  SELECT notes FROM progress_photos WHERE notes LIKE 'notion:%'
`;
const existingMarkers = new Set(existing.map(r => r.notes));

let plannedCount = 0;
let skippedExisting = 0;
let inserted = 0;
let failed = 0;

for (const entry of entries) {
  if (!entry.photos || entry.photos.length === 0) continue;

  // Filter to attachments not already imported
  const todo = entry.photos.filter(p => {
    const marker = `notion:${entry.page_id}:${p.attachment_id}`;
    if (existingMarkers.has(marker)) { skippedExisting++; return false; }
    return true;
  });
  if (todo.length === 0) continue;

  plannedCount += todo.length;
  if (!apply) {
    console.log(`${entry.entry_date}: would import ${todo.length} photo(s) from page ${entry.page_id}`);
    continue;
  }

  // Fetch the page to get fresh signed URLs.
  let page;
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${entry.page_id}`, {
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': NOTION_VERSION,
      },
    });
    if (!res.ok) {
      console.warn(`Failed to fetch page ${entry.page_id}: ${res.status}`);
      failed += todo.length;
      continue;
    }
    page = await res.json();
  } catch (e) {
    console.warn(`Error fetching page ${entry.page_id}: ${e.message}`);
    failed += todo.length;
    continue;
  }

  const photosProp = page.properties?.Photos?.files ?? [];
  // Map filename -> file URL (Notion API gives a list of file objects)
  const urlByFilename = new Map();
  for (const f of photosProp) {
    const url = f.file?.url ?? f.external?.url;
    if (url && f.name) urlByFilename.set(f.name, url);
  }

  for (const p of todo) {
    const marker = `notion:${entry.page_id}:${p.attachment_id}`;
    const url = urlByFilename.get(p.filename);
    if (!url) {
      console.warn(`No fresh URL for ${entry.entry_date}/${p.filename} — skipping`);
      failed++;
      continue;
    }

    try {
      const imgRes = await fetch(url);
      if (!imgRes.ok) throw new Error(`fetch ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const ext = p.filename.split('.').pop() ?? 'jpg';
      const blob = await put(
        `progress-photos/${randomUUID()}-${DEFAULT_POSE}.${ext}`,
        buf,
        { access: 'public', contentType: imgRes.headers.get('content-type') ?? 'image/jpeg' },
      );

      await sql`
        INSERT INTO progress_photos (uuid, blob_url, pose, notes, taken_at)
        VALUES (${randomUUID()}, ${blob.url}, ${DEFAULT_POSE}, ${marker}, ${entry.entry_date}::TIMESTAMP)
      `;
      inserted++;
      console.log(`  ✓ ${entry.entry_date}/${p.filename} → ${blob.url}`);
    } catch (e) {
      console.warn(`  ✗ ${entry.entry_date}/${p.filename}: ${e.message}`);
      failed++;
    }
  }
}

console.log(`\nPlanned: ${plannedCount}, already-imported: ${skippedExisting}, inserted: ${inserted}, failed: ${failed}`);
if (!apply) console.log('Re-run with --apply to actually upload + insert.');
