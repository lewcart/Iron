/**
 * GET /api/health/cardio-week?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *           or  ?window_days=7&end_date=YYYY-MM-DD
 *
 * Returns weekly cardio compliance for the Week page CardioComplianceTile.
 * Mirrors /api/health/snapshot's error envelope so the MCP tool surface
 * stays consistent.
 *
 * Query params (one of the date pairs is required):
 *   start_date   — YYYY-MM-DD inclusive (Australia/Brisbane, but stored UTC)
 *   end_date     — YYYY-MM-DD inclusive; defaults to today
 *   window_days  — alternative to start_date: last N days. Range 1..90.
 *
 * Status codes (matches /src/app/api convention):
 *   200 — { status: 'ok',          ... }
 *   200 — { status: 'no_targets',  message }   (active plan has no cardio targets)
 *   400 — { status: 'invalid_input', message, hint }
 *   401 — REBIRTH_API_KEY missing or wrong
 *   503 — { status: 'not_connected', reason, message }   (HealthKit not connected)
 *
 * Activity-type classification only in v1.1 (HR-zone path requires per-second
 * HR samples not in schema yet). Strength workouts are excluded silently.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import {
  getHealthKitConnectionStatus,
  computeCardioWeek,
} from '@/lib/server/health-data';

const MAX_WINDOW_DAYS = 90;
const DEFAULT_WINDOW_DAYS = 7;

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
  const endDate = (url.searchParams.get('end_date') ?? today).slice(0, 10);
  if (endDate > today) {
    return NextResponse.json(
      { status: 'invalid_input', message: 'end_date cannot be in the future', hint: 'Use today or earlier.' },
      { status: 400 },
    );
  }

  // Either start_date OR window_days is allowed; both → start_date wins.
  const startDateRaw = url.searchParams.get('start_date');
  const windowDaysRaw = url.searchParams.get('window_days');

  let startDate: string;
  if (startDateRaw) {
    startDate = startDateRaw.slice(0, 10);
    if (startDate > endDate) {
      return NextResponse.json(
        { status: 'invalid_input', message: 'start_date must be on or before end_date', hint: 'Swap the two values.' },
        { status: 400 },
      );
    }
    const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
    if (days > MAX_WINDOW_DAYS) {
      return NextResponse.json(
        { status: 'invalid_input', message: `Window cannot exceed ${MAX_WINDOW_DAYS} days`, hint: 'Narrow start_date.' },
        { status: 400 },
      );
    }
  } else {
    const windowDays = windowDaysRaw ? Number(windowDaysRaw) : DEFAULT_WINDOW_DAYS;
    if (!Number.isFinite(windowDays) || windowDays < 1 || windowDays > MAX_WINDOW_DAYS) {
      return NextResponse.json(
        { status: 'invalid_input', message: `window_days must be 1..${MAX_WINDOW_DAYS}`, hint: 'Default 7.' },
        { status: 400 },
      );
    }
    const startMs = Date.parse(endDate) - (windowDays - 1) * 86_400_000;
    startDate = new Date(startMs).toISOString().slice(0, 10);
  }

  const result = await computeCardioWeek(startDate, endDate);
  return NextResponse.json(result);
}
