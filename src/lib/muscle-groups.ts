/**
 * UI muscle-area filter mapping.
 *
 * Post-migration 026, exercise muscle arrays use canonical slugs only. UI keys
 * (chest/back/shoulders/arms/legs/abdominals) map to canonical parent_groups
 * via the muscles table. This module exposes that mapping for the /exercises
 * page filter and the server-side listExercises query.
 *
 * NOTE: this file is scheduled for removal once the /exercises page migrates
 * to canonical-slug pickers (no more aggregate UI keys). Until then it stays
 * as a thin compatibility layer.
 */

import { MUSCLE_DEFS, MUSCLE_SLUGS, type MuscleSlug } from './muscles';

/** UI muscle-area key → canonical parent_group. abdominals folds into 'core'. */
const UI_TO_PARENT_GROUP: Record<string, string> = {
  chest: 'chest',
  back: 'back',
  shoulders: 'shoulders',
  arms: 'arms',
  legs: 'legs',
  abdominals: 'core',
  core: 'core',
};

/** All canonical slugs in the given UI muscle area. */
export function muscleGroupSearchTerms(groupKey: string): string[] {
  const parentGroup = UI_TO_PARENT_GROUP[groupKey.toLowerCase()];
  if (!parentGroup) return [];
  return MUSCLE_SLUGS.filter(slug => MUSCLE_DEFS[slug].parent_group === parentGroup);
}

/** Client-side: does this exercise belong under the given UI muscle area? */
export function exerciseMatchesMuscleGroup(
  primaryMuscles: string[],
  secondaryMuscles: string[],
  groupKey: string
): boolean {
  const slugs = muscleGroupSearchTerms(groupKey);
  if (slugs.length === 0) return false;
  const slugSet = new Set<string>(slugs);
  for (const m of primaryMuscles) if (slugSet.has(m)) return true;
  for (const m of secondaryMuscles) if (slugSet.has(m)) return true;
  return false;
}

// Re-export for convenience.
export type { MuscleSlug };
