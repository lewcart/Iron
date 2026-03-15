import { describe, it, expect } from 'vitest';

// ===== Streak calculation =====

/**
 * Mirrors the computeStreak logic from the summary API route.
 * Accepts an array of week_start strings (ISO dates, Monday) sorted DESC,
 * and a reference "current week Monday" date for deterministic testing.
 */
function computeStreak(weekRows: { week_start: string }[], currentWeekMonday: Date): number {
  if (weekRows.length === 0) return 0;

  const weekSet = new Set(weekRows.map(r => String(r.week_start).slice(0, 10)));

  let streak = 0;
  const checkDate = new Date(currentWeekMonday);

  while (true) {
    const iso = checkDate.toISOString().slice(0, 10);
    if (weekSet.has(iso)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 7);
    } else {
      break;
    }
  }

  return streak;
}

describe('computeStreak', () => {
  // Current week Monday = 2026-03-16
  const currentMonday = new Date('2026-03-16T00:00:00.000Z');

  it('returns 0 when no workout weeks', () => {
    expect(computeStreak([], currentMonday)).toBe(0);
  });

  it('returns 1 when only the current week has a workout', () => {
    const rows = [{ week_start: '2026-03-16' }];
    expect(computeStreak(rows, currentMonday)).toBe(1);
  });

  it('returns 2 for two consecutive weeks', () => {
    const rows = [
      { week_start: '2026-03-16' },
      { week_start: '2026-03-09' },
    ];
    expect(computeStreak(rows, currentMonday)).toBe(2);
  });

  it('returns 3 for three consecutive weeks', () => {
    const rows = [
      { week_start: '2026-03-16' },
      { week_start: '2026-03-09' },
      { week_start: '2026-03-02' },
    ];
    expect(computeStreak(rows, currentMonday)).toBe(3);
  });

  it('stops counting when there is a gap week', () => {
    // Missing 2026-03-09 breaks the streak
    const rows = [
      { week_start: '2026-03-16' },
      { week_start: '2026-03-02' },
    ];
    expect(computeStreak(rows, currentMonday)).toBe(1);
  });

  it('returns 0 when the current week has no workout even if past weeks do', () => {
    const rows = [
      { week_start: '2026-03-09' },
      { week_start: '2026-03-02' },
    ];
    expect(computeStreak(rows, currentMonday)).toBe(0);
  });

  it('handles a long streak correctly', () => {
    const rows = [];
    for (let i = 0; i < 10; i++) {
      const d = new Date('2026-03-16T00:00:00.000Z');
      d.setDate(d.getDate() - i * 7);
      rows.push({ week_start: d.toISOString().slice(0, 10) });
    }
    expect(computeStreak(rows, currentMonday)).toBe(10);
  });
});

// ===== Muscle frequency aggregation =====

function aggregateMuscleFrequency(rows: { primary_muscles: string[] | string }[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const row of rows) {
    const muscles = Array.isArray(row.primary_muscles)
      ? row.primary_muscles
      : JSON.parse(row.primary_muscles as string || '[]');
    for (const muscle of muscles) {
      const key = String(muscle).toLowerCase();
      freq[key] = (freq[key] ?? 0) + 1;
    }
  }
  return freq;
}

describe('aggregateMuscleFrequency', () => {
  it('returns empty object for no rows', () => {
    expect(aggregateMuscleFrequency([])).toEqual({});
  });

  it('counts a single muscle group from a single exercise', () => {
    const rows = [{ primary_muscles: ['chest'] }];
    expect(aggregateMuscleFrequency(rows)).toEqual({ chest: 1 });
  });

  it('counts multiple exercises with the same muscle', () => {
    const rows = [
      { primary_muscles: ['chest'] },
      { primary_muscles: ['chest'] },
    ];
    expect(aggregateMuscleFrequency(rows)).toEqual({ chest: 2 });
  });

  it('counts multiple different muscles', () => {
    const rows = [
      { primary_muscles: ['chest'] },
      { primary_muscles: ['back'] },
      { primary_muscles: ['shoulders'] },
    ];
    expect(aggregateMuscleFrequency(rows)).toEqual({ chest: 1, back: 1, shoulders: 1 });
  });

  it('handles exercises with multiple primary muscles', () => {
    const rows = [{ primary_muscles: ['chest', 'triceps'] }];
    expect(aggregateMuscleFrequency(rows)).toEqual({ chest: 1, triceps: 1 });
  });

  it('normalises muscle names to lowercase', () => {
    const rows = [
      { primary_muscles: ['Chest'] },
      { primary_muscles: ['CHEST'] },
    ];
    expect(aggregateMuscleFrequency(rows)).toEqual({ chest: 2 });
  });

  it('parses JSON string arrays (legacy format)', () => {
    const rows = [{ primary_muscles: '["back","biceps"]' as unknown as string[] }];
    expect(aggregateMuscleFrequency(rows)).toEqual({ back: 1, biceps: 1 });
  });

  it('handles empty primary_muscles array', () => {
    const rows = [{ primary_muscles: [] }];
    expect(aggregateMuscleFrequency(rows)).toEqual({});
  });
});

// ===== Volume formatting =====

function formatVolume(volume: number): string {
  if (volume >= 1000) {
    return `${(volume / 1000).toFixed(1)}k kg`;
  }
  return `${Math.round(volume)} kg`;
}

describe('formatVolume', () => {
  it('formats zero as 0 kg', () => {
    expect(formatVolume(0)).toBe('0 kg');
  });

  it('formats values under 1000 with kg suffix', () => {
    expect(formatVolume(500)).toBe('500 kg');
  });

  it('rounds non-integer values under 1000', () => {
    expect(formatVolume(499.7)).toBe('500 kg');
    expect(formatVolume(100.2)).toBe('100 kg');
  });

  it('formats values >= 1000 with k suffix and one decimal', () => {
    expect(formatVolume(1000)).toBe('1.0k kg');
    expect(formatVolume(1500)).toBe('1.5k kg');
    expect(formatVolume(12345)).toBe('12.3k kg');
  });

  it('formats exactly 999 without k suffix', () => {
    expect(formatVolume(999)).toBe('999 kg');
  });

  it('formats large volumes correctly', () => {
    expect(formatVolume(100000)).toBe('100.0k kg');
  });
});
