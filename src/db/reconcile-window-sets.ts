// One-shot reconcile: for routine exercises that have goal_window set,
// rewrite their sets' min/max_repetitions to match the window. Run once
// after the auto-assignment to bring existing set-level targets into
// agreement with the assigned windows.
//
// Idempotent: re-running just rewrites the same values. Skips exercises
// with NULL goal_window so set-level overrides are preserved.
//
// Run via: npx tsx src/db/reconcile-window-sets.ts

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env' });
dotenvConfig({ path: '.env.local', override: true });

import { query } from './db';
import { REP_WINDOWS, REP_WINDOW_ORDER } from '../lib/rep-windows';

async function reconcile(): Promise<void> {
  let total = 0;
  for (const key of REP_WINDOW_ORDER) {
    const w = REP_WINDOWS[key];
    const result = await query(
      `UPDATE workout_routine_sets wrs
       SET min_repetitions = $1, max_repetitions = $2, updated_at = NOW()
       FROM workout_routine_exercises wre
       WHERE wrs.workout_routine_exercise_uuid = wre.uuid
         AND wre.goal_window = $3
       RETURNING wrs.uuid`,
      [w.min, w.max, key],
    );
    if (result.length > 0) {
      console.log(`  ${key}: rewrote ${result.length} sets to ${w.min}–${w.max}`);
      total += result.length;
    }
  }
  console.log(`\nTotal sets reconciled: ${total}`);
  process.exit(0);
}

reconcile().catch(err => {
  console.error('Reconcile failed:', err);
  process.exit(1);
});
