import { query, queryOne } from '@/db/db';
import { consistencyScore } from '@/lib/sleep-stats';

/** Maximum window the sleep summary will return. Inputs > 90 days are silently capped. */
export const MAX_WINDOW_DAYS = 90;

export const SLEEP_SUMMARY_FIELDS = ['range', 'averages', 'consistency', 'hrv', 'nights', 'data_quality'] as const;
export type SleepSummaryField = typeof SLEEP_SUMMARY_FIELDS[number];

export interface SleepSummaryArgs {
  start_date?: string;     // YYYY-MM-DD
  end_date?: string;       // YYYY-MM-DD; default today
  window_days?: number;    // alternative to start_date; default 7
  fields?: SleepSummaryField[]; // optional projection; nights opts in
}

export type SleepSummaryError = {
  status: 'invalid_range' | 'invalid_input';
  message: string;
  hint: string;
};

export interface SleepSummaryResult {
  range?: { start_date: string; end_date: string; n_nights: number; timezone: 'Europe/London' };
  averages?: {
    asleep_min: number; in_bed_min: number;
    deep_min: number; deep_pct: number | null;
    rem_min: number;  rem_pct: number | null;
    core_min: number; core_pct: number | null;
    awake_min: number; awake_pct: number | null;
    sleep_efficiency_pct: number | null;
  } | null;
  consistency?: ReturnType<typeof consistencyScore>;
  hrv?: {
    last: number | null;
    window_avg: number | null;
    baseline_30d_avg: number | null;
    delta_pct: number | null;
    n_days: number;
  } | null;
  nights?: Array<{
    wake_date: string;
    start_at: string | null;
    end_at: string | null;
    asleep_min: number;
    in_bed_min: number;
    deep_min: number;
    rem_min: number;
    core_min: number;
    awake_min: number;
  }>;
  data_quality?: {
    missing_sleep_dates: string[];
    missing_envelope_dates: string[];
    window_capped: boolean;
  };
}

/**
 * Compute a sleep + recovery rollup for a date range. Errors short-circuit
 * with a typed `SleepSummaryError`. Caller is responsible for connection
 * checks (HealthKit `getHealthKitStatus`) — this function assumes connected.
 */
export async function computeSleepSummary(
  args: SleepSummaryArgs,
): Promise<SleepSummaryResult | SleepSummaryError> {
  const today = new Date().toISOString().slice(0, 10);
  const endDate = typeof args.end_date === 'string' ? args.end_date.slice(0, 10) : today;
  if (endDate > today) {
    return { status: 'invalid_range', message: 'end_date cannot be in the future', hint: 'Use today or earlier.' };
  }

  let startDate: string;
  let windowCapped = false;
  if (typeof args.start_date === 'string') {
    startDate = args.start_date.slice(0, 10);
    if (startDate > endDate) {
      return { status: 'invalid_range', message: 'start_date must be ≤ end_date', hint: 'Pass YYYY-MM-DD strings.' };
    }
    const startMs = Date.parse(startDate);
    const endMs = Date.parse(endDate);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return { status: 'invalid_range', message: 'invalid date format', hint: 'YYYY-MM-DD.' };
    }
    const days = Math.round((endMs - startMs) / 86400000);
    if (days > MAX_WINDOW_DAYS) {
      startDate = new Date(endMs - MAX_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
      windowCapped = true;
    }
  } else {
    const w = typeof args.window_days === 'number' && Number.isFinite(args.window_days)
      ? args.window_days
      : 7;
    if (w < 1 || w > MAX_WINDOW_DAYS) {
      return { status: 'invalid_input', message: `window_days must be 1..${MAX_WINDOW_DAYS}`, hint: 'Default 7.' };
    }
    const endMs = Date.parse(endDate);
    startDate = new Date(endMs - (w - 1) * 86400000).toISOString().slice(0, 10);
  }

  const fieldsArg = Array.isArray(args.fields)
    ? args.fields.filter((f): f is SleepSummaryField =>
        SLEEP_SUMMARY_FIELDS.includes(f as SleepSummaryField))
    : null;
  const includes = (f: SleepSummaryField) => fieldsArg == null || fieldsArg.includes(f);

  const nightRows = await query<{
    wake_date: string;
    start_at: string | null;
    end_at: string | null;
    asleep_min: number;
    rem_min: number;
    deep_min: number;
    core_min: number;
    awake_min: number;
    in_bed_min: number;
  }>(
    `SELECT to_char(wake_date, 'YYYY-MM-DD') AS wake_date,
            to_char(start_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_at,
            to_char(end_at,   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_at,
            asleep_min, rem_min, deep_min, core_min, awake_min, in_bed_min
       FROM healthkit_sleep_nights
      WHERE wake_date >= $1::date AND wake_date <= $2::date AND is_main = TRUE
      ORDER BY wake_date DESC`,
    [startDate, endDate],
  );

  const out: SleepSummaryResult = {};

  if (includes('range')) {
    out.range = {
      start_date: startDate,
      end_date: endDate,
      n_nights: nightRows.length,
      timezone: 'Europe/London',
    };
  }

  if (includes('averages')) {
    if (nightRows.length === 0) {
      out.averages = null;
    } else {
      const n = nightRows.length;
      const sumKey = (k: 'asleep_min' | 'in_bed_min' | 'rem_min' | 'deep_min' | 'core_min' | 'awake_min') =>
        nightRows.reduce((acc, r) => acc + Number(r[k] ?? 0), 0);
      const asleep = sumKey('asleep_min') / n;
      const inBed = sumKey('in_bed_min') / n;
      const deep = sumKey('deep_min') / n;
      const rem = sumKey('rem_min') / n;
      const core = sumKey('core_min') / n;
      const awake = sumKey('awake_min') / n;
      const pct = (x: number) => asleep > 0 ? Math.round((x / asleep) * 1000) / 10 : null;
      out.averages = {
        asleep_min: Math.round(asleep),
        in_bed_min: Math.round(inBed),
        deep_min: Math.round(deep), deep_pct: pct(deep),
        rem_min: Math.round(rem),   rem_pct:  pct(rem),
        core_min: Math.round(core), core_pct: pct(core),
        awake_min: Math.round(awake), awake_pct: pct(awake),
        sleep_efficiency_pct: inBed > 0 ? Math.round((asleep / inBed) * 1000) / 10 : null,
      };
    }
  }

  if (includes('consistency')) {
    out.consistency = consistencyScore(
      nightRows.map(r => ({
        start_at: r.start_at ? new Date(r.start_at) : null,
        end_at: r.end_at ? new Date(r.end_at) : null,
      })),
    );
  }

  if (includes('hrv')) {
    const baselineStart = new Date(Date.parse(endDate) - 30 * 86400000).toISOString().slice(0, 10);
    const window = await queryOne<{ avg: number | null; n: number }>(
      `SELECT AVG(value_avg)::float AS avg, COUNT(*)::int AS n FROM healthkit_daily
        WHERE metric = 'hrv' AND date >= $1::date AND date <= $2::date`,
      [startDate, endDate],
    );
    const baseline = await queryOne<{ avg: number | null }>(
      `SELECT AVG(value_avg)::float AS avg FROM healthkit_daily
        WHERE metric = 'hrv' AND date > $1::date AND date <= $2::date`,
      [baselineStart, endDate],
    );
    const last = await queryOne<{ value_avg: number | null }>(
      `SELECT value_avg FROM healthkit_daily
        WHERE metric = 'hrv' AND date <= $1::date ORDER BY date DESC LIMIT 1`,
      [endDate],
    );
    if (window?.avg != null || baseline?.avg != null || last?.value_avg != null) {
      const deltaPct = (window?.avg != null && baseline?.avg != null && baseline.avg > 0)
        ? Math.round(((window.avg - baseline.avg) / baseline.avg) * 1000) / 10
        : null;
      out.hrv = {
        last: last?.value_avg ?? null,
        window_avg: window?.avg ?? null,
        baseline_30d_avg: baseline?.avg ?? null,
        delta_pct: deltaPct,
        n_days: window?.n ?? 0,
      };
    } else {
      out.hrv = null;
    }
  }

  if (fieldsArg != null && fieldsArg.includes('nights')) {
    out.nights = nightRows.map(r => ({
      wake_date: r.wake_date,
      start_at: r.start_at,
      end_at: r.end_at,
      asleep_min: Number(r.asleep_min),
      in_bed_min: Number(r.in_bed_min),
      deep_min: Number(r.deep_min),
      rem_min: Number(r.rem_min),
      core_min: Number(r.core_min),
      awake_min: Number(r.awake_min),
    }));
  }

  if (includes('data_quality')) {
    const expectedDates: string[] = [];
    const startMs = Date.parse(startDate);
    const endMs = Date.parse(endDate);
    for (let t = startMs; t <= endMs; t += 86400000) {
      expectedDates.push(new Date(t).toISOString().slice(0, 10));
    }
    const presentDates = new Set(nightRows.map(r => r.wake_date));
    const envelopeDates = new Set(
      nightRows.filter(r => r.start_at && r.end_at).map(r => r.wake_date),
    );
    out.data_quality = {
      missing_sleep_dates: expectedDates.filter(d => !presentDates.has(d)),
      missing_envelope_dates: expectedDates.filter(d => presentDates.has(d) && !envelopeDates.has(d)),
      window_capped: windowCapped,
    };
  }

  return out;
}
