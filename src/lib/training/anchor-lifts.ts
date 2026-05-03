/**
 * Per-priority-muscle "anchor lift" config — the lift whose e1RM trend is
 * the cleanest within-mesocycle hypertrophy proxy for that muscle group.
 *
 * Resolution is **muscle-tagging-first** (Lou's V1.1 feedback): we look up
 * exercises tagged with the priority muscle (primary or secondary) in the
 * canonical 18-slug taxonomy and pick the one Lou actually logs the most.
 * This way "Dumbbell Rear Delt Fly" matches the `delts` anchor even though
 * neither the title nor the alias array matches the legacy `nameLike[]`
 * substrings. Substring matching is kept as a fallback for the cold-start
 * case (zero recently-logged exercises tagged with the muscle).
 *
 * Slugs are aligned with the canonical `muscles` taxonomy in
 * `src/lib/muscles.ts`. Earlier drafts used split `side_delts` /
 * `rear_delts` slugs that don't exist in the taxonomy — they're now
 * collapsed into a single `delts` entry.
 *
 * Hip abductors intentionally have a fallback `nameLike` of substrings
 * that don't exist in the catalog today (only `Cable Hip Adduction`, the
 * opposite muscle, is present). Tile 3 renders a data-needs flag for that
 * row pointing the user at the catalog audit. See plan TODO V1.1.
 */
import { resolveMuscleSlug, type MuscleSlug } from '@/lib/muscles';

export interface AnchorLiftConfig {
  /** Priority-muscle slug (canonical taxonomy — see `src/lib/muscles.ts`). */
  muscle: MuscleSlug;
  /** Display label rendered as a fallback when no logged exercise picks the
   *  display name. The resolved exercise's actual title is preferred. */
  display_name: string;
  /** Substring matchers used as a cold-start fallback when no exercise
   *  tagged with `muscle` has been logged recently. Run case-insensitively
   *  against `title` AND `alias[]`. */
  nameLike: string[];
  /** Optional flag: catalog has no exact match today (set so the tile can
   *  show a more specific "tag exercises" hint). */
  catalogGap?: boolean;
}

export const ANCHOR_LIFTS: AnchorLiftConfig[] = [
  {
    muscle: 'glutes',
    display_name: 'Hip Thrust',
    nameLike: ['Hip Thrust'],
  },
  {
    muscle: 'lats',
    display_name: 'Lat Pulldown',
    // Catalog stores Pulldown variants as aliases on a parent row — matcher
    // searches both title AND alias[].
    nameLike: ['Lat Pulldown', 'Pulldown', 'Pull Up', 'Pull-up'],
  },
  {
    // Canonical taxonomy collapses side_delts + rear_delts → `delts`. We pick
    // ONE anchor row per priority muscle, biased toward exercises Lou
    // actually logs (lateral raises, rear-delt flies, face pulls all
    // qualify via muscle-tagging — the resolver picks the one with the most
    // recent log signal).
    muscle: 'delts',
    display_name: 'Lateral Raise',
    nameLike: [
      'Lateral Raise', 'Rear Delt', 'Reverse Flyes', 'Reverse Fly',
      'Face Pulls', 'Face Pull', 'Shoulder Press', 'Overhead Press',
    ],
  },
  {
    muscle: 'hip_abductors',
    display_name: 'Hip Abduction',
    // No exact catalog match exists today (only "Cable Hip Adduction" — the
    // opposite muscle). Tile renders a data-needs flag for this row.
    nameLike: ['Hip Abduction', 'Cable Hip Abduction'],
    catalogGap: true,
  },
];

/** Catalog exercise shape — matches the relevant subset of `LocalExercise`.
 *  `primary_muscles` / `secondary_muscles` are raw string[] from Dexie; the
 *  resolver normalizes them via `resolveMuscleSlug` so legacy synonyms
 *  ("rear delts", "shoulders") still resolve to `delts`. */
export interface CatalogExercise {
  uuid: string;
  title: string;
  alias?: string[] | null;
  primary_muscles?: string[] | null;
  secondary_muscles?: string[] | null;
}

/** Per-exercise log signal used to pick the strongest anchor candidate.
 *  Higher = more recent, more frequent. Built from the last ~8 weeks of
 *  workout_sets (see feed/page.tsx for the Dexie wiring). */
export interface ExerciseLogSignal {
  exercise_uuid: string;
  /** Number of distinct workout dates the exercise was logged on. */
  session_count: number;
  /** Number of working sets logged across those sessions. */
  set_count: number;
  /** ISO YYYY-MM-DD of the most recent workout date the exercise was on. */
  last_workout_date: string;
}

/**
 * Resolve the anchor exercise for a config, **preferring exercises Lou
 * actually logs** over name-matched ones.
 *
 * Algorithm:
 *   1. Find catalog exercises whose normalized muscle tags (primary OR
 *      secondary) include `config.muscle`.
 *   2. Restrict to those with at least one log signal (logged in the last
 *      8 weeks). Pick the one with the highest session_count, breaking
 *      ties by set_count, then by last_workout_date (most recent wins).
 *   3. If no tagged-and-logged exercise exists, fall back to substring
 *      matching against `config.nameLike[]` (legacy V1 behaviour).
 *
 * Returns `null` when neither path finds a match.
 */
export function resolveAnchorLift(
  config: AnchorLiftConfig,
  catalog: readonly CatalogExercise[],
  signals: readonly ExerciseLogSignal[] = [],
): CatalogExercise | null {
  // ── Path 1: muscle-tagged exercises with recent log signal ────────────
  const signalByUuid = new Map(signals.map(s => [s.exercise_uuid, s]));

  const tagged: { ex: CatalogExercise; sig: ExerciseLogSignal }[] = [];
  for (const ex of catalog) {
    if (!exerciseTagsMuscle(ex, config.muscle)) continue;
    const sig = signalByUuid.get(ex.uuid);
    if (!sig) continue;
    tagged.push({ ex, sig });
  }

  if (tagged.length > 0) {
    tagged.sort((a, b) => {
      if (b.sig.session_count !== a.sig.session_count) {
        return b.sig.session_count - a.sig.session_count;
      }
      if (b.sig.set_count !== a.sig.set_count) {
        return b.sig.set_count - a.sig.set_count;
      }
      return b.sig.last_workout_date.localeCompare(a.sig.last_workout_date);
    });
    return tagged[0].ex;
  }

  // ── Path 2: substring fallback (cold start, no logs yet) ──────────────
  const needles = config.nameLike.map(s => s.toLowerCase());
  for (const ex of catalog) {
    const haystacks: string[] = [ex.title.toLowerCase()];
    if (Array.isArray(ex.alias)) {
      for (const a of ex.alias) {
        if (typeof a === 'string') haystacks.push(a.toLowerCase());
      }
    }
    for (const needle of needles) {
      if (haystacks.some(h => h.includes(needle))) {
        return ex;
      }
    }
  }
  return null;
}

/** True when an exercise's primary OR secondary muscle tags resolve (via
 *  legacy synonym map) to the canonical `muscle` slug. */
export function exerciseTagsMuscle(
  ex: CatalogExercise,
  muscle: MuscleSlug,
): boolean {
  const all = [
    ...(ex.primary_muscles ?? []),
    ...(ex.secondary_muscles ?? []),
  ];
  for (const raw of all) {
    if (typeof raw !== 'string') continue;
    if (resolveMuscleSlug(raw) === muscle) return true;
  }
  return false;
}
