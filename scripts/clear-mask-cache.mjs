// One-off: NULL out cached mask URLs on all photo tables so /photos/compare
// Outline mode regenerates them with the latest Swift mask format. Old PNGs
// in Vercel Blob become orphaned but are harmless. Run once after the
// silhouette mask format changes.
//
// Usage:
//   node scripts/clear-mask-cache.mjs

import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../.env.local') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Missing DATABASE_URL in .env.local');
  process.exit(1);
}
const sql = neon(url);

const tables = ['progress_photos', 'projection_photos', 'inspo_photos'];
for (const t of tables) {
  const before = await sql(`SELECT COUNT(*) FROM ${t} WHERE mask_url IS NOT NULL`);
  await sql(`UPDATE ${t} SET mask_url = NULL`);
  console.log(`${t}: cleared ${before[0].count} cached mask(s)`);
}
console.log('Done. Outline mode will re-segment on next view.');
