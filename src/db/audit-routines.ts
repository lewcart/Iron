// Read-only audit: lists every routine exercise with its current set-level
// rep targets, the window those targets snap to (if any), and whether the
// exercise already has a goal_window assigned.
//
// Run via: bun run db:audit-routines
// No writes — just prints a grouped report so the user can confirm or
// re-target each exercise before the rep-window rollout sets goal_window.

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env' });
dotenvConfig({ path: '.env.local', override: true });

import { query } from './db';
import { snapToWindow, type RepWindow } from '../lib/rep-windows';

interface ExerciseAuditRow {
  routine_uuid: string;
  routine_title: string | null;
  plan_title: string | null;
  exercise_uuid: string;
  exercise_title: string;
  goal_window: string | null;
  set_count: number;
  reps_summary: string;        // e.g. "8-12" or "mixed (8-12, 6-8)"
  snapped_window: RepWindow | null;
  tracking_mode: 'reps' | 'time';
}

async function audit(): Promise<void> {
  const rows = await query<{
    routine_uuid: string;
    routine_title: string | null;
    plan_title: string | null;
    exercise_uuid: string;
    exercise_title: string;
    goal_window: string | null;
    tracking_mode: string | null;
    sets_json: string;
  }>(
    `SELECT
       wr.uuid AS routine_uuid,
       wr.title AS routine_title,
       wp.title AS plan_title,
       wre.exercise_uuid,
       e.title AS exercise_title,
       wre.goal_window,
       e.tracking_mode,
       COALESCE(
         json_agg(
           json_build_object(
             'min', wrs.min_repetitions,
             'max', wrs.max_repetitions,
             'duration', wrs.target_duration_seconds
           ) ORDER BY wrs.order_index
         ) FILTER (WHERE wrs.uuid IS NOT NULL),
         '[]'::json
       )::text AS sets_json
     FROM workout_routine_exercises wre
     JOIN workout_routines wr ON wr.uuid = wre.workout_routine_uuid
     LEFT JOIN workout_plans wp ON wp.uuid = wr.workout_plan_uuid
     JOIN exercises e ON e.uuid = wre.exercise_uuid
     LEFT JOIN workout_routine_sets wrs ON wrs.workout_routine_exercise_uuid = wre.uuid
     GROUP BY wr.uuid, wr.title, wp.title, wre.exercise_uuid, e.title, wre.goal_window, wre.order_index, e.tracking_mode, wre.uuid
     ORDER BY wp.title NULLS LAST, wr.title NULLS LAST, wre.order_index`,
  );

  const audited: ExerciseAuditRow[] = rows.map(r => {
    const sets = JSON.parse(r.sets_json) as Array<{ min: number | null; max: number | null; duration: number | null }>;
    const trackingMode = (r.tracking_mode === 'time' ? 'time' : 'reps') as 'reps' | 'time';

    // Build a fingerprint per set: "8-12" or "10s" depending on mode
    const fingerprints = sets
      .map(s => trackingMode === 'time'
        ? (s.duration != null ? `${s.duration}s` : '?')
        : (s.min != null && s.max != null
            ? (s.min === s.max ? `${s.min}` : `${s.min}-${s.max}`)
            : '?'),
      );
    const uniq = Array.from(new Set(fingerprints));

    let reps_summary: string;
    let snapped: RepWindow | null = null;

    if (uniq.length === 0) {
      reps_summary = '(no sets)';
    } else if (uniq.length === 1) {
      reps_summary = uniq[0];
      if (trackingMode === 'reps' && sets[0].min != null && sets[0].max != null) {
        snapped = snapToWindow(sets[0].min, sets[0].max);
      }
    } else {
      reps_summary = `mixed (${uniq.join(', ')})`;
      // try snapping if all sets have the same min/max
      const first = sets[0];
      const allSame = sets.every(s => s.min === first.min && s.max === first.max);
      if (allSame && trackingMode === 'reps' && first.min != null && first.max != null) {
        snapped = snapToWindow(first.min, first.max);
      }
    }

    return {
      routine_uuid: r.routine_uuid,
      routine_title: r.routine_title,
      plan_title: r.plan_title,
      exercise_uuid: r.exercise_uuid,
      exercise_title: r.exercise_title,
      goal_window: r.goal_window,
      set_count: sets.length,
      reps_summary,
      snapped_window: snapped,
      tracking_mode: trackingMode,
    };
  });

  // Group by plan + routine, print a clean tree.
  const byKey = new Map<string, ExerciseAuditRow[]>();
  for (const a of audited) {
    const key = `${a.plan_title ?? '(no plan)'} :: ${a.routine_title ?? '(untitled)'}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(a);
  }

  const C = {
    bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
    dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
    green: (s: string) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
    red: (s: string) => `\x1b[31m${s}\x1b[0m`,
    cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  };

  console.log('');
  console.log(C.bold('Routine audit — current set-level rep targets vs window registry'));
  console.log('');

  let snappedCount = 0;
  let customCount = 0;
  let assignedCount = 0;
  let timeModeCount = 0;
  let noSetsCount = 0;

  for (const [key, exercises] of byKey) {
    console.log(C.bold(key));
    for (const ex of exercises) {
      const titleCol = ex.exercise_title.padEnd(38).slice(0, 38);
      const repsCol = ex.reps_summary.padEnd(20);

      let windowDisplay: string;
      if (ex.tracking_mode === 'time') {
        windowDisplay = C.dim('time-mode');
        timeModeCount++;
      } else if (ex.set_count === 0) {
        windowDisplay = C.dim('no sets');
        noSetsCount++;
      } else if (ex.snapped_window) {
        windowDisplay = C.green(`snaps → ${ex.snapped_window}`);
        snappedCount++;
      } else {
        windowDisplay = C.yellow('CUSTOM (review)');
        customCount++;
      }

      const assignedBadge = ex.goal_window
        ? C.cyan(`[goal=${ex.goal_window}]`)
        : C.dim('[unassigned]');
      if (ex.goal_window) assignedCount++;

      console.log(`  ${titleCol} ${C.dim(`${ex.set_count} sets ×`)} ${repsCol} ${windowDisplay}  ${assignedBadge}`);
    }
    console.log('');
  }

  console.log(C.bold('Summary:'));
  console.log(`  Total routine exercises:  ${audited.length}`);
  console.log(`  Already assigned:         ${assignedCount}`);
  console.log(`  Snap cleanly to window:   ${C.green(String(snappedCount))}`);
  console.log(`  Custom (need review):     ${C.yellow(String(customCount))}`);
  console.log(`  Time-mode (skip):         ${C.dim(String(timeModeCount))}`);
  console.log(`  Empty (no sets):          ${C.dim(String(noSetsCount))}`);
  console.log('');

  process.exit(0);
}

audit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
