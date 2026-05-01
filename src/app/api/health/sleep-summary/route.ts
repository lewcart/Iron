/**
 * GET /api/health/sleep-summary?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&fields=consistency,nights
 *
 * Or, alternatively: ?window_days=7
 *
 * Server-side wrapper around computeSleepSummary so the /sleep page can
 * fetch via a normal HTTP call. Same data shape as the get_health_sleep_summary
 * MCP tool — only diff is no toolResult wrapping. Errors come back as 200
 * with a typed `{status:'invalid_range'|'invalid_input', ...}` body so the
 * page can render a friendly inline message without try/catch on the fetch.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  computeSleepSummary,
  SLEEP_SUMMARY_FIELDS,
  type SleepSummaryField,
  type SleepSummaryArgs,
} from '@/lib/health-sleep-summary';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const startDate = url.searchParams.get('start_date') ?? undefined;
  const endDate = url.searchParams.get('end_date') ?? undefined;
  const windowDaysRaw = url.searchParams.get('window_days');
  const windowDays = windowDaysRaw ? Number(windowDaysRaw) : undefined;
  const fieldsParam = url.searchParams.get('fields');
  const fields = fieldsParam
    ? fieldsParam
        .split(',')
        .map(s => s.trim())
        .filter((f): f is SleepSummaryField =>
          SLEEP_SUMMARY_FIELDS.includes(f as SleepSummaryField),
        )
    : undefined;

  const args: SleepSummaryArgs = {
    start_date: startDate,
    end_date: endDate,
    window_days: Number.isFinite(windowDays) ? windowDays : undefined,
    fields,
  };

  const result = await computeSleepSummary(args);
  return NextResponse.json(result);
}
