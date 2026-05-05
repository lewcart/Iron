/**
 * GET /api/health/cardio-trend?weeks=12
 *
 * Returns N weekly cardio totals (oldest → newest) so the Week page's
 * TwelveWeekTrendsSection can plot a sparkline. Mirrors the cardio-week
 * route's auth + connection envelope; loops `computeCardioWeek` per ISO
 * Monday to assemble the trend.
 *
 * Query params:
 *   weeks  — number of weekly buckets, 1..12 (default 12)
 *
 * Status codes:
 *   200 — { status: 'ok', weekly, target_total_minutes }
 *   200 — { status: 'no_targets', weekly, target_total_minutes: null, message }
 *   400 — { status: 'invalid_input', message, hint }
 *   401 — REBIRTH_API_KEY missing or wrong
 *   503 — { status: 'not_connected', reason, message }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import {
  getHealthKitConnectionStatus,
  computeCardioWeek,
} from '@/lib/server/health-data';

const DEFAULT_WEEKS = 12;
const MIN_WEEKS = 1;
const MAX_WEEKS = 12;

/** Most recent ISO Monday on or before `today`, as YYYY-MM-DD. */
function isoMonday(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  const dow = m.getDay(); // 0=Sun..6=Sat
  m.setDate(m.getDate() + (dow === 0 ? -6 : 1 - dow));
  return m;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  const weeksRaw = url.searchParams.get('weeks');
  const weeks = weeksRaw == null ? DEFAULT_WEEKS : Number(weeksRaw);
  if (!Number.isFinite(weeks) || weeks < MIN_WEEKS || weeks > MAX_WEEKS) {
    return NextResponse.json(
      {
        status: 'invalid_input',
        message: `weeks must be ${MIN_WEEKS}..${MAX_WEEKS}`,
        hint: `Default ${DEFAULT_WEEKS}.`,
      },
      { status: 400 },
    );
  }

  // Build [N weeks ago … this week] as Monday-anchored windows. Oldest
  // first so the sparkline reads left-to-right as time advancing.
  const thisMonday = isoMonday(new Date());
  const windows: { start: string; end: string }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const monday = new Date(thisMonday);
    monday.setDate(monday.getDate() - i * 7);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    windows.push({ start: ymd(monday), end: ymd(sunday) });
  }

  const results = await Promise.all(
    windows.map(w => computeCardioWeek(w.start, w.end)),
  );

  const weekly = results.map(r => r.totals.total);
  // Targets are a plan-level constant — pull from the most recent (last)
  // week's response. `targets.total` is the umbrella weekly target if
  // sub-targets aren't set, else the sum.
  const lastTargets = results[results.length - 1]?.targets;
  const target_total_minutes = lastTargets?.total ?? null;

  const anyTargets = results.some(r => r.targets.any_set);
  if (!anyTargets) {
    return NextResponse.json({
      status: 'no_targets',
      weekly,
      target_total_minutes: null,
      message:
        "No cardio targets set on the active body plan. Set " +
        "programming_dose.cardio_floor_minutes_weekly (or zone2/intervals " +
        "sub-targets) on the active plan to enable the cardio trend chip.",
    });
  }

  return NextResponse.json({
    status: 'ok',
    weekly,
    target_total_minutes,
  });
}
