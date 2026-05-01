#!/usr/bin/env node
/**
 * AI-assisted exercise muscle audit (Phase 1 step 6 of sets-per-muscle plan).
 *
 * Reads every exercise from Postgres, asks GPT-4o-mini to classify its
 * primary + secondary muscles against the canonical 18-slug list, and writes
 * a CSV diff to ~/.gstack/projects/lewcart-Iron/exercise-muscle-audit-{ts}.csv.
 *
 * Lewis reviews the CSV, flags any rows where proposed differs from current
 * and the LLM is wrong, then hand-writes migration 024_exercise_muscle_audit.sql
 * with explicit UUID-keyed UPDATEs to apply the approved changes.
 *
 * Cost: roughly $0.30 for ~200 exercises via gpt-4o-mini (structured-output mode,
 * ~250-token prompts, ~80-token responses).
 *
 * Run: OPENAI_API_KEY=sk-... node scripts/audit-exercise-muscles.mjs
 *      (or set OPENAI_API_KEY in .env.local)
 *
 * Flags:
 *   --limit N      classify only the first N exercises (testing)
 *   --slug SLUG    classify only exercises currently tagged with SLUG
 *   --dry-run      use a stub classifier (no API calls); useful for CSV format testing
 */

import { neon } from '@neondatabase/serverless';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
config({ path: join(ROOT, '.env.local') });

// ─── Args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitFlag = args.indexOf('--limit');
const limit = limitFlag >= 0 ? Number(args[limitFlag + 1]) : null;
const slugFlag = args.indexOf('--slug');
const filterSlug = slugFlag >= 0 ? args[slugFlag + 1] : null;

// ─── DB ──────────────────────────────────────────────────────────────────────

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}
const sql = neon(url);

// ─── OpenAI ──────────────────────────────────────────────────────────────────

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey && !dryRun) {
  console.error('Missing OPENAI_API_KEY (or pass --dry-run for CSV format testing)');
  process.exit(1);
}

// gpt-4o-mini — same tier as Claude Haiku: cheap, fast, accurate at JSON
// classification. Model name kept stable; bump if a successor is preferred.
const MODEL = 'gpt-4o-mini';

const CANONICAL_SLUGS = [
  'chest', 'lats', 'rhomboids', 'mid_traps', 'lower_traps', 'erectors',
  'delts', 'rotator_cuff', 'biceps', 'triceps', 'forearms', 'core',
  'glutes', 'quads', 'hamstrings', 'hip_abductors', 'hip_adductors', 'calves',
];

async function classify({ title, description, equipment, currentPrimary, currentSecondary }) {
  if (dryRun) {
    return {
      primary: currentPrimary,
      secondary: currentSecondary,
      confidence: 'low',
      reasoning: 'dry-run stub',
    };
  }

  const systemPrompt = `You classify resistance exercises into a fixed canonical muscle taxonomy. Reply with JSON only — no prose, no code fences.

Taxonomy (use ONLY these 18 slugs):
${CANONICAL_SLUGS.join(', ')}

Rules:
- primary MUST be non-empty and contain only canonical slugs (1–3 prime movers).
- secondary may be empty (0–4 meaningful synergists/stabilizers).
- A muscle never appears in both primary and secondary — pick one.
- "trapezius" defaults to mid_traps unless the movement is clearly a lower-trap exercise (Y-raises, prone reverse fly) or rear-delt focused (which routes to delts, not traps).
- Rear-delt exercises tag delts (rear-delt component) and rotator_cuff (synergistic external rotators), NOT mid_traps.
- Hip abductor exercises (lateral leg raises, clamshells, banded walks) tag hip_abductors as primary.
- "lower back" → erectors. "abs" / "obliques" → core. Calf raises → calves.
- Forearm-grip-dominant work (farmer's carries, dead hangs) tags forearms primary.
- Be conservative — if uncertain about a synergist, omit it. Confidence "low" when current tags look right but description is sparse.`;

  const userPrompt = `EXERCISE:
- Title: ${title}
- Description: ${description ?? '(none)'}
- Equipment: ${(equipment ?? []).join(', ') || '(none)'}
- Currently tagged primary: ${JSON.stringify(currentPrimary)}
- Currently tagged secondary: ${JSON.stringify(currentSecondary)}

Respond with JSON: { "primary": [...], "secondary": [...], "confidence": "high"|"medium"|"low", "reasoning": "<one sentence>" }`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      max_tokens: 400,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error(`Empty response: ${JSON.stringify(data).slice(0, 200)}`);

  const parsed = JSON.parse(text);
  return {
    primary: Array.isArray(parsed.primary) ? parsed.primary : [],
    secondary: Array.isArray(parsed.secondary) ? parsed.secondary : [],
    confidence: parsed.confidence ?? 'low',
    reasoning: parsed.reasoning ?? '',
  };
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

function csvEscape(value) {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cols) {
  return cols.map(csvEscape).join(',');
}

function arraysEqualUnordered(a, b) {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const v of b) if (!setA.has(v)) return false;
  return true;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Validate the canonical 18-slug set is what we expect (sanity check vs DB).
  const canonicalRows = await sql`SELECT slug FROM muscles ORDER BY display_order`;
  if (canonicalRows.length !== 18) {
    console.warn(`WARN: muscles table has ${canonicalRows.length} rows; expected 18.`);
  }
  const canonicalSet = new Set(canonicalRows.map(r => r.slug));

  // Fetch exercises. Filter by slug if requested.
  let exercises;
  if (filterSlug) {
    exercises = await sql`
      SELECT uuid, title, description, equipment, primary_muscles, secondary_muscles
      FROM exercises
      WHERE is_hidden = false
        AND (primary_muscles @> ${JSON.stringify([filterSlug])}::jsonb
             OR secondary_muscles @> ${JSON.stringify([filterSlug])}::jsonb)
      ORDER BY title
    `;
  } else {
    exercises = await sql`
      SELECT uuid, title, description, equipment, primary_muscles, secondary_muscles
      FROM exercises
      WHERE is_hidden = false
      ORDER BY title
    `;
  }
  if (limit) exercises = exercises.slice(0, limit);

  console.log(`Classifying ${exercises.length} exercises${dryRun ? ' (dry-run)' : ''}…`);

  // Output path.
  const outDir = join(homedir(), '.gstack/projects/lewcart-Iron');
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = join(outDir, `exercise-muscle-audit-${ts}.csv`);

  const rows = [
    csvRow([
      'uuid',
      'title',
      'current_primary',
      'proposed_primary',
      'primary_changed',
      'current_secondary',
      'proposed_secondary',
      'secondary_changed',
      'confidence',
      'reasoning',
    ]),
  ];

  let i = 0;
  let errorCount = 0;
  for (const ex of exercises) {
    i++;
    if (i % 25 === 0) console.log(`  ${i}/${exercises.length}…`);
    const currentPrimary = Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [];
    const currentSecondary = Array.isArray(ex.secondary_muscles) ? ex.secondary_muscles : [];

    let result;
    try {
      result = await classify({
        title: ex.title,
        description: ex.description,
        equipment: ex.equipment,
        currentPrimary,
        currentSecondary,
      });
    } catch (err) {
      errorCount++;
      console.warn(`  [error] ${ex.title}: ${err.message}`);
      continue;
    }

    // Reject any non-canonical slugs from LLM output.
    const proposedPrimary = result.primary.filter(s => canonicalSet.has(s));
    const proposedSecondary = result.secondary.filter(s => canonicalSet.has(s));

    if (proposedPrimary.length === 0) {
      // LLM failed to give a valid primary; keep current as the safe default.
      console.warn(`  [no-primary] ${ex.title} — keeping current`);
      proposedPrimary.push(...currentPrimary);
    }

    rows.push(
      csvRow([
        ex.uuid,
        ex.title,
        currentPrimary.join('|'),
        proposedPrimary.join('|'),
        arraysEqualUnordered(currentPrimary, proposedPrimary) ? '' : 'CHANGED',
        currentSecondary.join('|'),
        proposedSecondary.join('|'),
        arraysEqualUnordered(currentSecondary, proposedSecondary) ? '' : 'CHANGED',
        result.confidence,
        result.reasoning,
      ])
    );
  }

  writeFileSync(outPath, rows.join('\n') + '\n');
  console.log('');
  console.log(`✓ Wrote ${exercises.length - errorCount} rows to:`);
  console.log(`  ${outPath}`);
  if (errorCount > 0) console.log(`  (${errorCount} errors skipped — re-run with --slug to retry subsets)`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Open the CSV in a spreadsheet, sort by primary_changed=CHANGED then by confidence desc.');
  console.log('  2. Eyeball changes; flag any wrong proposals.');
  console.log('  3. Apply approved changes via a hand-written migration 024_exercise_muscle_audit.sql.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
