/**
 * Server-side HealthKit query helpers shared between the MCP tool surface
 * (`mcp-tools.ts`) and the REST routes under `src/app/api/health/*`.
 *
 * Phase 1 (this file): connection-status + HRV daily series — used by the
 * Week page recovery tile via `/api/health/snapshot`. The MCP tool's
 * existing implementations in `mcp-tools.ts` continue to work unchanged;
 * this is an additive extract that the new REST route depends on. Future
 * passes can DRY the duplication.
 */

import { query, queryOne } from '@/db/db';
import {
  classifyActivityType,
  aggregateMinutes,
  type CardioCategory,
  type CardioMinutesByCategory,
} from '@/lib/training/cardio-classification';
import {
  resolveCardioTargets,
  type CardioTargets,
} from '@/lib/vision/programming-dose';

export type HealthKitConnectionStatus =
  | 'connected'
  | 'not_requested'
  | 'revoked'
  | 'unavailable';

/**
 * Same logic as the in-route helpers in `sleep-summary/route.ts` and the
 * MCP `getHealthKitStatus()` — extracted so we don't duplicate four slightly
 * different copies. Returns the connection state at the time of call.
 */
export async function getHealthKitConnectionStatus(): Promise<HealthKitConnectionStatus> {
  const states = await query<{
    last_successful_sync_at: string | null;
    last_error: string | null;
  }>(`SELECT last_successful_sync_at, last_error FROM healthkit_sync_state`);
  if (states.length === 0) return 'not_requested';
  const allRevoked = states.every(s => s.last_error === 'permission_revoked');
  if (allRevoked) return 'revoked';
  const anySuccess = states.some(s => s.last_successful_sync_at != null);
  if (!anySuccess) return 'not_requested';
  return 'connected';
}

export interface HrvDailyRow {
  date: string;       // YYYY-MM-DD
  value_avg: number;  // ms
}

/**
 * Fetch daily-mean HRV samples in `[from, to]` inclusive. Returns an empty
 * array when nothing is recorded — the caller (`computeHrvBalance`) decides
 * whether that triggers a needs-data state.
 */
export async function getHrvDailySeries(
  from: string,
  to: string,
): Promise<HrvDailyRow[]> {
  const rows = await query<{ date: string; value_avg: number | null }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, value_avg
       FROM healthkit_daily
      WHERE metric = 'hrv' AND date >= $1::date AND date <= $2::date
      ORDER BY date`,
    [from, to],
  );
  return rows
    .filter((r): r is { date: string; value_avg: number } => r.value_avg != null)
    .map(r => ({ date: r.date, value_avg: r.value_avg }));
}

/**
 * Fetch the most-recent night of sleep summary metrics. Returns null when
 * no nights are recorded.
 */
export interface LastNightSleep {
  date: string;
  asleep_min: number | null;
  in_bed_min: number | null;
  rem_min: number | null;
  deep_min: number | null;
  core_min: number | null;
  awake_min: number | null;
}

export async function getLastNightSleep(asOf: string): Promise<LastNightSleep | null> {
  const yesterday = new Date(Date.parse(asOf) - 86400000).toISOString().slice(0, 10);
  const rows = await query<{ metric: string; value_sum: number | null }>(
    `SELECT metric, value_sum FROM healthkit_daily
      WHERE date = $1 AND metric LIKE 'sleep_%'`,
    [yesterday],
  );
  if (rows.length === 0) return null;
  const byMetric = Object.fromEntries(rows.map(r => [r.metric, r.value_sum]));
  return {
    date: yesterday,
    asleep_min: numOrNull(byMetric['sleep_asleep']),
    in_bed_min: numOrNull(byMetric['sleep_inbed']),
    rem_min: numOrNull(byMetric['sleep_rem']),
    deep_min: numOrNull(byMetric['sleep_deep']),
    core_min: numOrNull(byMetric['sleep_core']),
    awake_min: numOrNull(byMetric['sleep_awake']),
  };
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Cardio week (v1.1) ───────────────────────────────────────────────────

export interface CardioWeekDay {
  /** YYYY-MM-DD (local). */
  date: string;
  zone2_minutes: number;
  intervals_minutes: number;
}

export interface CardioWeekResult {
  status: 'ok' | 'no_targets';
  /** Inclusive date window the totals cover. */
  range: { start_date: string; end_date: string };
  /** Per-category total minutes across the window. */
  totals: CardioMinutesByCategory;
  /** Per-day breakdown across the window (one entry per day, oldest first). */
  daily: CardioWeekDay[];
  /** Resolved cardio targets from the active body_plan.programming_dose. */
  targets: CardioTargets;
  /**
   * When `targets.any_set === false`, this is set to "no_targets" with a
   * human message; the route returns it as 200 (still a valid response,
   * just nothing to render). Mirrors the existing `not_connected` shape.
   */
  message?: string;
}

interface CardioWorkoutRow {
  start_at: string;
  end_at: string;
  activity_type: string;
  duration_s: number;
}

/**
 * Pull the `programming_dose` JSONB blob from the active body_plan.
 * Returns null when no active plan exists.
 */
async function getActivePlanProgrammingDose(): Promise<unknown | null> {
  const row = await queryOne<{ programming_dose: unknown }>(
    `SELECT programming_dose FROM body_plan WHERE status = 'active' LIMIT 1`,
  );
  return row?.programming_dose ?? null;
}

/**
 * Pull all healthkit_workouts in `[from, to]` (inclusive). The window is
 * compared against `start_at` so a workout that started on the last day of
 * the window counts even if it ran past midnight.
 */
async function getCardioWorkoutsForRange(
  from: string,
  to: string,
): Promise<CardioWorkoutRow[]> {
  // Make `to` inclusive of the entire end date by extending to end-of-day.
  const toExclusive = `${to}T23:59:59.999Z`;
  const rows = await query<CardioWorkoutRow>(
    `SELECT start_at::text AS start_at,
            end_at::text   AS end_at,
            activity_type,
            duration_s
       FROM healthkit_workouts
      WHERE start_at >= $1::timestamptz
        AND start_at <= $2::timestamptz
      ORDER BY start_at`,
    [`${from}T00:00:00.000Z`, toExclusive],
  );
  return rows;
}

/**
 * Compute cardio compliance for a week-shaped window.
 *
 * Parameters:
 *   start_date — YYYY-MM-DD inclusive (local)
 *   end_date   — YYYY-MM-DD inclusive (local)
 *
 * Returns a CardioWeekResult. When the active body_plan has no cardio
 * targets (`programming_dose.cardio_*_minutes_weekly` all unset), returns
 * status: 'no_targets' so the caller can render an empty state without
 * treating it as an error. HealthKit-not-connected is handled separately
 * by the route layer (mirrors snapshot pattern).
 */
export async function computeCardioWeek(
  start_date: string,
  end_date: string,
): Promise<CardioWeekResult> {
  const [rawDose, workouts] = await Promise.all([
    getActivePlanProgrammingDose(),
    getCardioWorkoutsForRange(start_date, end_date),
  ]);
  const targets = resolveCardioTargets(rawDose);

  // Classify each workout, then aggregate.
  const classified = workouts.map(w => {
    const durationMin = (w.duration_s ?? 0) / 60;
    return {
      start_date: w.start_at.slice(0, 10),
      category: classifyActivityType(w.activity_type, durationMin),
      duration_minutes: durationMin,
    };
  });
  const totals = aggregateMinutes(classified);

  // Build per-day daily breakdown across the window. Even days with no
  // cardio get a row (zero values) so the UI can render a stable bar chart.
  const dailyMap = new Map<string, CardioWeekDay>();
  for (let d = new Date(`${start_date}T00:00:00Z`).getTime();
       d <= new Date(`${end_date}T00:00:00Z`).getTime();
       d += 86_400_000) {
    const date = new Date(d).toISOString().slice(0, 10);
    dailyMap.set(date, { date, zone2_minutes: 0, intervals_minutes: 0 });
  }
  for (const w of classified) {
    const day = dailyMap.get(w.start_date);
    if (!day) continue;
    if (w.category === 'zone2') day.zone2_minutes += w.duration_minutes;
    else if (w.category === 'intervals') day.intervals_minutes += w.duration_minutes;
  }
  const daily = Array.from(dailyMap.values());

  if (!targets.any_set) {
    return {
      status: 'no_targets',
      range: { start_date, end_date },
      totals,
      daily,
      targets,
      message:
        "No cardio targets set on the active body plan. Set " +
        "programming_dose.cardio_floor_minutes_weekly (or zone2/intervals " +
        "sub-targets) on the active plan to enable the cardio tile.",
    };
  }

  return {
    status: 'ok',
    range: { start_date, end_date },
    totals,
    daily,
    targets,
  };
}

// Re-export classification types for downstream consumers (the route + MCP
// tool both want the type without importing from the deeper module path).
export type { CardioCategory, CardioMinutesByCategory } from '@/lib/training/cardio-classification';
export type { CardioTargets } from '@/lib/vision/programming-dose';
