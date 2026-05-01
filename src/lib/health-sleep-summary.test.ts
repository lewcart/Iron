import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/db/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/db/db';
import { computeSleepSummary, MAX_WINDOW_DAYS } from './health-sleep-summary';

const mockedQuery = vi.mocked(query);
const mockedQueryOne = vi.mocked(queryOne);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-02-15T12:00:00Z'));
  mockedQuery.mockReset();
  mockedQueryOne.mockReset();
  mockedQuery.mockResolvedValue([]);
  mockedQueryOne.mockResolvedValue(null);
});

// ── Validation ──────────────────────────────────────────────────────────────

describe('computeSleepSummary — validation', () => {
  it('rejects future end_date', async () => {
    const r = await computeSleepSummary({ end_date: '2999-01-01' });
    expect(r).toMatchObject({ status: 'invalid_range' });
  });

  it('rejects start_date > end_date', async () => {
    const r = await computeSleepSummary({ start_date: '2026-02-10', end_date: '2026-02-01' });
    expect(r).toMatchObject({ status: 'invalid_range' });
  });

  it('rejects invalid date format with NaN parse', async () => {
    const r = await computeSleepSummary({ start_date: 'not-a-date', end_date: '2026-02-01' });
    expect(r).toMatchObject({ status: 'invalid_range' });
  });

  it('rejects window_days < 1', async () => {
    const r = await computeSleepSummary({ window_days: 0 });
    expect(r).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects window_days > MAX_WINDOW_DAYS', async () => {
    const r = await computeSleepSummary({ window_days: MAX_WINDOW_DAYS + 1 });
    expect(r).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects NaN window_days as if it were 7 (defense in depth)', async () => {
    // NaN passes typeof === 'number' but the Number.isFinite guard rejects it,
    // falling back to default 7 — never explodes downstream.
    const r = await computeSleepSummary({ window_days: NaN as unknown as number });
    expect('status' in (r as object) ? (r as { status: string }).status : null).not.toBe('invalid_input');
  });
});

// ── Window cap ──────────────────────────────────────────────────────────────

describe('computeSleepSummary — window cap', () => {
  it('caps span > 90 days and reports window_capped', async () => {
    const r = await computeSleepSummary({ start_date: '2024-01-01', end_date: '2026-02-01' });
    expect('data_quality' in r).toBe(true);
    expect((r as { data_quality: { window_capped: boolean } }).data_quality.window_capped).toBe(true);
  });

  it('does not cap when span === 90 days', async () => {
    // Pick a 90-day window deliberately — should NOT cap.
    const r = await computeSleepSummary({ start_date: '2025-11-15', end_date: '2026-02-13' });
    expect((r as { data_quality: { window_capped: boolean } }).data_quality.window_capped).toBe(false);
  });
});

// ── Empty + projection ─────────────────────────────────────────────────────

describe('computeSleepSummary — empty + projection', () => {
  it('returns averages: null when no nights', async () => {
    const r = await computeSleepSummary({ window_days: 7 });
    expect((r as { averages: unknown }).averages).toBeNull();
  });

  it('omits nights[] unless explicitly requested via fields', async () => {
    const r = await computeSleepSummary({ window_days: 7 });
    expect((r as { nights?: unknown }).nights).toBeUndefined();
  });

  it('opts in nights[] when requested', async () => {
    mockedQuery.mockResolvedValueOnce([
      mockNight('2026-02-14', { asleep_min: 480, in_bed_min: 510, deep_min: 90, rem_min: 100, core_min: 270, awake_min: 30 }),
    ]);
    const r = await computeSleepSummary({ window_days: 7, fields: ['range', 'nights'] });
    expect(Array.isArray((r as { nights?: unknown[] }).nights)).toBe(true);
    expect((r as { nights: unknown[] }).nights).toHaveLength(1);
  });

  it('fields filter narrows the response', async () => {
    const r = await computeSleepSummary({ window_days: 7, fields: ['consistency'] });
    expect('range' in r).toBe(false);
    expect('averages' in r).toBe(false);
    expect('consistency' in r).toBe(true);
  });
});

// ── Averages ────────────────────────────────────────────────────────────────

describe('computeSleepSummary — averages', () => {
  it('computes per-stage averages and percentages', async () => {
    mockedQuery.mockResolvedValueOnce([
      mockNight('2026-02-14', { asleep_min: 480, in_bed_min: 500, deep_min: 96, rem_min: 120, core_min: 240, awake_min: 24 }),
      mockNight('2026-02-13', { asleep_min: 480, in_bed_min: 500, deep_min: 96, rem_min: 120, core_min: 240, awake_min: 24 }),
    ]);
    const r = (await computeSleepSummary({ window_days: 2 })) as {
      averages: { asleep_min: number; deep_pct: number; sleep_efficiency_pct: number };
    };
    expect(r.averages.asleep_min).toBe(480);
    expect(r.averages.deep_pct).toBe(20);
    expect(r.averages.sleep_efficiency_pct).toBe(96);
  });

  it('returns null for percentages when asleep is 0 (no div-by-zero)', async () => {
    mockedQuery.mockResolvedValueOnce([
      mockNight('2026-02-14', { asleep_min: 0, in_bed_min: 0, deep_min: 0, rem_min: 0, core_min: 0, awake_min: 0 }),
    ]);
    const r = (await computeSleepSummary({ window_days: 1 })) as {
      averages: { deep_pct: number | null; sleep_efficiency_pct: number | null };
    };
    expect(r.averages.deep_pct).toBeNull();
    expect(r.averages.sleep_efficiency_pct).toBeNull();
  });
});

// ── HRV branch ──────────────────────────────────────────────────────────────

describe('computeSleepSummary — hrv', () => {
  it('returns hrv: null when all queries return nulls', async () => {
    // window, baseline, last all empty
    mockedQueryOne.mockResolvedValue({ avg: null, n: 0 });
    const r = (await computeSleepSummary({ window_days: 7, fields: ['hrv'] })) as { hrv: unknown };
    expect(r.hrv).toBeNull();
  });

  it('hrv.delta_pct null when baseline avg is 0 (no div-by-zero)', async () => {
    mockedQueryOne
      .mockResolvedValueOnce({ avg: 50, n: 7 })  // window
      .mockResolvedValueOnce({ avg: 0 })          // baseline
      .mockResolvedValueOnce({ value_avg: 55 }); // last
    const r = (await computeSleepSummary({ window_days: 7, fields: ['hrv'] })) as {
      hrv: { delta_pct: number | null };
    };
    expect(r.hrv.delta_pct).toBeNull();
  });

  it('computes delta_pct against baseline', async () => {
    mockedQueryOne
      .mockResolvedValueOnce({ avg: 55, n: 7 })   // window 55ms
      .mockResolvedValueOnce({ avg: 50 })          // baseline 50ms
      .mockResolvedValueOnce({ value_avg: 56 });  // last
    const r = (await computeSleepSummary({ window_days: 7, fields: ['hrv'] })) as {
      hrv: { delta_pct: number; window_avg: number; baseline_30d_avg: number };
    };
    expect(r.hrv.window_avg).toBe(55);
    expect(r.hrv.baseline_30d_avg).toBe(50);
    expect(r.hrv.delta_pct).toBe(10);
  });
});

// ── Data quality ────────────────────────────────────────────────────────────

describe('computeSleepSummary — data_quality', () => {
  it('lists missing_sleep_dates for every gap day in the window', async () => {
    mockedQuery.mockResolvedValueOnce([
      mockNight('2026-02-14', { asleep_min: 420, in_bed_min: 450, deep_min: 60, rem_min: 90, core_min: 230, awake_min: 30 }),
      mockNight('2026-02-12', { asleep_min: 420, in_bed_min: 450, deep_min: 60, rem_min: 90, core_min: 230, awake_min: 30 }),
    ]);
    const r = (await computeSleepSummary({ start_date: '2026-02-10', end_date: '2026-02-15', fields: ['data_quality'] })) as {
      data_quality: { missing_sleep_dates: string[] };
    };
    expect(r.data_quality.missing_sleep_dates).toEqual([
      '2026-02-10', '2026-02-11', '2026-02-13', '2026-02-15',
    ]);
  });

  it('distinguishes missing_envelope_dates (row exists, start_at null) from missing_sleep_dates', async () => {
    mockedQuery.mockResolvedValueOnce([
      mockNight('2026-02-14', { asleep_min: 420, in_bed_min: 450, deep_min: 60, rem_min: 90, core_min: 230, awake_min: 30, start_at: null, end_at: null }),
    ]);
    const r = (await computeSleepSummary({ start_date: '2026-02-13', end_date: '2026-02-14', fields: ['data_quality'] })) as {
      data_quality: { missing_sleep_dates: string[]; missing_envelope_dates: string[] };
    };
    expect(r.data_quality.missing_sleep_dates).toEqual(['2026-02-13']);
    expect(r.data_quality.missing_envelope_dates).toEqual(['2026-02-14']);
  });

  it('iterates every date across DST fall-back without dup or skip', async () => {
    // UK clocks-back is Oct 26 2025 02:00 BST → 01:00 GMT.
    // The 86,400,000ms stride MAY be off by an hour through that boundary; this
    // test pins a 5-day window centered on it and asserts no skips/dups.
    const r = (await computeSleepSummary({
      start_date: '2025-10-24',
      end_date: '2025-10-28',
      fields: ['data_quality'],
    })) as { data_quality: { missing_sleep_dates: string[] } };
    expect(r.data_quality.missing_sleep_dates).toEqual([
      '2025-10-24', '2025-10-25', '2025-10-26', '2025-10-27', '2025-10-28',
    ]);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockNight(
  wake_date: string,
  o: {
    asleep_min: number; in_bed_min: number;
    deep_min: number; rem_min: number; core_min: number; awake_min: number;
    start_at?: string | null; end_at?: string | null;
  },
) {
  return {
    wake_date,
    start_at: o.start_at !== undefined ? o.start_at : `${wake_date}T00:00:00Z`,
    end_at: o.end_at !== undefined ? o.end_at : `${wake_date}T07:00:00Z`,
    asleep_min: o.asleep_min,
    rem_min: o.rem_min,
    deep_min: o.deep_min,
    core_min: o.core_min,
    awake_min: o.awake_min,
    in_bed_min: o.in_bed_min,
  };
}
