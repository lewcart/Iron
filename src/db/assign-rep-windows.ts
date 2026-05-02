// One-shot assignment script: walks every workout_routine_exercise and writes
// a goal_window based on:
//   1. Movement-pattern heuristics (compound vs accessory vs isolation)
//   2. Current set-level min/max_repetitions when present (snap or nearest)
//   3. The hypertrophy-primary bias (most accessories → Build)
//
// Conservative — never overwrites an existing non-null goal_window. Skips
// time-mode exercises. Run once, review via `bun run db:audit-routines`,
// adjust via the UI per-exercise as needed.
//
// Run via: bun run db:assign-rep-windows

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env' });
dotenvConfig({ path: '.env.local', override: true });

import { query } from './db';
import type { RepWindow } from '../lib/rep-windows';

interface Row {
  uuid: string;
  exercise_uuid: string;
  exercise_title: string;
  current_goal: string | null;
  tracking_mode: string | null;
  min_rep: number | null;
  max_rep: number | null;
}

// Movement-pattern keyword → window (bias toward Build for hypertrophy goal).
// First match wins, so list more specific patterns before broad ones.
const PATTERN_RULES: Array<[RegExp, RepWindow]> = [
  // Heavy bilateral compounds — Power (6–8) for strength carryover
  [/^hip thrust \(barbell\)(?! —)/i, 'power'],     // base bb hip thrust
  [/^bench press(?!:)/i, 'power'],
  [/^deadlift\b/i, 'power'],
  [/^squat\b/i, 'power'],
  [/^hack squat/i, 'power'],
  [/overhead press \(standing\)/i, 'power'],

  // Stable machine compounds — Build (8–12)
  [/leg press/i, 'build'],
  [/^pulldown/i, 'build'],
  [/^row\b|^seated cable row|chest-supported|cable.*row|cable \(seated\)/i, 'build'],
  [/^chest press/i, 'build'],
  [/^flyes:|^flyes\b/i, 'build'],

  // Stability / unilateral — Build, form breaks before strength does
  [/single leg rdl|single-leg rdl/i, 'build'],
  [/bulgarian split squat/i, 'build'],
  [/step-up|step up/i, 'build'],
  [/copenhagen/i, 'build'],
  [/glute.*kick|cable kickback|kick back/i, 'build'],
  [/single leg.*press|leg press \(single/i, 'build'],

  // Posterior chain — Build
  [/romanian deadlift|^rdl\b/i, 'build'],
  [/cable pull[- ]?through/i, 'build'],
  [/ghd hip extension/i, 'build'],

  // Hamstring isolation — Build
  [/leg curl/i, 'build'],

  // Quad isolation — Build
  [/leg extension/i, 'build'],

  // Glute isolation
  [/hip abduction|hip adduction/i, 'pump'],          // light, high-rep glute med
  [/cable hip|machine hip/i, 'pump'],

  // Calves — Pump
  [/calf|donkey calf/i, 'pump'],

  // Shoulder isolation — Pump (low-load high-rep work)
  [/lateral raise|y-raise|rear delt fly/i, 'pump'],
  [/face pull/i, 'pump'],

  // Arms — Build
  [/biceps curl|hammer curl|^curl\b/i, 'build'],
  [/triceps extension|tricep|skullcrush/i, 'build'],
  [/pulldown.*straight|straight arm pulldown/i, 'build'],

  // Core (rep-mode) — Pump (high-rep is the convention)
  [/^crunch|machine crunch|ab wheel/i, 'pump'],

  // Rehab / prehab — Pump (light weight, high reps)
  [/external rotation|internal rotation|prehab|chin tuck|wall slide/i, 'pump'],

  // Hip thrust banded variant — Pump (volume work)
  [/hip thrust.*banded pulse|banded pulse/i, 'pump'],
];

/** Snap a (min, max) range to the closest registered window. Falls back to
 *  Build (the most common hypertrophy default) if neither bound matches. */
function nearestWindowForRange(min: number, max: number): RepWindow {
  const center = (min + max) / 2;
  if (center <= 6) return 'strength';
  if (center <= 8) return 'power';
  if (center <= 12) return 'build';
  if (center <= 15) return 'pump';
  return 'pump'; // anything else gets snapped down — endurance is catch-only
}

function decideWindow(row: Row): RepWindow | null {
  if (row.tracking_mode === 'time') return null; // skip time-mode

  // 1. Pattern-match the title first — strongest signal
  for (const [re, win] of PATTERN_RULES) {
    if (re.test(row.exercise_title)) return win;
  }

  // 2. Fall back to current min/max if both present
  if (row.min_rep != null && row.max_rep != null) {
    return nearestWindowForRange(row.min_rep, row.max_rep);
  }

  // 3. Default — Build (hypertrophy-primary)
  return 'build';
}

async function assign(): Promise<void> {
  // Pull one row per routine_exercise with the *first* set's reps as a hint
  // (we don't snap on per-set variance here — the audit script already shows
  // mixed cases as "review me").
  const rows = await query<Row>(
    `SELECT
       wre.uuid,
       wre.exercise_uuid,
       e.title AS exercise_title,
       wre.goal_window AS current_goal,
       e.tracking_mode,
       (SELECT min_repetitions FROM workout_routine_sets WHERE workout_routine_exercise_uuid = wre.uuid ORDER BY order_index LIMIT 1) AS min_rep,
       (SELECT max_repetitions FROM workout_routine_sets WHERE workout_routine_exercise_uuid = wre.uuid ORDER BY order_index LIMIT 1) AS max_rep
     FROM workout_routine_exercises wre
     JOIN exercises e ON e.uuid = wre.exercise_uuid`,
  );

  let assigned = 0;
  let skipped = 0;
  let already = 0;
  const counts: Record<string, number> = {};

  for (const r of rows) {
    if (r.current_goal) {
      already++;
      continue;
    }
    const win = decideWindow(r);
    if (win == null) {
      skipped++;
      continue;
    }

    await query(
      `UPDATE workout_routine_exercises
       SET goal_window = $1, updated_at = NOW()
       WHERE uuid = $2`,
      [win, r.uuid],
    );
    assigned++;
    counts[win] = (counts[win] ?? 0) + 1;
  }

  console.log(`Assigned: ${assigned}`);
  console.log(`Already had goal_window: ${already}`);
  console.log(`Skipped (time-mode): ${skipped}`);
  console.log('By window:');
  for (const w of ['strength', 'power', 'build', 'pump', 'endurance'] as const) {
    if (counts[w]) console.log(`  ${w.padEnd(10)} ${counts[w]}`);
  }
  process.exit(0);
}

assign().catch(err => {
  console.error('Assignment failed:', err);
  process.exit(1);
});
