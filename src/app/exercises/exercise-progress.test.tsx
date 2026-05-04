/**
 * Tests for exercise progress data logic.
 *
 * Because vitest is configured with environment: 'node' (no jsdom),
 * these tests focus on the data transformation and helper logic used
 * by the ExerciseDetail progress section rather than DOM rendering.
 *
 * Heaviest-weight and most-reps PB badges were removed; only the e1RM
 * hero remains. The fixtures + assertions below reflect that.
 */

import { describe, it, expect } from 'vitest';

// ── Helper functions mirrored from ExerciseDetail ──────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

interface PRRecord {
  exerciseUuid: string;
  weight: number;
  repetitions: number;
  estimated1RM: number;
  date: string;
}

interface ProgressPoint {
  date: string;
  maxWeight: number;
  totalVolume: number;
  estimated1RM: number;
}

interface VolumeTrendPoint {
  date: string;
  totalVolume: number;
}

interface RecentSet {
  date: string;
  weight: number;
  repetitions: number;
  rpe: number | null;
  workoutUuid: string;
}

interface ProgressData {
  progress: ProgressPoint[];
  prs: {
    estimated1RM: PRRecord | null;
  };
  volumeTrend: VolumeTrendPoint[];
  recentSets: RecentSet[];
}

function buildChartData(progress: ProgressPoint[]) {
  return progress.map(p => ({
    date: formatDate(p.date),
    estimated1RM: Math.round(p.estimated1RM * 10) / 10,
    maxWeight: Math.round(p.maxWeight * 10) / 10,
  }));
}

function buildVolumeData(volumeTrend: VolumeTrendPoint[]) {
  return volumeTrend.map(v => ({
    date: formatDate(v.date),
    totalVolume: Math.round(v.totalVolume),
  }));
}

function formatHeroValue(pr: PRRecord | null): string {
  if (!pr) return '—';
  return `${Math.round(pr.estimated1RM)} kg`;
}

function formatHeroSub(pr: PRRecord | null): string {
  if (!pr) return 'No data';
  return formatDate(pr.date);
}

function hasProgressData(data: ProgressData | null): boolean {
  return data !== null && data.recentSets.length > 0;
}

// ── Sample fixtures ────────────────────────────────────────────────────────

const samplePR: PRRecord = {
  exerciseUuid: 'ex-uuid-1',
  weight: 100,
  repetitions: 8,
  estimated1RM: 126.67,
  date: '2026-01-15T10:00:00.000Z',
};

const sampleProgressPoint: ProgressPoint = {
  date: '2026-01-15T10:00:00.000Z',
  maxWeight: 100,
  totalVolume: 5000,
  estimated1RM: 126.67,
};

const sampleVolumePoint: VolumeTrendPoint = {
  date: '2026-01-15T10:00:00.000Z',
  totalVolume: 5000,
};

const sampleRecentSet: RecentSet = {
  date: '2026-01-15T10:00:00.000Z',
  weight: 100,
  repetitions: 8,
  rpe: 8.5,
  workoutUuid: 'wo-uuid-1',
};

const fullProgressData: ProgressData = {
  progress: [sampleProgressPoint],
  prs: { estimated1RM: samplePR },
  volumeTrend: [sampleVolumePoint],
  recentSets: [sampleRecentSet],
};

const emptyProgressData: ProgressData = {
  progress: [],
  prs: { estimated1RM: null },
  volumeTrend: [],
  recentSets: [],
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('hasProgressData', () => {
  it('returns false when data is null (loading state)', () => {
    expect(hasProgressData(null)).toBe(false);
  });

  it('returns false when recentSets is empty (no workout history)', () => {
    expect(hasProgressData(emptyProgressData)).toBe(false);
  });

  it('returns true when there are recent sets', () => {
    expect(hasProgressData(fullProgressData)).toBe(true);
  });
});

describe('formatHeroValue (e1RM hero)', () => {
  it('returns em-dash when PR is null', () => {
    expect(formatHeroValue(null)).toBe('—');
  });

  it('returns rounded kg value when PR exists', () => {
    expect(formatHeroValue(samplePR)).toBe('127 kg');
  });

  it('rounds correctly for decimal estimated 1RM', () => {
    const pr: PRRecord = { ...samplePR, estimated1RM: 126.4 };
    expect(formatHeroValue(pr)).toBe('126 kg');
  });
});

describe('formatHeroSub (e1RM hero)', () => {
  it('returns "No data" when PR is null', () => {
    expect(formatHeroSub(null)).toBe('No data');
  });

  it('returns formatted date when PR exists', () => {
    const sub = formatHeroSub(samplePR);
    expect(sub).toMatch(/Jan/);
    expect(sub).toMatch(/15/);
  });
});

describe('buildChartData', () => {
  it('returns empty array for empty progress', () => {
    expect(buildChartData([])).toEqual([]);
  });

  it('maps progress points to chart-compatible objects', () => {
    const result = buildChartData([sampleProgressPoint]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('date');
    expect(result[0]).toHaveProperty('estimated1RM');
    expect(result[0]).toHaveProperty('maxWeight');
  });

  it('rounds estimated1RM to 1 decimal place', () => {
    const result = buildChartData([{ ...sampleProgressPoint, estimated1RM: 126.666 }]);
    expect(result[0].estimated1RM).toBe(126.7);
  });

  it('rounds maxWeight to 1 decimal place', () => {
    const result = buildChartData([{ ...sampleProgressPoint, maxWeight: 99.999 }]);
    expect(result[0].maxWeight).toBe(100);
  });

  it('formats date using formatDate helper', () => {
    const result = buildChartData([sampleProgressPoint]);
    expect(result[0].date).toMatch(/Jan/);
    expect(result[0].date).toMatch(/15/);
  });

  it('maps multiple progress points in order', () => {
    const points: ProgressPoint[] = [
      { date: '2026-01-10T10:00:00.000Z', maxWeight: 80, totalVolume: 3200, estimated1RM: 100 },
      { date: '2026-01-15T10:00:00.000Z', maxWeight: 100, totalVolume: 5000, estimated1RM: 126.67 },
    ];
    const result = buildChartData(points);
    expect(result).toHaveLength(2);
    expect(result[0].estimated1RM).toBe(100);
    expect(result[1].estimated1RM).toBe(126.7);
  });
});

describe('buildVolumeData', () => {
  it('returns empty array for empty volume trend', () => {
    expect(buildVolumeData([])).toEqual([]);
  });

  it('maps volume trend points correctly', () => {
    const result = buildVolumeData([sampleVolumePoint]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('date');
    expect(result[0]).toHaveProperty('totalVolume');
  });

  it('rounds totalVolume to integer', () => {
    const result = buildVolumeData([{ date: '2026-01-15T10:00:00.000Z', totalVolume: 4999.7 }]);
    expect(result[0].totalVolume).toBe(5000);
  });

  it('formats date for display', () => {
    const result = buildVolumeData([sampleVolumePoint]);
    expect(typeof result[0].date).toBe('string');
    expect(result[0].date.length).toBeGreaterThan(0);
  });
});

describe('formatDate', () => {
  it('formats an ISO date string to DD Mon format', () => {
    const result = formatDate('2026-01-15T10:00:00.000Z');
    expect(result).toMatch(/15/);
    expect(result).toMatch(/Jan/);
  });

  it('formats different months correctly', () => {
    const march = formatDate('2026-03-01T00:00:00.000Z');
    expect(march).toMatch(/Mar/);
  });

  it('pads single-digit days with zero', () => {
    const result = formatDate('2026-01-05T10:00:00.000Z');
    expect(result).toMatch(/05/);
  });
});
