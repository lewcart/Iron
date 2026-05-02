// Standard rep windows. Single source of truth for the app, MCP, and the
// progression rule. Backend, frontend, and AI agents all import from here so
// the vocabulary never drifts.
//
// Movement-type defaults (the audit pass uses these, the routine editor
// suggests them):
//   - 1RM PR work / heavy bilateral compounds → Strength (4–6)
//   - Stable compounds (squat, DL, bench, OHP, heavy hip thrust) → Power (6–8)
//   - Stable accessories + most lifts (RDL, leg press, rows) → Build (8–12)
//   - Isolation / single-joint (curls, raises, kickbacks) → Build or Pump
//   - Stability / unilateral (Bulgarian, single-leg RDL, Copenhagen) → Build
//
// Endurance (15–30) is a catch-only window — never selected explicitly. It
// exists so the progression rule can recognize sets that drift past 15 reps
// without silently coercing them into Pump.
//
// Boundary policy: the upper bound is INCLUSIVE. A set of exactly 8 reps stays
// in Power; only the 9th rep escalates the lifter into Build. The next-window
// boundary is the trigger to add load, not the goal-window edge.

export const REP_WINDOWS = {
  strength:  { min: 4,  max: 6,  label: 'Strength' },
  power:     { min: 6,  max: 8,  label: 'Power' },
  build:     { min: 8,  max: 12, label: 'Build' },
  pump:      { min: 12, max: 15, label: 'Pump' },
  endurance: { min: 15, max: 30, label: 'Endurance' },
} as const;

export type RepWindow = keyof typeof REP_WINDOWS;

/** Ordered low-to-high so "next window up/down" is a single index step. */
export const REP_WINDOW_ORDER: readonly RepWindow[] = [
  'strength', 'power', 'build', 'pump', 'endurance',
] as const;

/** Returns the window a given rep count falls into. Boundary policy: lower
 *  window claims shared edges (6 → strength, 8 → power, 12 → build, 15 → pump).
 *  Below the strength minimum returns null. */
export function windowForReps(reps: number): RepWindow | null {
  if (reps < REP_WINDOWS.strength.min) return null;
  if (reps <= REP_WINDOWS.strength.max) return 'strength';
  if (reps <= REP_WINDOWS.power.max) return 'power';
  if (reps <= REP_WINDOWS.build.max) return 'build';
  if (reps <= REP_WINDOWS.pump.max) return 'pump';
  return 'endurance';
}

/** Snap an explicit (min, max) rep range to a registered window via exact
 *  match. Returns null for custom ranges that don't match any window
 *  (e.g., 5–15) — the audit pass uses null as a "needs review" signal. */
export function snapToWindow(min: number, max: number): RepWindow | null {
  for (const key of REP_WINDOW_ORDER) {
    const w = REP_WINDOWS[key];
    if (w.min === min && w.max === max) return key;
  }
  return null;
}

/** Next window toward more reps. Null at the top (Endurance). */
export function nextWindowUp(window: RepWindow): RepWindow | null {
  const idx = REP_WINDOW_ORDER.indexOf(window);
  if (idx < 0 || idx === REP_WINDOW_ORDER.length - 1) return null;
  return REP_WINDOW_ORDER[idx + 1];
}

/** Next window toward fewer reps. Null at the bottom (Strength). */
export function nextWindowDown(window: RepWindow): RepWindow | null {
  const idx = REP_WINDOW_ORDER.indexOf(window);
  if (idx <= 0) return null;
  return REP_WINDOW_ORDER[idx - 1];
}

/** Convenience — returns the {min, max} for a window. */
export function windowBounds(window: RepWindow): { min: number; max: number } {
  return { min: REP_WINDOWS[window].min, max: REP_WINDOWS[window].max };
}
