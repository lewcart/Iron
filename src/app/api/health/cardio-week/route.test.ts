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
      totals: { zone2: 140, intervals: 40, total: 180 },
      daily: [
        { date: start_date, zone2_minutes: 30, intervals_minutes: 0 },
      ],
      targets: { total: 240, zone2: 180, intervals: 60, any_set: true, split: true },
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
});

function reqOf(qs: string): NextRequest {
  return new NextRequest(new URL(`http://x/api/health/cardio-week?${qs}`));
}

describe('GET /api/health/cardio-week', () => {
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

  it('returns 503 with reason=revoked when permissions revoked', async () => {
    mockedConn.mockResolvedValueOnce('revoked');
    const res = await GET(reqOf(''));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.reason).toBe('revoked');
  });

  it('returns 400 for end_date in the future', async () => {
    const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const res = await GET(reqOf(`end_date=${future}`));
    expect(res.status).toBe(400);
  });

  it('returns 400 for start_date after end_date', async () => {
    const res = await GET(reqOf('start_date=2026-05-10&end_date=2026-05-01'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for window_days < 1', async () => {
    const res = await GET(reqOf('window_days=0'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for window_days > MAX_WINDOW_DAYS', async () => {
    const res = await GET(reqOf('window_days=120'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for explicit window > MAX_WINDOW_DAYS', async () => {
    const res = await GET(reqOf('start_date=2025-01-01&end_date=2026-04-01'));
    expect(res.status).toBe(400);
  });

  it('returns 200 with success body for window_days=7 (default)', async () => {
    const res = await GET(reqOf(''));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.totals).toEqual({ zone2: 140, intervals: 40, total: 180 });
    expect(Array.isArray(body.daily)).toBe(true);
    expect(body.targets.split).toBe(true);
  });

  it('default window = 7 days when window_days omitted', async () => {
    await GET(reqOf(''));
    expect(mockedCompute).toHaveBeenCalled();
    const [start, end] = mockedCompute.mock.calls[0]!;
    const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
    expect(days).toBe(7);
  });

  it('explicit start_date wins over window_days', async () => {
    await GET(reqOf('start_date=2026-04-01&end_date=2026-04-07&window_days=30'));
    const [start, end] = mockedCompute.mock.calls[0]!;
    expect(start).toBe('2026-04-01');
    expect(end).toBe('2026-04-07');
  });

  it('returns 200 with no_targets envelope when active plan has no cardio targets', async () => {
    mockedCompute.mockResolvedValueOnce({
      status: 'no_targets',
      range: { start_date: '2026-04-26', end_date: '2026-05-02' },
      totals: { zone2: 0, intervals: 0, total: 0 },
      daily: [],
      targets: { total: null, zone2: null, intervals: null, any_set: false, split: false },
      message: 'no targets',
    });
    const res = await GET(reqOf(''));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('no_targets');
    expect(body.targets.any_set).toBe(false);
  });
});
