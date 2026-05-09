import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { APP_TZ, resolveTz } from './app-tz';

describe('app-tz', () => {
  it('exports a non-empty default APP_TZ', () => {
    expect(typeof APP_TZ).toBe('string');
    expect(APP_TZ.length).toBeGreaterThan(0);
  });

  it('APP_TZ has no trailing whitespace or newline', () => {
    expect(APP_TZ).toBe(APP_TZ.trim());
    expect(APP_TZ).not.toMatch(/[\n\r\t ]/);
  });

  describe('loadAppTz (env var trimming)', () => {
    let originalEnv: string | undefined;
    beforeEach(() => {
      originalEnv = process.env.USER_TZ;
    });
    afterEach(() => {
      if (originalEnv === undefined) delete process.env.USER_TZ;
      else process.env.USER_TZ = originalEnv;
    });

    it('trims trailing newline from USER_TZ env var', async () => {
      process.env.USER_TZ = 'Australia/Sydney\n';
      const mod = await import('./app-tz?bust=newline-trim');
      expect(mod.APP_TZ).toBe('Australia/Sydney');
    });

    it('falls back to Brisbane when USER_TZ is garbage', async () => {
      process.env.USER_TZ = 'Not/A/Real/Zone';
      const mod = await import('./app-tz?bust=garbage');
      expect(mod.APP_TZ).toBe('Australia/Brisbane');
    });
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
