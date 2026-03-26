import { describe, it, expect, vi, afterEach } from 'vitest';

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

// ===== isoDate =====

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe('isoDate', () => {
  it('returns YYYY-MM-DD slice from a UTC date', () => {
    expect(isoDate(new Date('2026-03-25T00:00:00.000Z'))).toBe('2026-03-25');
  });

  it('strips time portion', () => {
    expect(isoDate(new Date('2026-01-01T23:59:59.999Z'))).toBe('2026-01-01');
  });
});

// ===== formatDuration =====

function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const diff = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.round(diff / 60000);
  if (mins >= 60) {
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
  return `${mins}m`;
}

describe('formatDuration', () => {
  it('returns em-dash when end is null', () => {
    expect(formatDuration('2026-03-25T10:00:00.000Z', null)).toBe('—');
  });

  it('formats durations under 60 minutes as Xm', () => {
    expect(formatDuration('2026-03-25T10:00:00.000Z', '2026-03-25T10:45:00.000Z')).toBe('45m');
  });

  it('formats durations of exactly 60 minutes as 1h 0m', () => {
    expect(formatDuration('2026-03-25T10:00:00.000Z', '2026-03-25T11:00:00.000Z')).toBe('1h 0m');
  });

  it('formats durations over 60 minutes as Xh Ym', () => {
    expect(formatDuration('2026-03-25T10:00:00.000Z', '2026-03-25T11:30:00.000Z')).toBe('1h 30m');
  });

  it('rounds to nearest minute', () => {
    // 44.5 minutes → rounds to 45
    expect(formatDuration('2026-03-25T10:00:00.000Z', '2026-03-25T10:44:30.000Z')).toBe('45m');
  });

  it('returns 0m for zero duration', () => {
    expect(formatDuration('2026-03-25T10:00:00.000Z', '2026-03-25T10:00:00.000Z')).toBe('0m');
  });
});

// ===== formatTimeAgo =====

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  // Falls back to formatted date — tested by presence of a non-"ago" string
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

describe('formatTimeAgo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const NOW = new Date('2026-03-25T12:00:00.000Z').getTime();

  it('returns Xm ago for timestamps less than 60 minutes ago', () => {
    vi.setSystemTime(NOW);
    const ts = new Date(NOW - 30 * 60 * 1000).toISOString();
    expect(formatTimeAgo(ts)).toBe('30m ago');
  });

  it('returns 0m ago for a timestamp equal to now', () => {
    vi.setSystemTime(NOW);
    expect(formatTimeAgo(new Date(NOW).toISOString())).toBe('0m ago');
  });

  it('returns Xh ago for timestamps between 1-23 hours ago', () => {
    vi.setSystemTime(NOW);
    const ts = new Date(NOW - 5 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgo(ts)).toBe('5h ago');
  });

  it('returns Yesterday for timestamps 1 day ago', () => {
    vi.setSystemTime(NOW);
    const ts = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgo(ts)).toBe('Yesterday');
  });

  it('returns Xd ago for timestamps 2-6 days ago', () => {
    vi.setSystemTime(NOW);
    const ts = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgo(ts)).toBe('3d ago');
  });

  it('falls back to formatted date for timestamps 7+ days ago', () => {
    vi.setSystemTime(NOW);
    const ts = new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatTimeAgo(ts);
    // Should not contain "ago" or "Yesterday" — is a formatted date string
    expect(result).not.toContain('ago');
    expect(result).not.toBe('Yesterday');
  });
});

// ===== muscleHeatColor =====

function muscleHeatColor(count: number): string {
  if (count >= 3) return 'bg-blue-500';
  if (count === 2) return 'bg-blue-700';
  if (count === 1) return 'bg-blue-900';
  return 'bg-zinc-800';
}

describe('muscleHeatColor', () => {
  it('returns bg-zinc-800 for 0 count', () => {
    expect(muscleHeatColor(0)).toBe('bg-zinc-800');
  });

  it('returns bg-blue-900 for count of 1', () => {
    expect(muscleHeatColor(1)).toBe('bg-blue-900');
  });

  it('returns bg-blue-700 for count of 2', () => {
    expect(muscleHeatColor(2)).toBe('bg-blue-700');
  });

  it('returns bg-blue-500 for count of 3', () => {
    expect(muscleHeatColor(3)).toBe('bg-blue-500');
  });

  it('returns bg-blue-500 for count greater than 3', () => {
    expect(muscleHeatColor(10)).toBe('bg-blue-500');
  });
});

// ===== muscleTextColor =====

function muscleTextColor(count: number): string {
  if (count >= 1) return 'text-zinc-100';
  return 'text-zinc-500';
}

describe('muscleTextColor', () => {
  it('returns text-zinc-500 for count of 0', () => {
    expect(muscleTextColor(0)).toBe('text-zinc-500');
  });

  it('returns text-zinc-100 for count of 1', () => {
    expect(muscleTextColor(1)).toBe('text-zinc-100');
  });

  it('returns text-zinc-100 for count greater than 1', () => {
    expect(muscleTextColor(5)).toBe('text-zinc-100');
  });
});
