/**
 * HRV vs personal baseline — Oura-style "Balance" pattern.
 *
 * Reference:
 *   - HRV4Training "interpreting HRV trends"
 *   - MDPI 2024 narrative review on HRV monitoring
 *
 * 7-day mean vs 28-day baseline ± 1 SD. State:
 *   above   — 7d mean > baseline + 1 SD (suspiciously good — usually noise
 *             or a rebound day; not actionable on its own)
 *   in-band — within ±1 SD (normal; train as planned)
 *   below   — 7d mean < baseline - 1 SD (under-recovered; consider easing)
 *
 * Pure compute layer. The data fetcher (Dexie / API) is in
 * `src/lib/server/health-data.ts`; this module just consumes the daily
 * sample series.
 */

export interface HrvDailyPoint {
  /** YYYY-MM-DD. */
  date: string;
  /** Average HRV (ms) for that day. */
  value: number;
}

export type HrvBalanceState = 'above' | 'in-band' | 'below';

export type HrvBalanceResult =
  | {
      status: 'ok';
      state: HrvBalanceState;
      window_mean: number;
      baseline_mean: number;
      baseline_sd: number;
      /** Days in baseline window with data (out of 28). */
      baseline_days: number;
      /** Days in 7-day window with data. */
      window_days: number;
      /** Streak of consecutive days at the end of the series where the
       *  rolling mean was BELOW the band. Used for "consider easier session"
       *  + "deload candidate" copy. */
      consecutive_below_days: number;
    }
  | {
      status: 'needs-data';
      reason: string;
      baseline_days: number;
    };

const MIN_BASELINE_DAYS = 21; // require ≥21/28 days to claim a baseline

export interface HrvBalanceOpts {
  /** YYYY-MM-DD reference "today". Defaults to the latest sample date. */
  asOf?: string;
  /** Window for the recent mean. Default 7 days. */
  windowDays?: number;
  /** Baseline window. Default 28 days. */
  baselineDays?: number;
  /** Minimum baseline samples to compute. Default 21/28. */
  minBaselineDays?: number;
}

/**
 * Compute HRV balance state from a daily-mean series.
 *
 * The series can be unsorted; we sort internally. Days with no sample are
 * simply absent from the array — we do NOT zero-fill.
 */
export function computeHrvBalance(
  series: readonly HrvDailyPoint[],
  opts: HrvBalanceOpts = {},
): HrvBalanceResult {
  if (series.length === 0) {
    return {
      status: 'needs-data',
      reason: 'No HRV samples in window',
      baseline_days: 0,
    };
  }

  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const asOf = opts.asOf ?? sorted[sorted.length - 1].date;
  const windowDays = opts.windowDays ?? 7;
  const baselineDays = opts.baselineDays ?? 28;
  const minBaseline = opts.minBaselineDays ?? MIN_BASELINE_DAYS;

  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) {
    return { status: 'needs-data', reason: 'Invalid asOf date', baseline_days: 0 };
  }

  const windowStartMs = asOfMs - (windowDays - 1) * 86400000;
  const baselineStartMs = asOfMs - (baselineDays - 1) * 86400000;

  const inWindow: number[] = [];
  const inBaseline: number[] = [];
  for (const p of sorted) {
    const ms = Date.parse(p.date);
    if (!Number.isFinite(ms)) continue;
    if (ms < baselineStartMs || ms > asOfMs) continue;
    inBaseline.push(p.value);
    if (ms >= windowStartMs) inWindow.push(p.value);
  }

  if (inBaseline.length < minBaseline) {
    return {
      status: 'needs-data',
      reason: `HRV baseline calibrating — ${inBaseline.length} of ${baselineDays} days collected`,
      baseline_days: inBaseline.length,
    };
  }
  if (inWindow.length === 0) {
    return {
      status: 'needs-data',
      reason: 'No HRV samples in last 7 days',
      baseline_days: inBaseline.length,
    };
  }

  const window_mean = mean(inWindow);
  const baseline_mean = mean(inBaseline);
  const baseline_sd = stddev(inBaseline, baseline_mean);

  let state: HrvBalanceState = 'in-band';
  if (window_mean > baseline_mean + baseline_sd) state = 'above';
  else if (window_mean < baseline_mean - baseline_sd) state = 'below';

  // Consecutive-below streak at the end of the series — counts days where
  // the daily value was below (baseline_mean - baseline_sd).
  let consecutive_below_days = 0;
  const lowerBand = baseline_mean - baseline_sd;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    const ms = Date.parse(p.date);
    if (!Number.isFinite(ms) || ms > asOfMs) continue;
    if (p.value < lowerBand) consecutive_below_days++;
    else break;
  }

  return {
    status: 'ok',
    state,
    window_mean: round1(window_mean),
    baseline_mean: round1(baseline_mean),
    baseline_sd: round1(baseline_sd),
    baseline_days: inBaseline.length,
    window_days: inWindow.length,
    consecutive_below_days,
  };
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function stddev(xs: readonly number[], m: number): number {
  if (xs.length < 2) return 0;
  let sumSq = 0;
  for (const x of xs) {
    const d = x - m;
    sumSq += d * d;
  }
  // Sample SD (N-1) — appropriate for inferring band width from a sample.
  return Math.sqrt(sumSq / (xs.length - 1));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
