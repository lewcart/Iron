/**
 * Tests for exercise progress data logic.
 *
 * Because vitest is configured with environment: 'node' (no jsdom),
 * these tests focus on the data transformation and helper logic used
 * by the ExerciseDetail progress section rather than DOM rendering.
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
    heaviestWeight: PRRecord | null;
    mostReps: PRRecord | null;
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

function formatPRValue(pr: PRRecord | null, type: 'estimated1RM' | 'heaviestWeight' | 'mostReps'): string {
  if (!pr) return '—';
  switch (type) {
    case 'estimated1RM':
      return `${Math.round(pr.estimated1RM)} kg`;
    case 'heaviestWeight':
      return `${pr.weight} kg`;
    case 'mostReps':
      return `${pr.repetitions}`;
  }
}

function formatPRSub(pr: PRRecord | null, type: 'estimated1RM' | 'heaviestWeight' | 'mostReps'): string {
  if (!pr) return 'No data';
  switch (type) {
    case 'estimated1RM':
    case 'heaviestWeight':
      return formatDate(pr.date);
    case 'mostReps':
      return `@ ${pr.weight} kg`;
  }
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
  prs: {
    estimated1RM: samplePR,
    heaviestWeight: { ...samplePR, weight: 120, repetitions: 1 },
    mostReps: { ...samplePR, weight: 60, repetitions: 20 },
  },
  volumeTrend: [sampleVolumePoint],
  recentSets: [sampleRecentSet],
};

const emptyProgressData: ProgressData = {
  progress: [],
  prs: { estimated1RM: null, heaviestWeight: null, mostReps: null },
  volumeTrend: [],
  recentSets: [],
};

// ── Tests: hasProgressData ─────────────────────────────────────────────────

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

// ── Tests: PR badge value formatting ──────────────────────────────────────

describe('formatPRValue - estimated1RM', () => {
  it('returns em-dash when PR is null', () => {
    expect(formatPRValue(null, 'estimated1RM')).toBe('—');
  });

  it('returns rounded kg value when PR exists', () => {
    expect(formatPRValue(samplePR, 'estimated1RM')).toBe('127 kg');
  });

  it('rounds correctly for decimal estimated 1RM', () => {
    const pr: PRRecord = { ...samplePR, estimated1RM: 126.4 };
    expect(formatPRValue(pr, 'estimated1RM')).toBe('126 kg');
  });
});

describe('formatPRValue - heaviestWeight', () => {
  it('returns em-dash when PR is null', () => {
    expect(formatPRValue(null, 'heaviestWeight')).toBe('—');
  });

  it('returns exact weight in kg when PR exists', () => {
    const pr: PRRecord = { ...samplePR, weight: 120 };
    expect(formatPRValue(pr, 'heaviestWeight')).toBe('120 kg');
  });
});

describe('formatPRValue - mostReps', () => {
  it('returns em-dash when PR is null', () => {
    expect(formatPRValue(null, 'mostReps')).toBe('—');
  });

  it('returns repetitions count as string when PR exists', () => {
    const pr: PRRecord = { ...samplePR, repetitions: 20 };
    expect(formatPRValue(pr, 'mostReps')).toBe('20');
  });
});

// ── Tests: PR badge sub-text ──────────────────────────────────────────────

describe('formatPRSub', () => {
  it('returns "No data" when PR is null for any type', () => {
    expect(formatPRSub(null, 'estimated1RM')).toBe('No data');
    expect(formatPRSub(null, 'heaviestWeight')).toBe('No data');
    expect(formatPRSub(null, 'mostReps')).toBe('No data');
  });

  it('returns formatted date for estimated1RM', () => {
    const sub = formatPRSub(samplePR, 'estimated1RM');
    expect(sub).toMatch(/Jan/);
    expect(sub).toMatch(/15/);
  });

  it('returns formatted date for heaviestWeight', () => {
    const sub = formatPRSub(samplePR, 'heaviestWeight');
    expect(sub).toMatch(/Jan/);
  });

  it('returns weight context for mostReps', () => {
    const pr: PRRecord = { ...samplePR, weight: 60, repetitions: 20 };
    expect(formatPRSub(pr, 'mostReps')).toBe('@ 60 kg');
  });
});

// ── Tests: chart data transformation ──────────────────────────────────────

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

// ── Tests: volume trend transformation ────────────────────────────────────

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

// ── Tests: formatDate helper ──────────────────────────────────────────────

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

// ── Tests: full progress data with all PRs ─────────────────────────────────

describe('PR badge rendering logic with full data', () => {
  it('estimated1RM badge shows correct value and date', () => {
    const { estimated1RM } = fullProgressData.prs;
    expect(formatPRValue(estimated1RM, 'estimated1RM')).toBe('127 kg');
    expect(formatPRSub(estimated1RM, 'estimated1RM')).toMatch(/Jan/);
  });

  it('heaviestWeight badge shows correct value', () => {
    const { heaviestWeight } = fullProgressData.prs;
    expect(formatPRValue(heaviestWeight, 'heaviestWeight')).toBe('120 kg');
  });

  it('mostReps badge shows correct reps and weight context', () => {
    const { mostReps } = fullProgressData.prs;
    expect(formatPRValue(mostReps, 'mostReps')).toBe('20');
    expect(formatPRSub(mostReps, 'mostReps')).toBe('@ 60 kg');
  });
});

// ── Tests: null PR scenarios (no workout history) ─────────────────────────

describe('PR badge rendering logic with no data', () => {
  it('all PR badges show em-dash when PRs are null', () => {
    const { prs } = emptyProgressData;
    expect(formatPRValue(prs.estimated1RM, 'estimated1RM')).toBe('—');
    expect(formatPRValue(prs.heaviestWeight, 'heaviestWeight')).toBe('—');
    expect(formatPRValue(prs.mostReps, 'mostReps')).toBe('—');
  });

  it('all PR badges show "No data" sub-text when PRs are null', () => {
    const { prs } = emptyProgressData;
    expect(formatPRSub(prs.estimated1RM, 'estimated1RM')).toBe('No data');
    expect(formatPRSub(prs.heaviestWeight, 'heaviestWeight')).toBe('No data');
    expect(formatPRSub(prs.mostReps, 'mostReps')).toBe('No data');
  });
});
