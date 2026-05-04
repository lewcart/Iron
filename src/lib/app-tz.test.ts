import { describe, it, expect } from 'vitest';
import { APP_TZ, resolveTz } from './app-tz';

describe('app-tz', () => {
  it('exports a non-empty default APP_TZ', () => {
    expect(typeof APP_TZ).toBe('string');
    expect(APP_TZ.length).toBeGreaterThan(0);
  });

  describe('resolveTz', () => {
    it('returns APP_TZ for empty/missing input', () => {
      expect(resolveTz(undefined)).toBe(APP_TZ);
      expect(resolveTz(null)).toBe(APP_TZ);
      expect(resolveTz('')).toBe(APP_TZ);
    });

    it('passes through valid IANA names', () => {
      expect(resolveTz('Europe/London')).toBe('Europe/London');
      expect(resolveTz('Australia/Sydney')).toBe('Australia/Sydney');
      expect(resolveTz('America/New_York')).toBe('America/New_York');
      expect(resolveTz('UTC')).toBe('UTC');
    });

    it('falls back to APP_TZ on garbage / injection attempts', () => {
      expect(resolveTz("'); DROP TABLE workouts; --")).toBe(APP_TZ);
      expect(resolveTz('Not/A/Real/Zone')).toBe(APP_TZ);
      expect(resolveTz(42)).toBe(APP_TZ);
      expect(resolveTz({ tz: 'Europe/London' })).toBe(APP_TZ);
    });

    it('rejects oversized strings', () => {
      const huge = 'A'.repeat(500);
      expect(resolveTz(huge)).toBe(APP_TZ);
    });
  });
});
