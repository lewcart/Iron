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
    computeCardioWeek: vi.fn(async (start_date: string, end_date: string) => ({
      status: 'ok' as const,
      range: { start_date, end_date },
      totals: { zone2: 90, intervals: 30, total: 120 },
      daily: [],
      targets: { total: 180, zone2: 120, intervals: 60, any_set: true, split: true },
    })),
  };
});

import { GET } from './route';
import { requireApiKey } from '@/lib/api-auth';
import {
  getHealthKitConnectionStatus,
  computeCardioWeek,
} from '@/lib/server/health-data';

const mockedAuth = vi.mocked(requireApiKey);
const mockedConn = vi.mocked(getHealthKitConnectionStatus);
const mockedCompute = vi.mocked(computeCardioWeek);

beforeEach(() => {
  mockedAuth.mockReset();
  mockedAuth.mockReturnValue(null);
  mockedConn.mockReset();
  mockedConn.mockResolvedValue('connected');
  mockedCompute.mockClear();
  mockedCompute.mockImplementation(async (start_date: string, end_date: string) => ({
    status: 'ok' as const,
    range: { start_date, end_date },
    totals: { zone2: 90, intervals: 30, total: 120 },
    daily: [],
    targets: { total: 180, zone2: 120, intervals: 60, any_set: true, split: true },
  }));
});

function reqOf(qs: string): NextRequest {
  return new NextRequest(new URL(`http://x/api/health/cardio-trend?${qs}`));
}

describe('GET /api/health/cardio-trend', () => {
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

  it('returns 400 for weeks=0', async () => {
    const res = await GET(reqOf('weeks=0'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.status).toBe('invalid_input');
  });

  it('returns 400 for weeks > 12', async () => {
    const res = await GET(reqOf('weeks=13'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric weeks', async () => {
    const res = await GET(reqOf('weeks=abc'));
    expect(res.status).toBe(400);
  });

  it('default weeks=12 when omitted; calls computeCardioWeek 12 times', async () => {
    const res = await GET(reqOf(''));
    expect(res.status).toBe(200);
    expect(mockedCompute).toHaveBeenCalledTimes(12);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.weekly).toHaveLength(12);
    expect(body.target_total_minutes).toBe(180);
  });

  it('respects explicit weeks param', async () => {
    const res = await GET(reqOf('weeks=4'));
    expect(res.status).toBe(200);
    expect(mockedCompute).toHaveBeenCalledTimes(4);
    const body = await res.json();
    expect(body.weekly).toHaveLength(4);
  });

  it('weekly array is oldest → newest (week windows are 7 days apart, ascending)', async () => {
    await GET(reqOf('weeks=3'));
    const calls = mockedCompute.mock.calls;
    expect(calls).toHaveLength(3);
    // Each call's start_date should be 7 days later than the previous one.
    const starts = calls.map(c => c[0]);
    const t0 = Date.parse(starts[0]);
    const t1 = Date.parse(starts[1]);
    const t2 = Date.parse(starts[2]);
    expect(Math.round((t1 - t0) / 86_400_000)).toBe(7);
    expect(Math.round((t2 - t1) / 86_400_000)).toBe(7);
  });

  it('each week window is exactly 7 days (Mon→Sun, inclusive)', async () => {
    await GET(reqOf('weeks=2'));
    const calls = mockedCompute.mock.calls;
    for (const [start, end] of calls) {
      const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
      expect(days).toBe(7);
    }
  });

  it('returns no_targets envelope when active plan has no cardio targets', async () => {
    mockedCompute.mockImplementation(async (start_date: string, end_date: string) => ({
      status: 'no_targets' as const,
      range: { start_date, end_date },
      totals: { zone2: 0, intervals: 0, total: 0 },
      daily: [],
      targets: { total: null, zone2: null, intervals: null, any_set: false, split: false },
      message: 'no targets',
    }));
    const res = await GET(reqOf('weeks=4'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('no_targets');
    expect(body.target_total_minutes).toBeNull();
    expect(body.weekly).toHaveLength(4);
  });

  it('aggregates total minutes per week from computeCardioWeek.totals.total', async () => {
    let i = 0;
    mockedCompute.mockImplementation(async (start_date: string, end_date: string) => {
      const total = (i + 1) * 30; // 30, 60, 90, 120
      i++;
      return {
        status: 'ok' as const,
        range: { start_date, end_date },
        totals: { zone2: total, intervals: 0, total },
        daily: [],
        targets: { total: 180, zone2: 120, intervals: 60, any_set: true, split: true },
      };
    });
    const res = await GET(reqOf('weeks=4'));
    const body = await res.json();
    expect(body.weekly).toEqual([30, 60, 90, 120]);
  });
});
