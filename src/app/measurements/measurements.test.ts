import { describe, it, expect } from 'vitest';

// ── Helper functions mirrored from measurements/page.tsx ──────────────────────

const SITES = [
  { key: 'waist',     label: 'Waist' },
  { key: 'hips',      label: 'Hips' },
  { key: 'upper_arm', label: 'Upper Arm' },
  { key: 'thigh',     label: 'Thigh' },
] as const;

type SiteKey = typeof SITES[number]['key'];

const POSE_GUIDANCE: Record<string, string> = {
  front: 'Face the camera, arms slightly away from your body, feet hip-width apart.',
  side:  'Stand sideways, arms relaxed, feet together, looking straight ahead.',
  back:  'Back to the camera, arms slightly away from your body, feet hip-width apart.',
};

function formatDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatChartDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short',
  });
}

function toDateInputValue(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// ===== SITES =====

describe('SITES', () => {
  it('contains 4 measurement sites', () => {
    expect(SITES).toHaveLength(4);
  });

  it('includes waist, hips, upper_arm, and thigh', () => {
    const keys = SITES.map(s => s.key);
    expect(keys).toContain('waist');
    expect(keys).toContain('hips');
    expect(keys).toContain('upper_arm');
    expect(keys).toContain('thigh');
  });

  it('each site has a key and label', () => {
    for (const site of SITES) {
      expect(site.key).toBeTruthy();
      expect(site.label).toBeTruthy();
    }
  });
});

// ===== POSE_GUIDANCE =====

describe('POSE_GUIDANCE', () => {
  it('has guidance for front, side, and back poses', () => {
    expect(POSE_GUIDANCE.front).toBeTruthy();
    expect(POSE_GUIDANCE.side).toBeTruthy();
    expect(POSE_GUIDANCE.back).toBeTruthy();
  });

  it('front guidance mentions facing the camera', () => {
    expect(POSE_GUIDANCE.front).toMatch(/face the camera/i);
  });

  it('side guidance mentions standing sideways', () => {
    expect(POSE_GUIDANCE.side).toMatch(/sideways/i);
  });

  it('back guidance mentions back to the camera', () => {
    expect(POSE_GUIDANCE.back).toMatch(/back to the camera/i);
  });
});

// ===== formatDate =====

describe('formatDate', () => {
  it('formats an ISO date string to en-GB locale with day, month, year', () => {
    expect(formatDate('2026-03-20T09:00:00.000Z')).toBe('20 Mar 2026');
  });

  it('handles beginning of year', () => {
    expect(formatDate('2026-01-01T12:00:00.000Z')).toBe('01 Jan 2026');
  });

  it('handles different months', () => {
    expect(formatDate('2026-06-15T00:00:00.000Z')).toMatch(/Jun 2026/);
    expect(formatDate('2026-11-05T00:00:00.000Z')).toMatch(/Nov 2026/);
  });
});

// ===== formatChartDate =====

describe('formatChartDate', () => {
  it('formats date without year', () => {
    const result = formatChartDate('2026-03-20T09:00:00.000Z');
    expect(result).toBe('20 Mar');
  });

  it('does not include the year', () => {
    const result = formatChartDate('2026-06-15T00:00:00.000Z');
    expect(result).not.toMatch(/2026/);
  });

  it('handles different months', () => {
    expect(formatChartDate('2026-01-01T00:00:00.000Z')).toMatch(/Jan/);
    expect(formatChartDate('2026-12-31T00:00:00.000Z')).toMatch(/Dec/);
  });
});

// ===== toDateInputValue =====

describe('toDateInputValue', () => {
  it('returns a YYYY-MM-DD formatted string', () => {
    const result = toDateInputValue(new Date('2026-03-20T09:00:00.000Z'));
    expect(result).toBe('2026-03-20');
  });

  it('returns today when no date is provided', () => {
    const result = toDateInputValue();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('handles month and day padding', () => {
    const result = toDateInputValue(new Date('2026-01-05T00:00:00.000Z'));
    expect(result).toBe('2026-01-05');
  });
});

// ===== chart data derivation logic =====

describe('chart data derivation', () => {
  type MeasurementLog = {
    uuid: string;
    site: string;
    value_cm: number;
    measured_at: string;
  };

  const logs: MeasurementLog[] = [
    { uuid: 'a', site: 'waist', value_cm: 82, measured_at: '2026-03-20T09:00:00.000Z' },
    { uuid: 'b', site: 'waist', value_cm: 83, measured_at: '2026-03-15T09:00:00.000Z' },
    { uuid: 'c', site: 'hips',  value_cm: 95, measured_at: '2026-03-20T09:00:00.000Z' },
    { uuid: 'd', site: 'waist', value_cm: 84, measured_at: '2026-03-10T09:00:00.000Z' },
  ];

  it('filters logs by selected site', () => {
    const waistLogs = logs.filter(l => l.site === 'waist');
    expect(waistLogs).toHaveLength(3);
  });

  it('limits chart data to 30 entries', () => {
    const chartSite: SiteKey = 'waist';
    const chartData = logs.filter(l => l.site === chartSite).slice(0, 30);
    expect(chartData.length).toBeLessThanOrEqual(30);
  });

  it('computes latest value per site from ordered logs', () => {
    const latestBySite: Partial<Record<SiteKey, MeasurementLog>> = {};
    for (const log of logs) {
      const s = log.site as SiteKey;
      if (SITES.find(si => si.key === s) && !latestBySite[s]) {
        latestBySite[s] = log;
      }
    }
    expect(latestBySite.waist?.uuid).toBe('a');
    expect(latestBySite.hips?.uuid).toBe('c');
    expect(latestBySite.upper_arm).toBeUndefined();
  });
});
