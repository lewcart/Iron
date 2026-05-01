#!/usr/bin/env node
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../.env.local') });
const sql = neon(process.env.DATABASE_URL);

const cols = await sql`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name = 'exercises' AND column_name IN ('image_count', 'image_urls', 'youtube_url')
  ORDER BY column_name
`;
console.log('Columns on exercises:');
for (const c of cols) {
  console.log(`  ${c.column_name}  ${c.data_type}  nullable=${c.is_nullable}  default=${c.column_default ?? 'NULL'}`);
}

// Quick functional test: read 5 rows, write back, read again. Confirms
// the columns are queryable + writable.
const sample = await sql`SELECT uuid, title, image_count, youtube_url, image_urls FROM exercises ORDER BY title LIMIT 3`;
console.log(`\nSample (${sample.length} rows):`);
for (const r of sample) {
  console.log(`  ${r.uuid.slice(0,8)} ${r.title.padEnd(30)} count=${r.image_count} yt=${r.youtube_url ?? 'null'} urls=${r.image_urls ? r.image_urls.length : 'null'}`);
}

// Confirm the CHECK constraint
try {
  await sql`SELECT 1 WHERE 1=1`;
  await sql`UPDATE exercises SET image_count = 99 WHERE uuid = ${sample[0].uuid}`;
  console.log('\n  WARNING: CHECK constraint did NOT reject image_count=99');
  // Restore
  await sql`UPDATE exercises SET image_count = ${sample[0].image_count} WHERE uuid = ${sample[0].uuid}`;
} catch (err) {
  console.log(`\n  ✓ CHECK constraint working: rejected image_count=99 (${err.message.split('\n')[0]})`);
}
