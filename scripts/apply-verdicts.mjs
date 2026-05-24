// Apply authoritative review verdicts from image-verdicts.json onto the live
// image-review.json state. Run ONLY when no gen/regen process is writing the
// state file (avoids the concurrent-write race). pass clears next_notes; fail
// sets next_notes so --regen picks it up.

import { readFileSync, writeFileSync } from 'fs';

const REVIEW_PATH = 'scripts/data/image-review.json';
const VERDICTS_PATH = 'scripts/data/image-verdicts.json';

const state = JSON.parse(readFileSync(REVIEW_PATH, 'utf-8'));
// Accept one or more verdicts files on the command line; default to the
// round-1 file. Later files override earlier ones for the same uuid.
const files = process.argv.slice(2).filter(a => a.endsWith('.json'));
const sources = files.length ? files : [VERDICTS_PATH];
const verdicts = sources.flatMap(f => JSON.parse(readFileSync(f, 'utf-8')).verdicts);

let applied = 0, missing = 0;
for (const v of verdicts) {
  const e = state[v.uuid];
  if (!e) { console.error(`⚠ no state entry for ${v.title} (${v.uuid})`); missing++; continue; }
  if (v.review === 'fail' && (!v.notes || v.notes.length > 280)) {
    console.error(`⚠ ${v.title}: fail needs notes ≤280 chars (got ${v.notes?.length ?? 0})`);
    missing++; continue;
  }
  e.review = v.review;
  e.next_notes = v.review === 'fail' ? v.notes : null;
  applied++;
}
writeFileSync(REVIEW_PATH, JSON.stringify(state, null, 2));

const counts = {};
for (const e of Object.values(state)) counts[e.review] = (counts[e.review] || 0) + 1;
console.log(`Applied ${applied} verdicts (${missing} skipped).`);
console.log('State now:', JSON.stringify(counts));
