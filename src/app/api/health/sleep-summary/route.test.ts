import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('@/lib/health-sleep-summary', async () => {
  const actual = await vi.importActual<typeof import('@/lib/health-sleep-summary')>(
    '@/lib/health-sleep-summary',
  );
  return {
    ...actual,
    computeSleepSummary: vi.fn(async () => ({
      range: { start_date: '2026-02-08', end_date: '2026-02-15', n_nights: 0, timezone: 'Europe/London' },
      averages: null,
      consistency: null,
      hrv: null,
      data_quality: { missing_sleep_dates: [], missing_envelope_dates: [], window_capped: false },
    })),
  };
});

vi.mock('@/lib/api-auth', () => ({
  requireApiKey: vi.fn(() => null),
}));

import { GET } from './route';
import { computeSleepSummary } from '@/lib/health-sleep-summary';
import { requireApiKey } from '@/lib/api-auth';
import { query } from '@/db/db';

const mockedCompute = vi.mocked(computeSleepSummary);
const mockedAuth = vi.mocked(requireApiKey);
const mockedQuery = vi.mocked(query);

beforeEach(() => {
  mockedCompute.mockClear();
  mockedAuth.mockReset();
  mockedAuth.mockReturnValue(null);
  mockedQuery.mockReset();
  // Default: HK connected (one row with last_successful_sync_at)
  mockedQuery.mockResolvedValue([
    { last_successful_sync_at: '2026-02-15T08:00:00Z', last_error: null },
  ]);
});

function reqOf(qs: string): NextRequest {
  return new NextRequest(new URL(`http://x/api/health/sleep-summary?${qs}`));
}

describe('GET /api/health/sleep-summary — auth', () => {
  it('returns 401 when requireApiKey rejects', async () => {
    const denied = new Response('unauthorized', { status: 401 });
    mockedAuth.mockReturnValueOnce(denied as unknown as ReturnType<typeof requireApiKey>);
    const res = await GET(reqOf('window_days=7'));
    expect(res.status).toBe(401);
    expect(mockedCompute).not.toHaveBeenCalled();
  });
});

describe('GET /api/health/sleep-summary — HealthKit connection', () => {
  it('returns 503 not_connected when sync_state is empty', async () => {
    mockedQuery.mockResolvedValueOnce([]);
    const res = await GET(reqOf('window_days=7'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'not_connected', reason: 'not_requested' });
    expect(mockedCompute).not.toHaveBeenCalled();
  });

  it('returns 503 not_connected when all rows have permission_revoked', async () => {
    mockedQuery.mockResolvedValueOnce([
      { last_successful_sync_at: null, last_error: 'permission_revoked' },
    ]);
    const res = await GET(reqOf('window_days=7'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.reason).toBe('revoked');
  });
});

describe('GET /api/health/sleep-summary — query parsing', () => {
  it('passes start/end/fields through to computeSleepSummary', async () => {
    await GET(reqOf('start_date=2026-02-01&end_date=2026-02-08&fields=consistency,nights'));
    expect(mockedCompute).toHaveBeenCalledWith({
      start_date: '2026-02-01',
      end_date: '2026-02-08',
      window_days: undefined,
      fields: ['consistency', 'nights'],
    });
  });

  it('rejects unknown field values with 400', async () => {
    const res = await GET(reqOf('fields=consistency,bogus'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'invalid_input' });
    expect(body.message).toContain('bogus');
    expect(mockedCompute).not.toHaveBeenCalled();
  });

  it('coerces non-numeric window_days to undefined (defaults handled downstream)', async () => {
    await GET(reqOf('window_days=abc'));
    const args = mockedCompute.mock.calls.at(-1)![0];
    expect(args.window_days).toBeUndefined();
  });
});

describe('GET /api/health/sleep-summary — error status mapping', () => {
  it('returns 400 for invalid_range from computeSleepSummary', async () => {
    mockedCompute.mockResolvedValueOnce({
      status: 'invalid_range',
      message: 'start > end',
      hint: 'flip them',
    });
    const res = await GET(reqOf('start_date=2026-03-01&end_date=2026-02-01'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'invalid_range' });
  });

  it('returns 400 for invalid_input from computeSleepSummary', async () => {
    mockedCompute.mockResolvedValueOnce({
      status: 'invalid_input',
      message: 'window_days must be 1..90',
      hint: 'Default 7.',
    });
    const res = await GET(reqOf('window_days=999'));
    expect(res.status).toBe(400);
  });

  it('returns 200 with the SleepSummaryResult for the success case', async () => {
    const res = await GET(reqOf('window_days=7'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('range');
    expect(body.range.timezone).toBe('Europe/London');
  });
});
