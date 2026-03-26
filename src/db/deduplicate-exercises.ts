/**
 * Merges duplicate built-in exercises (same title, non-custom) and duplicate
 * everkinetic_id rows. Keeps the Iron catalog UUID when present; otherwise the
 * row with the most workout/routine references. Repoints FKs before delete.
 *
 *   npm run db:dedupe-exercises
 */
import './load-env.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ExerciseRow {
  uuid: string;
  title: string;
  everkinetic_id: number;
  is_custom: boolean;
}

function loadIronMeta(): { uuids: Set<string>; byEverkineticId: Map<number, string> } {
  const raw = JSON.parse(
    readFileSync(join(__dirname, 'exercises.json'), 'utf-8')
  ) as Array<{ uuid: string; id: number }>;
  const uuids = new Set(raw.map((e) => e.uuid.toUpperCase()));
  const byEverkineticId = new Map<number, string>();
  for (const e of raw) {
    byEverkineticId.set(e.id, e.uuid);
  }
  return { uuids, byEverkineticId };
}

async function refTotals(uuids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const u of uuids) map.set(u, 0);
  if (uuids.length === 0) return map;

  const we = await query<{ exercise_uuid: string; n: string }>(
    `SELECT exercise_uuid, COUNT(*)::text AS n FROM workout_exercises
     WHERE exercise_uuid = ANY($1::text[]) GROUP BY exercise_uuid`,
    [uuids]
  );
  const wr = await query<{ exercise_uuid: string; n: string }>(
    `SELECT exercise_uuid, COUNT(*)::text AS n FROM workout_routine_exercises
     WHERE exercise_uuid = ANY($1::text[]) GROUP BY exercise_uuid`,
    [uuids]
  );
  for (const row of we) {
    map.set(row.exercise_uuid, (map.get(row.exercise_uuid) ?? 0) + parseInt(row.n, 10));
  }
  for (const row of wr) {
    map.set(row.exercise_uuid, (map.get(row.exercise_uuid) ?? 0) + parseInt(row.n, 10));
  }
  return map;
}

function pickKeeper(
  group: ExerciseRow[],
  ironUuids: Set<string>,
  refs: Map<string, number>
): string {
  const inIron = group.filter((r) => ironUuids.has(r.uuid.toUpperCase()));
  if (inIron.length === 1) return inIron[0].uuid;
  if (inIron.length > 1) {
    inIron.sort((a, b) => (refs.get(b.uuid) ?? 0) - (refs.get(a.uuid) ?? 0) || a.uuid.localeCompare(b.uuid));
    return inIron[0].uuid;
  }
  const sorted = [...group].sort(
    (a, b) => (refs.get(b.uuid) ?? 0) - (refs.get(a.uuid) ?? 0) || a.uuid.localeCompare(b.uuid)
  );
  return sorted[0].uuid;
}

async function repointAndDelete(loserUuid: string, keeperUuid: string) {
  if (loserUuid === keeperUuid) return;
  await query(
    `UPDATE workout_exercises SET exercise_uuid = $1 WHERE exercise_uuid = $2`,
    [keeperUuid, loserUuid]
  );
  await query(
    `UPDATE workout_routine_exercises SET exercise_uuid = $1 WHERE exercise_uuid = $2`,
    [keeperUuid, loserUuid]
  );
  await query(`DELETE FROM exercises WHERE uuid = $1`, [loserUuid]);
}

async function dedupeByTitle(rows: ExerciseRow[], ironUuids: Set<string>): Promise<number> {
  const builtins = rows.filter((r) => !r.is_custom);
  const byTitle = new Map<string, ExerciseRow[]>();
  for (const r of builtins) {
    const k = r.title.trim().toLowerCase();
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k)!.push(r);
  }

  let removed = 0;
  for (const [titleKey, group] of byTitle) {
    if (group.length < 2) continue;
    const uuids = group.map((g) => g.uuid);
    const refs = await refTotals(uuids);
    const keeper = pickKeeper(group, ironUuids, refs);
    for (const r of group) {
      if (r.uuid === keeper) continue;
      await repointAndDelete(r.uuid, keeper);
      removed++;
      console.log(`  title "${titleKey}": removed duplicate ${r.uuid} → kept ${keeper}`);
    }
  }
  return removed;
}

async function dedupeByEverkineticId(
  rows: ExerciseRow[],
  ironById: Map<number, string>,
  ironUuids: Set<string>
): Promise<number> {
  const builtins = rows.filter((r) => !r.is_custom);
  const byEk = new Map<number, ExerciseRow[]>();
  for (const r of builtins) {
    if (!byEk.has(r.everkinetic_id)) byEk.set(r.everkinetic_id, []);
    byEk.get(r.everkinetic_id)!.push(r);
  }

  let removed = 0;
  for (const [, group] of byEk) {
    if (group.length < 2) continue;
    const uuids = group.map((g) => g.uuid);
    const refs = await refTotals(uuids);

    let keeper: string | null = null;
    const canonical = ironById.get(group[0].everkinetic_id);
    if (canonical && group.some((g) => g.uuid.toUpperCase() === canonical.toUpperCase())) {
      keeper = group.find((g) => g.uuid.toUpperCase() === canonical.toUpperCase())!.uuid;
    }
    if (!keeper) {
      keeper = pickKeeper(group, ironUuids, refs);
    }

    for (const r of group) {
      if (r.uuid === keeper) continue;
      await repointAndDelete(r.uuid, keeper);
      removed++;
      console.log(
        `  everkinetic_id ${r.everkinetic_id}: removed duplicate ${r.uuid} → kept ${keeper}`
      );
    }
  }
  return removed;
}

async function main() {
  console.log('Deduplicating exercises (built-ins only, custom rows untouched)…');
  const { uuids: ironUuids, byEverkineticId: ironById } = loadIronMeta();

  let total = 0;

  for (let pass = 0; pass < 10; pass++) {
    const rows = await query<ExerciseRow>(
      `SELECT uuid, title, everkinetic_id, is_custom FROM exercises`
    );
    const nTitle = await dedupeByTitle(rows, ironUuids);
    total += nTitle;

    const rowsAfterTitle = await query<ExerciseRow>(
      `SELECT uuid, title, everkinetic_id, is_custom FROM exercises`
    );
    const nEk = await dedupeByEverkineticId(rowsAfterTitle, ironById, ironUuids);
    total += nEk;

    if (nTitle === 0 && nEk === 0) break;
  }

  console.log(`✓ Done. Removed ${total} duplicate exercise row(s).`);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
