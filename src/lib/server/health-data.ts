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

import { query } from '@/db/db';

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
