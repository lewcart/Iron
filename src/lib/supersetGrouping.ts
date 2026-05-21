/**
 * Pure helpers for superset group integrity. Groups exist as denormalized
 * columns on workout_exercises / workout_routine_exercises rows (UC1 final
 * gate): exercises sharing the same `superset_group_uuid` form a group.
 * Group metadata (round_target, rest_override_seconds) lives on the
 * lowest-order_index member of each group.
 *
 * Functions here are about MAINTAINING the contiguity invariant after a
 * drag-reorder. The rule: a group is valid only when its members are
 * contiguous by order_index. If a non-member gets reordered between two
 * members, the group is "broken" — the orphan members get dissolved
 * (superset_group_uuid set to null).
 */

export interface ExerciseForGrouping {
  uuid: string;
  order_index: number;
  superset_group_uuid: string | null;
  superset_round_target?: number | null;
  superset_rest_override_seconds?: number | null;
  _deleted?: boolean;
}

/**
 * Decide which exercises must lose their superset_group_uuid (and the
 * round/rest metadata if applicable) after a reorder. Returns the list of
 * uuids to clear.
 *
 * Rule: walk exercises in order_index order. Group all sequential rows
 * with the same non-null superset_group_uuid into a "run." For each
 * group UUID, count the number of distinct runs:
 *   - 1 run with ≥2 members → valid, no change
 *   - 1 run with <2 members → orphan, clear it
 *   - ≥2 runs → broken; clear ALL members of all runs (group dissolves)
 *
 * Why dissolve when broken (vs picking one run to keep): the user's
 * intent is ambiguous. Clearing both is honest — they can re-pair if
 * needed. Matches the design D6 "drag does pure reorder; grouping only
 * via menu" intent: if they wanted these grouped, they wouldn't have
 * dragged a non-member between them.
 */
export function dissolveOrphanGroups(exercises: readonly ExerciseForGrouping[]): string[] {
  const live = exercises
    .filter(e => !e._deleted)
    .sort((a, b) => a.order_index - b.order_index);

  // Map<groupUuid, list of {uuid, runIndex}> — runIndex bumps when we
  // encounter a row not in the group between two rows that ARE.
  const runs = new Map<string, { uuids: string[]; runs: number }>();
  const lastGroupId = new Map<string, number>(); // groupUuid → last seen index

  for (let i = 0; i < live.length; i++) {
    const e = live[i];
    const g = e.superset_group_uuid;
    if (!g) continue;
    const prevIdx = lastGroupId.get(g);
    let bucket = runs.get(g);
    if (!bucket) {
      bucket = { uuids: [], runs: 0 };
      runs.set(g, bucket);
    }
    if (prevIdx === undefined) {
      bucket.runs = 1;
    } else if (prevIdx !== i - 1) {
      bucket.runs += 1;
    }
    bucket.uuids.push(e.uuid);
    lastGroupId.set(g, i);
  }

  const toClear: string[] = [];
  for (const { uuids, runs: runCount } of runs.values()) {
    if (runCount === 1 && uuids.length >= 2) continue;       // valid group
    for (const u of uuids) toClear.push(u);                  // dissolve
  }
  return toClear;
}

/**
 * Given a workout's exercises (post-mutation), find each group's lowest-
 * order_index member. Returns Map<groupUuid, leaderUuid>. Used by the
 * auto-cleanup pass that ensures round_target/rest_override live ONLY on
 * the leader (siblings stay null) — keeps the "metadata on lowest member"
 * invariant intact after reorders.
 */
export function findGroupLeaders(exercises: readonly ExerciseForGrouping[]): Map<string, string> {
  const live = exercises
    .filter(e => !e._deleted && e.superset_group_uuid != null)
    .sort((a, b) => a.order_index - b.order_index);
  const leaders = new Map<string, string>();
  for (const e of live) {
    const g = e.superset_group_uuid as string;
    if (!leaders.has(g)) leaders.set(g, e.uuid);
  }
  return leaders;
}

/**
 * After a reorder, the lowest-order_index member of a group may change.
 * Returns the metadata reassignments needed: for each group, the leader
 * uuid (which keeps the round_target/rest_override) and the list of
 * siblings (which must have those fields cleared).
 */
export function planMetadataMoves(
  exercises: readonly ExerciseForGrouping[],
): { leaderUuid: string; siblingUuids: string[]; round_target: number | null; rest_override_seconds: number | null }[] {
  const live = exercises
    .filter(e => !e._deleted && e.superset_group_uuid != null)
    .sort((a, b) => a.order_index - b.order_index);

  const byGroup = new Map<string, ExerciseForGrouping[]>();
  for (const e of live) {
    const g = e.superset_group_uuid as string;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(e);
  }

  const moves: ReturnType<typeof planMetadataMoves> = [];
  for (const [, members] of byGroup) {
    if (members.length < 2) continue;
    const leader = members[0];
    // Round/rest may currently live on any member; collect the first non-null
    // value across the group (member at index 0 wins if it has it, else
    // pick from later siblings — handles the case where reorder demoted
    // the previous leader to a sibling slot).
    let round_target: number | null = null;
    let rest_override_seconds: number | null = null;
    for (const m of members) {
      if (round_target == null && m.superset_round_target != null) round_target = m.superset_round_target;
      if (rest_override_seconds == null && m.superset_rest_override_seconds != null) rest_override_seconds = m.superset_rest_override_seconds;
    }
    moves.push({
      leaderUuid: leader.uuid,
      siblingUuids: members.slice(1).map(m => m.uuid),
      round_target,
      rest_override_seconds,
    });
  }
  return moves;
}
