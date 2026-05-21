/**
 * Pure helpers for gating rest-timer auto-start during drop chains and
 * superset rounds. Tag + adjacency model per UC2/UC6 final-gate decision
 * (no parent FK; structurally contiguous in order_index).
 *
 * Rules:
 *   - A drop chain = a `working` set (tag NULL or 'failure') followed by
 *     one or more `dropSet`-tagged sets, contiguous by order_index within
 *     the same exercise. Rest timer skips between drops AND between the
 *     parent and its first drop. Resumes after the terminal drop.
 *   - A superset round = exercises sharing `superset_group_uuid`. Rest
 *     timer skips when a leg completes but other legs still have a set at
 *     the same round index pending. Round N complete when every member
 *     either has set N completed OR has fewer than N sets.
 */

export interface SetForChain {
  uuid: string;
  order_index: number;
  is_completed: boolean;
  tag: 'dropSet' | 'failure' | null;
  _deleted?: boolean;
}

export interface ExerciseForRound {
  uuid: string;
  workout_uuid: string;
  superset_group_uuid: string | null;
  order_index: number;
  sets: SetForChain[];
}

/**
 * `true` if the just-completed set has any uncompleted drop set
 * immediately after it (contiguously in order_index) in the same exercise.
 * In other words: there are more drops in this chain to come.
 *
 * Rules:
 *   - If the just-completed set is itself a drop, look for the next
 *     order_index — if that's also tagged `dropSet` and uncompleted, true.
 *   - If the just-completed set is a working set (tag NULL or 'failure'),
 *     look at the next-order set — if it's tagged `dropSet` and
 *     uncompleted, true (we're entering the chain).
 *   - Soft-deleted sets are skipped.
 *   - If no following set exists, false (terminal).
 */
export function isMidDropChain(
  justCompletedSet: SetForChain,
  allSetsForExercise: readonly SetForChain[],
): boolean {
  const live = allSetsForExercise.filter(s => !s._deleted);
  // Find the next set by order_index strictly greater than the current.
  const next = live
    .filter(s => s.order_index > justCompletedSet.order_index)
    .sort((a, b) => a.order_index - b.order_index)[0];
  if (!next) return false;
  if (next.tag !== 'dropSet') return false;
  if (next.is_completed) return false;
  return true;
}

/**
 * `true` if the just-completed set belongs to an exercise that is part of
 * a superset group, and at least one OTHER member of the group has an
 * uncompleted set at the same round index. Round index = the set's
 * 1-based position by order_index within its own exercise (drops collapse
 * to their parent's index, see roundIndexOf below).
 *
 * Asymmetric rule: if a member has fewer than N sets, that member is
 * considered "done with this round" for the purposes of completion check.
 * Round N complete when every member with at least N sets has its N-th
 * working set completed.
 */
export function isMidSupersetRound(
  justCompletedSet: SetForChain,
  exercise: ExerciseForRound,
  allExercisesInWorkout: readonly ExerciseForRound[],
): boolean {
  if (!exercise.superset_group_uuid) return false;
  const round = roundIndexOf(justCompletedSet, exercise.sets);
  if (round == null) return false;

  const peers = allExercisesInWorkout.filter(
    e => e.uuid !== exercise.uuid
      && e.superset_group_uuid === exercise.superset_group_uuid,
  );
  if (peers.length === 0) return false;

  for (const peer of peers) {
    const peerWorkingSets = peer.sets
      .filter(s => !s._deleted && s.tag !== 'dropSet')
      .sort((a, b) => a.order_index - b.order_index);
    if (peerWorkingSets.length < round) continue; // peer doesn't have this round; not blocking
    const peerSet = peerWorkingSets[round - 1];
    if (!peerSet.is_completed) return true;
  }
  return false;
}

/**
 * 1-based round index of a set within its exercise. Counts only working
 * sets (drops collapse into their parent's round). Returns null if the
 * set isn't found.
 *
 * Worked example: sets [p1, p2, drop, drop, p3] (by order_index).
 *   - p1 → round 1
 *   - p2 → round 2
 *   - drop → round 2 (same as parent p2)
 *   - drop → round 2
 *   - p3 → round 3
 */
export function roundIndexOf(set: SetForChain, allSets: readonly SetForChain[]): number | null {
  const live = allSets
    .filter(s => !s._deleted)
    .sort((a, b) => a.order_index - b.order_index);
  let workingCount = 0;
  for (const s of live) {
    const isDrop = s.tag === 'dropSet';
    if (!isDrop) workingCount++;
    if (s.uuid === set.uuid) {
      // For a drop, we want its parent's round. workingCount is the count
      // of working sets seen so far INCLUDING the most recent parent (which
      // is the chain's parent if we haven't hit another working set yet).
      return workingCount === 0 ? null : workingCount;
    }
  }
  return null;
}

/**
 * Compute the displayed numbering for each set in an exercise.
 *   - Working sets: 1, 2, 3, ... (drops skip)
 *   - Drop sets: 'D1', 'D2', ... within the chain after each parent
 *
 * Returns labels in the same order as the input. Soft-deleted sets get
 * empty strings (they're filtered out by the caller anyway).
 */
export function setNumberLabels(allSets: readonly SetForChain[]): string[] {
  const sorted = [...allSets]
    .map((s, i) => ({ s, originalIdx: i }))
    .sort((a, b) => a.s.order_index - b.s.order_index);

  const labelByOriginalIdx = new Array<string>(allSets.length).fill('');
  let workingCount = 0;
  let dropCount = 0;
  for (const { s, originalIdx } of sorted) {
    if (s._deleted) {
      labelByOriginalIdx[originalIdx] = '';
      continue;
    }
    const isDrop = s.tag === 'dropSet';
    if (isDrop) {
      dropCount++;
      labelByOriginalIdx[originalIdx] = `D${dropCount}`;
    } else {
      workingCount++;
      dropCount = 0;
      labelByOriginalIdx[originalIdx] = String(workingCount);
    }
  }
  return labelByOriginalIdx;
}
