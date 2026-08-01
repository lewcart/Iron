// Tests for the sheet-mirroring layout helpers (SHEET_SECTIONS + impedance).
// Row keys are compile-time checked (ScanNumericKey), so these tests focus on
// runtime behavior: ordering, null-safety, and section integrity.
import { describe, it, expect } from 'vitest';
import {
  SHEET_SECTIONS, formatSheetNumber, impedanceRows, IMPEDANCE_SEGMENTS, METRICS,
} from './inbody';

describe('SHEET_SECTIONS', () => {
  it('has unique section ids', () => {
    const ids = SHEET_SECTIONS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every section has at least one row and a valid column', () => {
    for (const s of SHEET_SECTIONS) {
      expect(s.rows.length).toBeGreaterThan(0);
      expect(['left', 'right']).toContain(s.column);
    }
  });

  it('pctKey companions are only used on segmental rows and end in _pct', () => {
    for (const s of SHEET_SECTIONS) {
      for (const r of s.rows) {
        if (r.pctKey) {
          expect(r.pctKey.endsWith('_pct')).toBe(true);
          expect(r.key.startsWith('seg_')).toBe(true);
          // kg key and pct key must describe the same segment
          expect(r.pctKey.replace(/_pct$/, '')).toBe(r.key.replace(/_kg$/, ''));
        }
      }
    }
  });

  it('every primary row key has a METRICS def, so norm/goal status resolution works', () => {
    const metricKeys = new Set(METRICS.map(m => m.key as string));
    for (const s of SHEET_SECTIONS) {
      for (const r of s.rows) {
        expect(metricKeys.has(r.key), `no METRICS def for ${r.key}`).toBe(true);
      }
    }
  });

  it('signed rows are exactly the weight/fat/muscle control block', () => {
    const signed = SHEET_SECTIONS.flatMap(s => s.rows).filter(r => r.signed).map(r => r.key).sort();
    expect(signed).toEqual(['fat_control_kg', 'muscle_control_kg', 'weight_control_kg']);
  });
});

describe('formatSheetNumber', () => {
  it('formats to fixed decimals', () => {
    expect(formatSheetNumber(27.94, 1)).toBe('27.9');
    expect(formatSheetNumber(0.367, 3)).toBe('0.367');
    expect(formatSheetNumber(1439, 0)).toBe('1439');
  });

  it('adds + only for signed positives', () => {
    expect(formatSheetNumber(4, 1, true)).toBe('+4.0');
    expect(formatSheetNumber(-1.7, 1, true)).toBe('-1.7');
    expect(formatSheetNumber(0, 1, true)).toBe('0.0');
    expect(formatSheetNumber(4, 1, false)).toBe('4.0');
  });

  it('renders null as em dash', () => {
    expect(formatSheetNumber(null)).toBe('—');
  });
});

describe('impedanceRows', () => {
  const sample = {
    '500khz': { ra: 262.6, la: 266.0, trunk: 16.7, rl: 254.0, ll: 251.2 },
    '5khz': { ra: 356.5, la: 358.6, trunk: 27.1, rl: 351.3, ll: 343.6 },
    '50khz': { ra: 310.3, la: 313.0, trunk: 22.5, rl: 298.8, ll: 294.5 },
  };

  it('sorts frequencies numerically regardless of key order (5 < 50 < 500)', () => {
    const rows = impedanceRows(sample);
    expect(rows.map(r => r.freq)).toEqual(['5 kHz', '50 kHz', '500 kHz']);
  });

  it('emits values in sheet segment order RA LA TR RL LL', () => {
    const rows = impedanceRows(sample);
    expect(IMPEDANCE_SEGMENTS).toEqual(['ra', 'la', 'trunk', 'rl', 'll']);
    expect(rows[0].values).toEqual([356.5, 358.6, 27.1, 351.3, 343.6]);
  });

  it('handles empty / null / missing-segment input without throwing', () => {
    expect(impedanceRows(null)).toEqual([]);
    expect(impedanceRows(undefined)).toEqual([]);
    expect(impedanceRows({})).toEqual([]);
    const partial = impedanceRows({ '50khz': { ra: 310.3 } });
    expect(partial[0].values).toEqual([310.3, null, null, null, null]);
  });

  it('ignores non-frequency keys', () => {
    const rows = impedanceRows({ note: { ra: 1 } as Record<string, number>, '50khz': { ra: 2, la: 3, trunk: 4, rl: 5, ll: 6 } });
    expect(rows).toHaveLength(1);
    expect(rows[0].freq).toBe('50 kHz');
  });
});
