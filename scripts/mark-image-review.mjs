// Mark an image-review entry. Used by Claude after eyeballing the frames.
// Usage:
//   node scripts/mark-image-review.mjs <uuid> pass
//   node scripts/mark-image-review.mjs <uuid> fail "Corrective notes ≤280 chars"
// Re-running for the same uuid overwrites the prior verdict.

import { readFileSync, writeFileSync } from 'fs';

const REVIEW_PATH = 'scripts/data/image-review.json';
const [, , uuid, verdict, ...notesParts] = process.argv;
const notes = notesParts.join(' ').trim();

if (!uuid || !['pass', 'fail'].includes(verdict)) {
  console.error('Usage: mark-image-review.mjs <uuid> pass|fail [notes]');
  process.exit(1);
}
if (verdict === 'fail' && !notes) {
  console.error('Fail verdict requires notes (else regen will repeat the same mistake)');
  process.exit(1);
}
if (notes.length > 280) {
  console.error(`Notes too long (${notes.length} > 280 chars)`);
  process.exit(1);
}

const state = JSON.parse(readFileSync(REVIEW_PATH, 'utf-8'));
const entry = state[uuid];
if (!entry) {
  console.error(`No review entry for ${uuid} — has it been generated yet?`);
  process.exit(1);
}
entry.review = verdict;
entry.next_notes = verdict === 'fail' ? notes : null;
writeFileSync(REVIEW_PATH, JSON.stringify(state, null, 2));
console.log(`✓ ${entry.title} (${uuid}): ${verdict}${notes ? ` — notes: "${notes}"` : ''}`);
