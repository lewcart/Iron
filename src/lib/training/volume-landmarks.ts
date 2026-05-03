/**
 * Per-muscle weekly volume landmarks (MV / MEV / MAV / MRV) — RP 2025 Help
 * Center reference set, with one extrapolated row (hip abductors) flagged as
 * such.
 *
 * Used by Tile 1 of the Week page to render volume vs target zones.
 *
 * Numbers come from Renaissance Periodization's "Training Volume Landmarks
 * for Muscle Growth" (2025 update). MAV is per-session in RP's framing; we
 * store min/max **per WEEK** here because the Week page deals in weekly
 * working-set totals. Multiply RP's per-session range by sessions/week if
 * adapting upstream.
 *
 * MRV is **frequency-dependent** in current RP guidance. We store it as a
 * `mrvAt(freq)` function (and a frequency table) so a frequency picker can
 * be added later without a schema change.
 *
 * Glutes MEV = 0 reflects RP's stance that direct glute work is hypertrophy
 * BONUS — squats, RDLs, and other compound lower-body work already provide
 * the maintenance floor. The MEV (Minimum Effective Volume) for *direct*
 * glute work to add growth on top of that is therefore zero.
 *
 * Hip abductors are extrapolated. RP folds them under "glutes" in their
 * direct work taxonomy and doesn't publish a standalone landmark set.
 *
 * `slug` here corresponds to the Week-page priority muscle keys, which
 * MUST be a subset of the canonical 18-slug `muscles` table (see
 * `src/lib/muscles.ts`). Earlier drafts split rear/side delts and
 * mid/lower traps into separate landmark rows, but the canonical
 * `summary.setsByMuscle` taxonomy uses single `delts` and split
 * `mid_traps` / `lower_traps` rows — the split landmarks therefore
 * silently collided and undercounted. We now use a SINGLE `delts` entry
 * (combined RP-2025 rear+side guidance) and a SINGLE `traps` entry that
 * resolves to whichever traps row the canonical taxonomy provides.
 */

export type LandmarkSource = 'RP-2025' | 'extrapolated';

/** Sessions/week the muscle is trained at. Used to look up MRV. */
export type Frequency = 2 | 3 | 4 | 5;

export interface VolumeLandmark {
  /** Priority-muscle slug used by Week-page tiles. */
  slug: string;
  /** Display label rendered in UI. */
  display_name: string;
  /** Maintenance Volume — minimum sets/week to maintain current size. */
  mv: number;
  /** Minimum Effective Volume — minimum sets/week to drive growth. */
  mev: number;
  /** Maximum Adaptive Volume range in sets/week (the productive band). */
  mavMin: number;
  mavMax: number;
  /** Maximum Recoverable Volume by training frequency (sessions/week). */
  mrvByFrequency: Partial<Record<Frequency, number>>;
  /** Where the numbers came from. Tile renders an asterisk on extrapolated
   *  rows so Lou knows the data confidence. */
  source: LandmarkSource;
  /** Optional explanatory note shown in UI tooltip. */
  note?: string;
}

const LANDMARKS: Record<string, VolumeLandmark> = {
  glutes: {
    slug: 'glutes',
    display_name: 'Glutes',
    mv: 0,
    // Glutes MEV = 0 because squats / RDLs / lunges already provide the
    // maintenance floor via indirect work. Direct glute work is bonus
    // hypertrophy stimulus, not a maintenance floor.
    mev: 0,
    mavMin: 4,
    mavMax: 12,
    mrvByFrequency: { 2: 12, 3: 18, 4: 25 },
    source: 'RP-2025',
    note: 'MEV=0 because indirect work (squats/RDLs) already maintains glutes.',
  },
  lats: {
    slug: 'lats',
    display_name: 'Lats',
    mv: 8,
    mev: 10,
    mavMin: 14,
    mavMax: 22,
    mrvByFrequency: { 2: 20, 3: 25, 4: 30 },
    source: 'RP-2025',
  },
  delts: {
    slug: 'delts',
    // RP-2025 combined rear/side delts entry. The canonical muscle
    // taxonomy uses a single `delts` row, so we keep landmarks aligned
    // with it. Numbers are the conservative side-delt MRV column (RP
    // groups rear delts under it in the 2025 update); rear-delt-specific
    // volume can still be tracked via the anchor-lift trend tile.
    display_name: 'Delts',
    mv: 6,
    mev: 8,
    mavMin: 16,
    mavMax: 22,
    mrvByFrequency: { 2: 25, 3: 30, 4: 35 },
    source: 'RP-2025',
  },
  chest: {
    slug: 'chest',
    display_name: 'Chest',
    mv: 4,
    mev: 8,
    mavMin: 12,
    mavMax: 20,
    mrvByFrequency: { 4: 22 },
    source: 'RP-2025',
  },
  quads: {
    slug: 'quads',
    display_name: 'Quads',
    mv: 6,
    mev: 8,
    mavMin: 12,
    mavMax: 18,
    mrvByFrequency: { 4: 20 },
    source: 'RP-2025',
  },
  hamstrings: {
    slug: 'hamstrings',
    display_name: 'Hamstrings',
    mv: 3,
    mev: 6,
    mavMin: 10,
    mavMax: 16,
    mrvByFrequency: { 4: 20 },
    source: 'RP-2025',
  },
  hip_abductors: {
    slug: 'hip_abductors',
    display_name: 'Hip abductors',
    mv: 0,
    mev: 4,
    mavMin: 6,
    mavMax: 12,
    mrvByFrequency: { 4: 14 },
    // RP subsumes hip abductors under "glutes" in their published landmarks.
    // Numbers here are extrapolated as ~half of glute volume — appropriate
    // for the smaller muscle. Clearly flagged so UI can asterisk the row.
    source: 'extrapolated',
    note: 'RP groups hip abductors under glutes; numbers extrapolated.',
  },
  calves: {
    slug: 'calves',
    display_name: 'Calves',
    mv: 6,
    mev: 8,
    mavMin: 12,
    mavMax: 16,
    mrvByFrequency: { 4: 20 },
    source: 'RP-2025',
  },
  triceps: {
    slug: 'triceps',
    display_name: 'Triceps',
    mv: 4,
    mev: 6,
    mavMin: 10,
    mavMax: 14,
    mrvByFrequency: { 4: 18 },
    source: 'RP-2025',
  },
  biceps: {
    slug: 'biceps',
    display_name: 'Biceps',
    mv: 4,
    mev: 6,
    mavMin: 10,
    mavMax: 14,
    mrvByFrequency: { 4: 18 },
    source: 'RP-2025',
  },
  traps: {
    slug: 'traps',
    display_name: 'Traps',
    mv: 0,
    mev: 4,
    mavMin: 8,
    mavMax: 12,
    mrvByFrequency: { 4: 16 },
    source: 'RP-2025',
  },
  forearms: {
    slug: 'forearms',
    display_name: 'Forearms',
    mv: 0,
    mev: 4,
    mavMin: 6,
    mavMax: 10,
    mrvByFrequency: { 4: 12 },
    source: 'RP-2025',
  },
  core: {
    slug: 'core',
    display_name: 'Abs / core',
    mv: 0,
    mev: 6,
    mavMin: 12,
    mavMax: 20,
    mrvByFrequency: { 4: 25 },
    source: 'RP-2025',
  },
};

/** All landmarks as an immutable map. */
export const VOLUME_LANDMARKS: Readonly<Record<string, VolumeLandmark>> = LANDMARKS;

/** Lookup a landmark by slug. Returns undefined for unknown slugs so the UI
 *  can fall back to the generic Schoenfeld 10–20 sets/week range. */
export function landmarkFor(slug: string): VolumeLandmark | undefined {
  return LANDMARKS[slug];
}

/**
 * Resolve the binding MRV value for a landmark + a training frequency.
 * Falls back to the highest frequency for which a value exists when the
 * caller's frequency isn't explicitly tabulated (e.g. chest at freq=2 falls
 * back to the freq=4 entry — the conservative single-value RP publishes).
 */
export function mrvAt(landmark: VolumeLandmark, frequency: Frequency): number {
  const exact = landmark.mrvByFrequency[frequency];
  if (exact != null) return exact;
  // Fallback: pick the value at the closest tabulated frequency (preferring
  // higher freq when ties, since most rows only carry the freq=4 value).
  const tabulated = (Object.entries(landmark.mrvByFrequency) as [string, number][])
    .map(([k, v]) => [Number(k) as Frequency, v] as const)
    .sort((a, b) => Math.abs(a[0] - frequency) - Math.abs(b[0] - frequency) || b[0] - a[0]);
  return tabulated[0]?.[1] ?? 0;
}

export type Zone = 'under' | 'in-zone' | 'over' | 'risk';

/**
 * Classify a weekly effective set count into a zone given a landmark + the
 * training frequency for that muscle this week.
 *
 *   under   — below MEV (not enough stimulus for growth)
 *   in-zone — between MEV and MAV.max (productive growth band)
 *   over    — between MAV.max and MRV (works but high recovery cost)
 *   risk    — at or above MRV (overreaching territory)
 *
 * Note: MV (maintenance volume) is informational only here. Sub-MV is still
 * "under" since growth is the goal.
 */
export function zoneFor(
  effectiveSetCount: number,
  frequencyThisWeek: Frequency,
  landmark: VolumeLandmark,
): Zone {
  const mrv = mrvAt(landmark, frequencyThisWeek);
  if (effectiveSetCount >= mrv) return 'risk';
  if (effectiveSetCount > landmark.mavMax) return 'over';
  if (effectiveSetCount >= landmark.mev) return 'in-zone';
  return 'under';
}
