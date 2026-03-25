import { describe, it, expect } from 'vitest';

// ── Helper functions mirrored from body-spec/page.tsx ──────────────────────

function formatDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function toDateInputValue(isoStr?: string): string {
  const d = isoStr ? new Date(isoStr) : new Date();
  return d.toISOString().slice(0, 10);
}

function apiHeaders(apiKey?: string): HeadersInit {
  return apiKey
    ? { 'Content-Type': 'application/json', 'X-Api-Key': apiKey }
    : { 'Content-Type': 'application/json' };
}

// ===== formatDate =====

describe('formatDate', () => {
  it('formats an ISO date string to en-GB locale with day, month, year', () => {
    const result = formatDate('2026-03-20T09:00:00.000Z');
    expect(result).toBe('20 Mar 2026');
  });

  it('handles beginning of year', () => {
    const result = formatDate('2026-01-01T00:00:00.000Z');
    expect(result).toBe('01 Jan 2026');
  });

  it('handles end of year', () => {
    // Use noon UTC to avoid local timezone shifting the date to the next day
    const result = formatDate('2025-12-31T12:00:00.000Z');
    expect(result).toMatch(/Dec 2025/);
  });
});

// ===== toDateInputValue =====

describe('toDateInputValue', () => {
  it('converts an ISO string to YYYY-MM-DD format', () => {
    const result = toDateInputValue('2026-03-20T09:00:00.000Z');
    expect(result).toBe('2026-03-20');
  });

  it('returns today\'s date in YYYY-MM-DD format when called with no argument', () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = toDateInputValue();
    expect(result).toBe(today);
  });

  it('returns today\'s date when called with undefined', () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = toDateInputValue(undefined);
    expect(result).toBe(today);
  });

  it('preserves the date portion of the ISO string', () => {
    const result = toDateInputValue('2025-07-04T15:30:00.000Z');
    expect(result).toBe('2025-07-04');
  });

  it('returns a 10-character string', () => {
    const result = toDateInputValue('2026-03-20T09:00:00.000Z');
    expect(result).toHaveLength(10);
  });
});

// ===== apiHeaders =====

describe('apiHeaders', () => {
  it('returns only Content-Type header when no API key is provided', () => {
    const headers = apiHeaders();
    expect(headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('includes X-Api-Key header when API key is provided', () => {
    const headers = apiHeaders('my-secret-key');
    expect(headers).toEqual({
      'Content-Type': 'application/json',
      'X-Api-Key': 'my-secret-key',
    });
  });

  it('does not include X-Api-Key when key is empty string', () => {
    const headers = apiHeaders('');
    expect(headers).toEqual({ 'Content-Type': 'application/json' });
  });
});
