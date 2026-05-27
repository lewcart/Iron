// One-shot re-pack of workout_routine_exercises.order_index.
//
// Why: add_exercise historically derived the next order_index from COUNT(*)
// of siblings instead of MAX(order_index)+1 (fixed in src/lib/mcp-tools.ts).
// On any gappy routine (deleted sibling, non-zero start, a prior collision)
// COUNT landed on an already-occupied index, so newly-added exercises shared
// an order_index with an existing sibling. The UI still sorted them sensibly
// (it falls back to insertion order) but the data is untidy. This renumbers
// each routine's exercises to a dense 0..n-1 sequence.
//
// Run:
//   bun run db:repack-routine-order   (or: npx tsx src/db/repack-routine-order-index.ts)
//        → DRY RUN: reports collisions + the planned remap, writes nothing.
//   ... --apply
//        → executes a single atomic UPDATE.
//
// Safety / "doesn't break anything else":
//  - Ordering key is (order_index, created_at, uuid): preserves existing
//    relative order; ties (the collisions) break by insertion time then uuid,
//    deterministic and stable.
//  - Supersets key off RELATIVE order + contiguity (src/lib/supersetGrouping.ts),
//    not absolute integers — a dense renumber that preserves relative order
//    keeps every group's leader (lowest member) and contiguity intact. We still
//    run a post-remap contiguity check and refuse to apply if any group would
//    split.
//  - The single UPDATE only touches rows whose index actually changes, firing
//    the BEFORE UPDATE updated_at trigger and the AFTER UPDATE change_log
//    trigger (migration 019) per moved row — so the change propagates to the
//    local-first client on its next pull. The only loss case is the documented
//    single-user last-write-wins: if Lou is mid-editing this exact routine in
//    the app when this runs, the client's pending push would overwrite the
//    re-pack. Run it while not actively editing routines.

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env' });
dotenvConfig({ path: '.env.local', override: true });

import { query } from './db';

const APPLY = process.argv.includes('--apply');

interface PlanRow {
  uuid: string;
  workout_routine_uuid: string;
  routine_title: string | null;
  exercise_title: string | null;
  superset_group_uuid: string | null;
  old_index: number;
  new_index: number;
}

const RANKED_CTE = `
  WITH ranked AS (
    SELECT
      re.uuid,
      re.workout_routine_uuid,
      r.title AS routine_title,
      e.title AS exercise_title,
      re.superset_group_uuid,
      re.order_index AS old_index,
      (ROW_NUMBER() OVER (
        PARTITION BY re.workout_routine_uuid
        ORDER BY re.order_index, re.created_at, re.uuid
      ) - 1) AS new_index
    FROM workout_routine_exercises re
    LEFT JOIN workout_routines r ON r.uuid = re.workout_routine_uuid
    LEFT JOIN exercises e ON e.uuid = re.exercise_uuid
  )`;

async function main(): Promise<void> {
  // 1. Report current collisions (the symptom).
  const collisions = await query<{ workout_routine_uuid: string; order_index: number; n: number }>(
    `SELECT workout_routine_uuid, order_index, COUNT(*)::int AS n
       FROM workout_routine_exercises
      GROUP BY workout_routine_uuid, order_index
     HAVING COUNT(*) > 1
      ORDER BY workout_routine_uuid, order_index`
  );

  // 2. Compute the full remap.
  const plan = await query<PlanRow>(
    `${RANKED_CTE}
     SELECT uuid, workout_routine_uuid, routine_title, exercise_title,
            superset_group_uuid, old_index::int, new_index::int
       FROM ranked
      ORDER BY workout_routine_uuid, new_index`
  );

  const moves = plan.filter(p => p.old_index !== p.new_index);

  console.log(`Routines scanned:          ${new Set(plan.map(p => p.workout_routine_uuid)).size}`);
  console.log(`Routine exercises:         ${plan.length}`);
  console.log(`Colliding (index, routine) pairs: ${collisions.length}`);
  console.log(`Rows that will be renumbered:     ${moves.length}`);
  console.log('');

  if (collisions.length > 0) {
    console.log('Collisions:');
    for (const c of collisions) {
      console.log(`  routine ${c.workout_routine_uuid}  index ${c.order_index} × ${c.n} rows`);
    }
    console.log('');
  }

  // 3. Superset contiguity safety check on the POST-remap ordering.
  //    For every group, its members must occupy a contiguous run of new_index.
  const brokenGroups: string[] = [];
  const byGroup = new Map<string, number[]>();
  for (const p of plan) {
    if (!p.superset_group_uuid) continue;
    const arr = byGroup.get(p.superset_group_uuid) ?? [];
    arr.push(p.new_index);
    byGroup.set(p.superset_group_uuid, arr);
  }
  for (const [group, indices] of byGroup) {
    const sorted = [...indices].sort((a, b) => a - b);
    const contiguous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
    if (!contiguous) brokenGroups.push(group);
  }
  if (brokenGroups.length > 0) {
    console.error('ABORT: the remap would make these superset groups non-contiguous:');
    for (const g of brokenGroups) console.error(`  ${g}`);
    console.error('No changes written. Inspect these routines manually before re-running.');
    process.exit(1);
  }
  console.log(`Superset contiguity check: OK (${byGroup.size} group(s) stay contiguous)`);
  console.log('');

  if (moves.length > 0) {
    console.log('Planned renumbering (only rows that move):');
    let lastRoutine = '';
    for (const m of moves) {
      if (m.workout_routine_uuid !== lastRoutine) {
        console.log(`  ${m.routine_title ?? '(untitled)'} [${m.workout_routine_uuid}]`);
        lastRoutine = m.workout_routine_uuid;
      }
      console.log(`    ${String(m.old_index).padStart(3)} → ${String(m.new_index).padStart(3)}  ${m.exercise_title ?? m.uuid}`);
    }
    console.log('');
  }

  if (!APPLY) {
    console.log('DRY RUN — nothing written. Re-run with --apply to execute.');
    process.exit(0);
  }

  if (moves.length === 0) {
    console.log('Nothing to do — all routines already dense. No write performed.');
    process.exit(0);
  }

  // 4. Atomic remap. Single statement; per-row triggers fire for each moved
  //    row (updated_at bump + change_log entry). No-op rows are skipped by the
  //    new_index <> old_index guard so we don't churn untouched rows.
  await query(
    `${RANKED_CTE}
     UPDATE workout_routine_exercises e
        SET order_index = r.new_index
       FROM ranked r
      WHERE e.uuid = r.uuid
        AND r.new_index <> r.old_index`
  );

  // 5. Verify: zero collisions remain.
  const after = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT 1 FROM workout_routine_exercises
        GROUP BY workout_routine_uuid, order_index
       HAVING COUNT(*) > 1
     ) t`
  );
  const remaining = after[0]?.n ?? 0;
  console.log(`Applied. ${moves.length} row(s) renumbered. Remaining collisions: ${remaining}`);
  process.exit(remaining === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Re-pack failed:', err);
  process.exit(1);
});
