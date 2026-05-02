/**
 * Mapping from our 18 canonical muscle slugs to react-muscle-highlighter's
 * 23 library slugs. Two slugs (rotator_cuff, hip_abductors) have no good
 * library counterpart and are treated as "deep" — they appear in the pill
 * row only, never in the body diagram.
 *
 * The library collapses some of our finer-grained slugs into coarser library
 * regions (lats + rhomboids → upper-back; mid_traps + lower_traps →
 * trapezius). The pill row carries the precise name, so the user still sees
 * the distinction in text.
 */

import type { MuscleSlug } from '@/lib/muscles';

/** Library slugs we use (subset of the library's full 23). */
export type LibSlug =
  | 'chest'
  | 'biceps'
  | 'triceps'
  | 'forearm'
  | 'abs'
  | 'obliques'
  | 'quadriceps'
  | 'hamstring'
  | 'gluteal'
  | 'adductors'
  | 'calves'
  | 'deltoids'
  | 'upper-back'
  | 'lower-back'
  | 'trapezius';

/**
 * Each canonical slug → one or more library slugs (multi for `core`, which
 * spans abs + obliques in the library). `null` means deep / no body region —
 * the muscle only surfaces in the pill row.
 */
export const SLUG_TO_LIB: Record<MuscleSlug, readonly LibSlug[] | null> = {
  chest: ['chest'],
  lats: ['upper-back'],
  rhomboids: ['upper-back'],
  mid_traps: ['trapezius'],
  lower_traps: ['trapezius'],
  erectors: ['lower-back'],
  delts: ['deltoids'],
  rotator_cuff: null, // deep
  biceps: ['biceps'],
  triceps: ['triceps'],
  forearms: ['forearm'],
  core: ['abs', 'obliques'],
  glutes: ['gluteal'],
  quads: ['quadriceps'],
  hamstrings: ['hamstring'],
  hip_abductors: null, // deep — library has no side-hip region
  hip_adductors: ['adductors'],
  calves: ['calves'],
};

export function isDeep(slug: MuscleSlug): boolean {
  return SLUG_TO_LIB[slug] === null;
}
