import { describe, it, expect } from 'vitest';

// ── Helper functions mirrored from settings/page.tsx ──────────────────────

const REST_TIMES = [30, 60, 90, 120, 150, 180, 210, 240, 300];

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (sec === 0) return `${m}:00`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function readLS(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function formatLogDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ===== REST_TIMES =====

describe('REST_TIMES', () => {
  it('contains 9 preset values', () => {
    expect(REST_TIMES).toHaveLength(9);
  });

  it('starts at 30 seconds and ends at 300 seconds', () => {
    expect(REST_TIMES[0]).toBe(30);
    expect(REST_TIMES[REST_TIMES.length - 1]).toBe(300);
  });

  it('is sorted in ascending order', () => {
    for (let i = 1; i < REST_TIMES.length; i++) {
      expect(REST_TIMES[i]).toBeGreaterThan(REST_TIMES[i - 1]);
    }
  });
});

// ===== formatTime =====

describe('formatTime', () => {
  it('formats whole minutes as M:00', () => {
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(90)).toBe('1:30');
    expect(formatTime(120)).toBe('2:00');
    expect(formatTime(180)).toBe('3:00');
    expect(formatTime(300)).toBe('5:00');
  });

  it('formats seconds under a minute as 0:SS', () => {
    expect(formatTime(30)).toBe('0:30');
  });

  it('pads seconds with leading zero when needed', () => {
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(91)).toBe('1:31');
  });

  it('formats all REST_TIMES without throwing', () => {
    for (const t of REST_TIMES) {
      expect(() => formatTime(t)).not.toThrow();
    }
  });

  it('formats 0 seconds as 0:00', () => {
    expect(formatTime(0)).toBe('0:00');
  });
});

// ===== readLS =====
// Tests run in node environment (no jsdom), so window is undefined.
// readLS guards against this and always returns the fallback in that case.

describe('readLS', () => {
  it('returns fallback when window is undefined (node env)', () => {
    expect(readLS('rebirth-rest-default', '90')).toBe('90');
  });

  it('returns fallback for any key in node env', () => {
    expect(readLS('rebirth-rest-auto-start', 'true')).toBe('true');
  });

  it('returns fallback for keep-running setting in node env', () => {
    expect(readLS('rebirth-rest-keep-running', 'false')).toBe('false');
  });
});

// ===== formatLogDate =====

describe('formatLogDate', () => {
  it('formats an ISO date string to en-GB locale with day, month, year', () => {
    const result = formatLogDate('2026-03-20T09:00:00.000Z');
    expect(result).toBe('20 Mar 2026');
  });

  it('handles beginning of year', () => {
    const result = formatLogDate('2026-01-01T12:00:00.000Z');
    expect(result).toBe('01 Jan 2026');
  });

  it('handles different months correctly', () => {
    expect(formatLogDate('2026-06-15T00:00:00.000Z')).toMatch(/Jun 2026/);
    expect(formatLogDate('2026-11-05T00:00:00.000Z')).toMatch(/Nov 2026/);
  });
});
