import { describe, it, expect } from 'vitest';
import {
  REASON_CHIP_REGISTRY,
  sortChipsBySeverity,
  type ReasonChip,
} from './reason-chip-registry';

describe('REASON_CHIP_REGISTRY', () => {
  it('every kind has a registry entry', () => {
    const kinds: ReasonChip['kind'][] = ['hrv_low', 'rir_drift', 'e1rm_stagnant', 'zone_over', 'zone_risk'];
    for (const kind of kinds) {
      expect(REASON_CHIP_REGISTRY[kind]).toBeDefined();
    }
  });

  it('hrv_low label uses sigma value', () => {
    const meta = REASON_CHIP_REGISTRY.hrv_low;
    expect(meta.label({ kind: 'hrv_low', sigma: 1.2 })).toBe('HRV ↓1.2σ');
  });

  it('hrv_low ariaLabel reads aloud (no symbols)', () => {
    const meta = REASON_CHIP_REGISTRY.hrv_low;
    const aria = meta.ariaLabel({ kind: 'hrv_low', sigma: 1.2 });
    expect(aria).not.toMatch(/↓/);
    expect(aria).not.toMatch(/σ/);
    expect(aria).toMatch(/standard deviations/);
  });

  it('rir_drift explanation includes muscle name and delta', () => {
    const meta = REASON_CHIP_REGISTRY.rir_drift;
    const exp = meta.explanation({ kind: 'rir_drift', muscle: 'glutes', delta: 0.7 });
    expect(exp).toMatch(/glutes/);
    expect(exp).toMatch(/0\.7/);
  });

  it('e1rm_stagnant label has the trending-down arrow', () => {
    const meta = REASON_CHIP_REGISTRY.e1rm_stagnant;
    expect(meta.label({ kind: 'e1rm_stagnant', lift: 'Hip Thrust' })).toMatch(/↘/);
  });

  it('e1rm_stagnant ariaLabel does not contain the arrow', () => {
    const meta = REASON_CHIP_REGISTRY.e1rm_stagnant;
    const aria = meta.ariaLabel({ kind: 'e1rm_stagnant', lift: 'Hip Thrust' });
    expect(aria).not.toMatch(/↘/);
  });

  it('severity ordering: zone_risk and hrv_low are highest (3)', () => {
    expect(REASON_CHIP_REGISTRY.hrv_low.severity).toBe(3);
    expect(REASON_CHIP_REGISTRY.zone_risk.severity).toBe(3);
  });

  it('severity ordering: zone_over is lowest (1)', () => {
    expect(REASON_CHIP_REGISTRY.zone_over.severity).toBe(1);
  });
});

describe('sortChipsBySeverity', () => {
  it('sorts by severity descending', () => {
    const chips: ReasonChip[] = [
      { kind: 'zone_over', muscle: 'a' },         // sev 1
      { kind: 'hrv_low', sigma: 1.0 },           // sev 3
      { kind: 'rir_drift', muscle: 'b', delta: 0.5 },  // sev 2
    ];
    const sorted = sortChipsBySeverity(chips);
    expect(sorted.map(c => c.kind)).toEqual(['hrv_low', 'rir_drift', 'zone_over']);
  });

  it('does not mutate the input array', () => {
    const chips: ReasonChip[] = [
      { kind: 'zone_over', muscle: 'a' },
      { kind: 'hrv_low', sigma: 1.0 },
    ];
    const original = [...chips];
    sortChipsBySeverity(chips);
    expect(chips).toEqual(original);
  });
});
