/**
 * GET /api/health/sleep-summary?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&fields=consistency,nights
 *
 * Or, alternatively: ?window_days=7
 *
 * Server-side wrapper around computeSleepSummary so the /sleep page can
 * fetch via a normal HTTP call. Same data shape as the get_health_sleep_summary
 * MCP tool.
 *
 * Status codes (matches the rest of /src/app/api convention — non-2xx means
 * the body is a typed error envelope, not the success shape):
 *   200 — success, body is SleepSummaryResult
 *   400 — invalid_range / invalid_input, body is {status, message, hint}
 *   401 — REBIRTH_API_KEY missing or wrong
 *   503 — HealthKit not connected, body is {status:'not_connected', reason, message}
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { query } from '@/db/db';
import {
  computeSleepSummary,
  SLEEP_SUMMARY_FIELDS,
  type SleepSummaryField,
  type SleepSummaryArgs,
} from '@/lib/health-sleep-summary';

// Mirrors getHealthKitStatus from src/lib/mcp-tools.ts. Duplicated here so
// the route doesn't drag in the entire MCP tool surface for one query.
async function getHealthKitConnectionStatus(): Promise<'connected' | 'not_requested' | 'revoked' | 'unavailable'> {
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
  const startDate = url.searchParams.get('start_date') ?? undefined;
  const endDate = url.searchParams.get('end_date') ?? undefined;
  const windowDaysRaw = url.searchParams.get('window_days');
  const windowDays = windowDaysRaw ? Number(windowDaysRaw) : undefined;
  const fieldsParam = url.searchParams.get('fields');

  let fields: SleepSummaryField[] | undefined;
  if (fieldsParam) {
    const parts = fieldsParam.split(',').map(s => s.trim()).filter(Boolean);
    const unknown = parts.filter(p => !SLEEP_SUMMARY_FIELDS.includes(p as SleepSummaryField));
    if (unknown.length > 0) {
      return NextResponse.json(
        {
          status: 'invalid_input',
          message: `Unknown field(s): ${unknown.join(', ')}`,
          hint: `Valid: ${SLEEP_SUMMARY_FIELDS.join(',')}`,
        },
        { status: 400 },
      );
    }
    fields = parts as SleepSummaryField[];
  }

  const args: SleepSummaryArgs = {
    start_date: startDate,
    end_date: endDate,
    window_days: Number.isFinite(windowDays) ? windowDays : undefined,
    fields,
  };

  const result = await computeSleepSummary(args);
  // computeSleepSummary signals validation errors via {status:'invalid_*'} in
  // the success-branch return. Map those to 400 here so HTTP semantics match
  // the rest of the codebase.
  if (result && typeof result === 'object' && 'status' in result) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
