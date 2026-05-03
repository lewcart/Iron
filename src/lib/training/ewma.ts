/**
 * Hacker's Diet 0.1 EWMA (Exponentially Weighted Moving Average).
 *
 * Reference: John Walker, "The Hacker's Diet — Signal and Noise."
 * https://www.fourmilab.ch/hackdiet/e4/signalnoise.html
 *
 * The 0.1 alpha gives a ~10-day half-life — enough to strip ±0.3–1.5 lb of
 * daily fluid noise while still surfacing the real ~0.3 lb/day max fat-loss
 * signal. Lou is on HRT, which adds another 1–3 lb noise per injection
 * cycle; a 10-day smoothing window survives that too.
 *
 * Series points must be SORTED ASCENDING by date before being passed in.
 * Caller responsibility — we do not sort here because re-sorting on every
 * render is wasteful.
 */

export interface WeightPoint {
  /** YYYY-MM-DD. Used for keying / display only — not required to be unique. */
  date: string;
  /** Weight in kg (or lb — units are caller's responsibility). */
  weight: number;
}

export interface EwmaPoint extends WeightPoint {
  /** Smoothed value at this point. */
  ewma: number;
}

/** The 0.1 smoothing constant from Walker's book. Exposed for tests. */
export const HACKERS_DIET_ALPHA = 0.1;

/**
 * Compute the EWMA series for a sorted-ascending list of weight points.
 *
 * Behavior:
 *   - Empty input → empty output. Caller renders empty-state.
 *   - Single point → that point's weight is its EWMA (no history to smooth).
 *   - n>1: standard EWMA with alpha=0.1, seeded from the first point's
 *     raw weight (Walker's seed strategy).
 */
export function computeEwma(
  points: readonly WeightPoint[],
  alpha: number = HACKERS_DIET_ALPHA,
): EwmaPoint[] {
  if (points.length === 0) return [];

  const out: EwmaPoint[] = [];
  let prev = points[0].weight;
  out.push({ ...points[0], ewma: round1(prev) });

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const ewma = prev + alpha * (p.weight - prev);
    out.push({ ...p, ewma: round1(ewma) });
    prev = ewma;
  }

  return out;
}

/** Latest smoothed value (returns undefined for empty input). */
export function latestEwma(points: readonly WeightPoint[]): number | undefined {
  const series = computeEwma(points);
  return series.length === 0 ? undefined : series[series.length - 1].ewma;
}

/**
 * Compute the EWMA delta over a date window.
 *
 * Returns the smoothed-value difference between the last point and the
 * earliest point at or before `(latestDate - windowDays)`. Returns null
 * when there isn't enough history to anchor the start of the window.
 */
export function ewmaDeltaOverDays(
  points: readonly WeightPoint[],
  windowDays: number,
): number | null {
  const series = computeEwma(points);
  if (series.length < 2) return null;

  const last = series[series.length - 1];
  const lastMs = Date.parse(last.date);
  if (!Number.isFinite(lastMs)) return null;

  const cutoffMs = lastMs - windowDays * 86400000;

  // Find the latest point whose date is ≤ cutoff. If no such point exists,
  // the window predates our data and we return null (UI should suppress
  // the delta until we have history).
  let anchor: EwmaPoint | undefined;
  for (let i = 0; i < series.length; i++) {
    const ms = Date.parse(series[i].date);
    if (!Number.isFinite(ms)) continue;
    if (ms <= cutoffMs) anchor = series[i];
    else break;
  }
  if (!anchor) return null;

  return round1(last.ewma - anchor.ewma);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
