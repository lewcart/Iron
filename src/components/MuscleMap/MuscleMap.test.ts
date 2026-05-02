import { describe, it, expect } from 'vitest';
import { MUSCLE_SLUGS, type MuscleSlug } from '@/lib/muscles';
import { SLUG_TO_LIB, isDeep, type LibSlug } from './slug-map';

const VALID_LIB_SLUGS: ReadonlySet<LibSlug> = new Set([
  'chest',
  'biceps',
  'triceps',
  'forearm',
  'abs',
  'obliques',
  'quadriceps',
  'hamstring',
  'gluteal',
  'adductors',
  'calves',
  'deltoids',
  'upper-back',
  'lower-back',
  'trapezius',
]);

describe('SLUG_TO_LIB coverage', () => {
  it('every canonical muscle slug has an entry', () => {
    for (const slug of MUSCLE_SLUGS) {
      expect(SLUG_TO_LIB, `slug "${slug}" missing from SLUG_TO_LIB`).toHaveProperty(slug);
    }
  });

  it('each non-null entry maps to valid library slugs', () => {
    for (const slug of MUSCLE_SLUGS) {
      const mapped = SLUG_TO_LIB[slug];
      if (mapped === null) continue;
      expect(mapped.length, `${slug} maps to empty array`).toBeGreaterThan(0);
      for (const lib of mapped) {
        expect(VALID_LIB_SLUGS.has(lib), `${slug} → "${lib}" not a valid lib slug`).toBe(true);
      }
    }
  });

  it('rotator_cuff is intentionally deep (no library region)', () => {
    expect(SLUG_TO_LIB.rotator_cuff).toBeNull();
    expect(isDeep('rotator_cuff')).toBe(true);
  });

  it('hip_abductors is intentionally deep (library has no side-hip region)', () => {
    expect(SLUG_TO_LIB.hip_abductors).toBeNull();
    expect(isDeep('hip_abductors')).toBe(true);
  });

  it('core maps to BOTH abs and obliques (composite region)', () => {
    expect(SLUG_TO_LIB.core).toEqual(['abs', 'obliques']);
  });

  it('lats and rhomboids both collapse to upper-back (known fidelity loss)', () => {
    expect(SLUG_TO_LIB.lats).toEqual(['upper-back']);
    expect(SLUG_TO_LIB.rhomboids).toEqual(['upper-back']);
  });

  it('mid_traps and lower_traps both collapse to trapezius (known fidelity loss)', () => {
    expect(SLUG_TO_LIB.mid_traps).toEqual(['trapezius']);
    expect(SLUG_TO_LIB.lower_traps).toEqual(['trapezius']);
  });

  it('exactly 2 slugs are deep — rotator_cuff and hip_abductors', () => {
    const deep = MUSCLE_SLUGS.filter((s) => isDeep(s as MuscleSlug));
    expect(deep.sort()).toEqual(['hip_abductors', 'rotator_cuff']);
  });
});
