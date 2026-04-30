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

// ===== URL-driven activeTab initialization =====
// Mirrors the derivation logic inside MeasurementsInner:
//   const initialTab = (searchParams?.get('tab') as TabKey | null) ?? 'measurements';
// We test the derivation directly rather than rendering the component (which
// would require a full next/navigation mock harness).

type TabKey = 'measurements' | 'photos' | 'inbody';

function deriveInitialTab(searchParamsGet: (k: string) => string | null): TabKey {
  return (searchParamsGet('tab') as TabKey | null) ?? 'measurements';
}

describe('measurements activeTab initialization', () => {
  it('defaults to "measurements" when no tab param is in the URL', () => {
    const get = (_k: string) => null;
    expect(deriveInitialTab(get)).toBe('measurements');
  });

  it('initializes to "inbody" when ?tab=inbody is in the URL', () => {
    const get = (k: string) => k === 'tab' ? 'inbody' : null;
    expect(deriveInitialTab(get)).toBe('inbody');
  });

  it('initializes to "photos" when ?tab=photos is in the URL', () => {
    const get = (k: string) => k === 'tab' ? 'photos' : null;
    expect(deriveInitialTab(get)).toBe('photos');
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

// ===== site alias resolution =====
// Mirrors SITE_ALIASES + siteGroup() in measurements/page.tsx. Three writers
// populate measurement_logs.site with different conventions: UI input form
// (waist/hips/upper_arm/thigh), InBody auto-insert (left_bicep/right_bicep/
// left_thigh/right_thigh), and MCP update_body_comp (left_arm/right_arm/
// left_thigh/right_thigh). The chart and snapshot must surface all of them
// under the matching UI tab.

describe('site alias resolution', () => {
  const SITE_ALIASES: Record<SiteKey, readonly string[]> = {
    waist:     ['waist'],
    hips:      ['hips', 'hip'],
    upper_arm: ['upper_arm', 'left_arm', 'right_arm', 'left_bicep', 'right_bicep'],
    thigh:     ['thigh', 'left_thigh', 'right_thigh'],
  };

  function siteGroup(rawSite: string): SiteKey | null {
    for (const s of SITES) {
      if (SITE_ALIASES[s.key].includes(rawSite)) return s.key;
    }
    return null;
  }

  it('maps InBody-sourced bicep keys to the upper_arm tab', () => {
    expect(siteGroup('left_bicep')).toBe('upper_arm');
    expect(siteGroup('right_bicep')).toBe('upper_arm');
  });

  it('maps MCP-sourced arm keys to the upper_arm tab', () => {
    expect(siteGroup('left_arm')).toBe('upper_arm');
    expect(siteGroup('right_arm')).toBe('upper_arm');
  });

  it('maps InBody-sourced thigh keys to the thigh tab', () => {
    expect(siteGroup('left_thigh')).toBe('thigh');
    expect(siteGroup('right_thigh')).toBe('thigh');
  });

  it('keeps direct UI keys mapped to themselves', () => {
    expect(siteGroup('waist')).toBe('waist');
    expect(siteGroup('hips')).toBe('hips');
    expect(siteGroup('upper_arm')).toBe('upper_arm');
    expect(siteGroup('thigh')).toBe('thigh');
  });

  it('returns null for sites the UI does not surface (chest, neck, calf, etc.)', () => {
    expect(siteGroup('chest')).toBeNull();
    expect(siteGroup('neck')).toBeNull();
    expect(siteGroup('left_calf')).toBeNull();
    expect(siteGroup('shoulders')).toBeNull();
  });

  it('chart filter for upper_arm finds left_bicep rows (regression: previously filtered to zero)', () => {
    const inbodyLogs = [
      { uuid: 'i1', site: 'left_bicep',  value_cm: 30.8, measured_at: '2026-04-15T00:00:00.000Z' },
      { uuid: 'i2', site: 'right_bicep', value_cm: 30.5, measured_at: '2026-04-15T00:00:00.000Z' },
      { uuid: 'i3', site: 'left_bicep',  value_cm: 30.2, measured_at: '2026-03-01T00:00:00.000Z' },
    ];
    const chartSite: SiteKey = 'upper_arm';
    const matching = inbodyLogs.filter(l => SITE_ALIASES[chartSite].includes(l.site));
    expect(matching.length).toBe(3);
  });

  // Mirrors the latestBySite computation in measurements/page.tsx — for each
  // UI site, pick the most-recent calendar day and average aliased rows on
  // that day.
  function latestBySite(logs: { site: string; value_cm: number; measured_at: string }[]) {
    // logs assumed sorted desc by measured_at (matches useMeasurements)
    const out: Partial<Record<SiteKey, { value_cm: number; measured_at: string }>> = {};
    for (const site of SITES) {
      const matched = logs.filter(l => SITE_ALIASES[site.key].includes(l.site));
      if (matched.length === 0) continue;
      const latestDay = matched[0].measured_at.slice(0, 10);
      const sameDay = matched.filter(l => l.measured_at.slice(0, 10) === latestDay);
      const avg = sameDay.reduce((acc, l) => acc + l.value_cm, 0) / sameDay.length;
      out[site.key] = {
        value_cm: Math.round(avg * 10) / 10,
        measured_at: matched[0].measured_at,
      };
    }
    return out;
  }

  it('latestBySite resolves upper_arm/thigh from a single InBody-sourced row', () => {
    const logs = [
      { uuid: 'i1', site: 'left_bicep', value_cm: 30.8, measured_at: '2026-04-15T00:00:00.000Z' },
      { uuid: 'i2', site: 'left_thigh', value_cm: 51.0, measured_at: '2026-04-15T00:00:00.000Z' },
    ];
    const out = latestBySite(logs);
    expect(out.upper_arm?.value_cm).toBe(30.8);
    expect(out.thigh?.value_cm).toBe(51.0);
  });

  it('latestBySite averages left + right when both are logged on the same day', () => {
    const logs = [
      { uuid: 'i1', site: 'left_bicep',  value_cm: 30.8, measured_at: '2026-04-15T00:00:00.000Z' },
      { uuid: 'i2', site: 'right_bicep', value_cm: 30.4, measured_at: '2026-04-15T00:00:00.000Z' },
      { uuid: 'i3', site: 'left_thigh',  value_cm: 51.0, measured_at: '2026-04-15T00:00:00.000Z' },
      { uuid: 'i4', site: 'right_thigh', value_cm: 50.6, measured_at: '2026-04-15T00:00:00.000Z' },
    ];
    const out = latestBySite(logs);
    expect(out.upper_arm?.value_cm).toBe(30.6);
    expect(out.thigh?.value_cm).toBe(50.8);
  });

  it('latestBySite uses only the most-recent day when older logs exist', () => {
    const logs = [
      { uuid: 'a', site: 'left_bicep',  value_cm: 30.8, measured_at: '2026-04-15T00:00:00.000Z' },
      { uuid: 'b', site: 'right_bicep', value_cm: 30.4, measured_at: '2026-04-15T00:00:00.000Z' },
      { uuid: 'c', site: 'left_bicep',  value_cm: 28.0, measured_at: '2026-01-15T00:00:00.000Z' },
    ];
    const out = latestBySite(logs);
    // Should average only April 15 entries (30.8 + 30.4) / 2 = 30.6
    expect(out.upper_arm?.value_cm).toBe(30.6);
  });

  it('chart data averages left + right per day', () => {
    const logs = [
      { uuid: 'i1', site: 'left_bicep',  value_cm: 30.8, measured_at: '2026-04-15T00:00:00.000Z' },
      { uuid: 'i2', site: 'right_bicep', value_cm: 30.4, measured_at: '2026-04-15T00:00:00.000Z' },
      { uuid: 'i3', site: 'left_bicep',  value_cm: 28.0, measured_at: '2026-01-15T00:00:00.000Z' },
    ];
    const chartSite: SiteKey = 'upper_arm';
    const byDay = new Map<string, { measured_at: string; sum: number; count: number }>();
    for (const l of logs) {
      if (!SITE_ALIASES[chartSite].includes(l.site)) continue;
      const day = l.measured_at.slice(0, 10);
      const existing = byDay.get(day) ?? { measured_at: l.measured_at, sum: 0, count: 0 };
      existing.sum += l.value_cm;
      existing.count += 1;
      if (l.measured_at > existing.measured_at) existing.measured_at = l.measured_at;
      byDay.set(day, existing);
    }
    const points = Array.from(byDay.values())
      .sort((a, b) => a.measured_at.localeCompare(b.measured_at))
      .map(({ sum, count }) => Math.round((sum / count) * 10) / 10);
    expect(points).toEqual([28.0, 30.6]);
  });
});
