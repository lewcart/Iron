import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireApiKey: vi.fn(() => null),
}));

vi.mock('@/lib/server/health-data', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/health-data')>(
    '@/lib/server/health-data',
  );
  return {
    ...actual,
    getHealthKitConnectionStatus: vi.fn(async () => 'connected' as const),
    getHrvDailySeries: vi.fn(async () => [
      { date: '2026-04-01', value_avg: 50 },
      { date: '2026-04-02', value_avg: 52 },
    ]),
    getLastNightSleep: vi.fn(async () => ({
      date: '2026-04-29',
      asleep_min: 420,
      in_bed_min: 480,
      rem_min: 80,
      deep_min: 60,
      core_min: 280,
      awake_min: 60,
    })),
  };
});

import { GET } from './route';
import { requireApiKey } from '@/lib/api-auth';
import {
  getHealthKitConnectionStatus,
  getHrvDailySeries,
} from '@/lib/server/health-data';

const mockedAuth = vi.mocked(requireApiKey);
const mockedConn = vi.mocked(getHealthKitConnectionStatus);
const mockedHrv = vi.mocked(getHrvDailySeries);

beforeEach(() => {
  mockedAuth.mockReset();
  mockedAuth.mockReturnValue(null);
  mockedConn.mockReset();
  mockedConn.mockResolvedValue('connected');
  mockedHrv.mockClear();
});

function reqOf(qs: string): NextRequest {
  return new NextRequest(new URL(`http://x/api/health/snapshot?${qs}`));
}

describe('GET /api/health/snapshot', () => {
  it('returns 401 when requireApiKey rejects', async () => {
    const denied = new Response('unauthorized', { status: 401 });
    mockedAuth.mockReturnValueOnce(denied as unknown as ReturnType<typeof requireApiKey>);
    const res = await GET(reqOf(''));
    expect(res.status).toBe(401);
  });

  it('returns 503 when HealthKit not connected', async () => {
    mockedConn.mockResolvedValueOnce('not_requested');
    const res = await GET(reqOf(''));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('not_connected');
  });

  it('returns 400 for as_of in the future', async () => {
    const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const res = await GET(reqOf(`as_of=${future}`));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid days', async () => {
    const res = await GET(reqOf('days=0'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for days > MAX_WINDOW_DAYS', async () => {
    const res = await GET(reqOf('days=120'));
    expect(res.status).toBe(400);
  });

  it('returns 200 with the success body', async () => {
    const res = await GET(reqOf('days=28'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.hrv_daily)).toBe(true);
    expect(body.hrv_daily).toHaveLength(2);
    expect(body.last_night_sleep).not.toBeNull();
    expect(body.range.start_date).toBeDefined();
    expect(body.range.end_date).toBeDefined();
  });

  it('default days = 28 when omitted', async () => {
    await GET(reqOf(''));
    expect(mockedHrv).toHaveBeenCalled();
    const callArgs = mockedHrv.mock.calls[0];
    const start = callArgs[0];
    const end = callArgs[1];
    const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
    expect(days).toBe(28);
  });
});
