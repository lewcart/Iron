/**
 * GET /api/health/snapshot?days=28&as_of=YYYY-MM-DD
 *
 * Server-side wrapper that returns the daily HRV series + last-night sleep
 * for the Week page Recovery tile. Mirrors the existing
 * /api/health/sleep-summary route shape (status codes + error envelopes).
 *
 * Query params:
 *   days    — baseline window length in days (default 28, max 90)
 *   as_of   — YYYY-MM-DD reference date (default: today)
 *
 * Status codes (matches /src/app/api convention):
 *   200 — success, body is { hrv_daily, last_night_sleep, range, as_of }
 *   400 — invalid input
 *   401 — REBIRTH_API_KEY missing or wrong
 *   503 — HealthKit not connected
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import {
  getHealthKitConnectionStatus,
  getHrvDailySeries,
  getLastNightSleep,
} from '@/lib/server/health-data';

const MAX_WINDOW_DAYS = 90;

export interface HealthSnapshotResponse {
  as_of: string;
  range: { start_date: string; end_date: string };
  hrv_daily: { date: string; value_avg: number }[];
  last_night_sleep: Awaited<ReturnType<typeof getLastNightSleep>>;
}

export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;

  const conn = await getHealthKitConnectionStatus();
  if (conn !== 'connected') {
    const reason = conn === 'unavailable' ? 'unavailable'
      : conn === 'revoked' ? 'revoked'
      : 'not_requested';
    return NextResponse.json(
      {
        status: 'not_connected',
        reason,
        message: 'Open Rebirth → Settings → Apple Health to connect HealthKit data.',
      },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const asOf = (url.searchParams.get('as_of') ?? today).slice(0, 10);
  if (asOf > today) {
    return NextResponse.json(
      { status: 'invalid_input', message: 'as_of cannot be in the future', hint: 'Use today or earlier.' },
      { status: 400 },
    );
  }
  const daysRaw = url.searchParams.get('days');
  const days = daysRaw ? Number(daysRaw) : 28;
  if (!Number.isFinite(days) || days < 1 || days > MAX_WINDOW_DAYS) {
    return NextResponse.json(
      { status: 'invalid_input', message: `days must be 1..${MAX_WINDOW_DAYS}`, hint: 'Default 28.' },
      { status: 400 },
    );
  }

  const asOfMs = Date.parse(asOf);
  const startMs = asOfMs - (days - 1) * 86400000;
  const startDate = new Date(startMs).toISOString().slice(0, 10);

  const [hrvDaily, lastNight] = await Promise.all([
    getHrvDailySeries(startDate, asOf),
    getLastNightSleep(asOf),
  ]);

  const body: HealthSnapshotResponse = {
    as_of: asOf,
    range: { start_date: startDate, end_date: asOf },
    hrv_daily: hrvDaily.map(r => ({ date: r.date, value_avg: r.value_avg })),
    last_night_sleep: lastNight,
  };
  return NextResponse.json(body);
}
