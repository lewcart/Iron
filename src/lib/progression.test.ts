import { describe, it, expect } from 'vitest';
import { recommendForExercise } from './progression';

const set = (overrides: Partial<{
  is_completed: boolean;
  repetitions: number | null;
  duration_seconds: number | null;
  min_target_reps: number | null;
  max_target_reps: number | null;
  rir: number | null;
}> = {}) => ({
  is_completed: true,
  repetitions: null,
  duration_seconds: null,
  min_target_reps: null,
  max_target_reps: null,
  rir: null,
  ...overrides,
});

describe('recommendForExercise — reps mode', () => {
  it('returns null with no completed sets', () => {
    expect(recommendForExercise([], 'reps')).toBeNull();
  });

  it('skips incomplete sets', () => {
    const sets = [set({ is_completed: false, repetitions: 12, rir: 0 })];
    expect(recommendForExercise(sets, 'reps')).toBeNull();
  });

  it('go heavier (high) when majority blew past max range', () => {
    const sets = [
      set({ repetitions: 18, min_target_reps: 8, max_target_reps: 12, rir: 1 }),
      set({ repetitions: 16, min_target_reps: 8, max_target_reps: 12, rir: 1 }),
      set({ repetitions: 15, min_target_reps: 8, max_target_reps: 12, rir: 1 }),
    ];
    const r = recommendForExercise(sets, 'reps');
    expect(r?.kind).toBe('go-heavier');
    expect(r?.intensity).toBe('high');
  });

  it('go heavier (high) when avg RIR is junk-territory (≥4)', () => {
    const sets = [
      set({ repetitions: 10, min_target_reps: 8, max_target_reps: 12, rir: 4 }),
      set({ repetitions: 10, min_target_reps: 8, max_target_reps: 12, rir: 5 }),
    ];
    const r = recommendForExercise(sets, 'reps');
    expect(r?.kind).toBe('go-heavier');
    expect(r?.intensity).toBe('high');
  });

  it('go heavier (medium) when at top of range with RIR room', () => {
    const sets = [
      set({ repetitions: 12, min_target_reps: 8, max_target_reps: 12, rir: 2 }),
      set({ repetitions: 12, min_target_reps: 8, max_target_reps: 12, rir: 2 }),
    ];
    const r = recommendForExercise(sets, 'reps');
    expect(r?.kind).toBe('go-heavier');
    expect(r?.intensity).toBe('medium');
  });

  it('more reps when in range with RIR room', () => {
    const sets = [
      set({ repetitions: 9, min_target_reps: 8, max_target_reps: 12, rir: 2 }),
      set({ repetitions: 10, min_target_reps: 8, max_target_reps: 12, rir: 3 }),
    ];
    const r = recommendForExercise(sets, 'reps');
    expect(r?.kind).toBe('more-reps');
    expect(r?.intensity).toBe('medium');
  });

  it('hold when nailed target with RIR 0–1', () => {
    const sets = [
      set({ repetitions: 12, min_target_reps: 12, max_target_reps: 12, rir: 0 }),
      set({ repetitions: 12, min_target_reps: 12, max_target_reps: 12, rir: 1 }),
    ];
    const r = recommendForExercise(sets, 'reps');
    expect(r?.kind).toBe('hold');
  });

  it('back off when majority below min reps', () => {
    const sets = [
      set({ repetitions: 6, min_target_reps: 8, max_target_reps: 12, rir: 0 }),
      set({ repetitions: 5, min_target_reps: 8, max_target_reps: 12, rir: 0 }),
    ];
    const r = recommendForExercise(sets, 'reps');
    expect(r?.kind).toBe('back-off');
  });

  it('treats null RIR as ~2 (charitable default)', () => {
    // In range, no RIR logged — falls through to "more reps" via default.
    const sets = [
      set({ repetitions: 10, min_target_reps: 8, max_target_reps: 12, rir: null }),
      set({ repetitions: 10, min_target_reps: 8, max_target_reps: 12, rir: null }),
    ];
    expect(recommendForExercise(sets, 'reps')?.kind).toBe('more-reps');
  });

  it('falls back to RIR-only when no targets are set', () => {
    const sets = [
      set({ repetitions: 10, rir: 4 }),
      set({ repetitions: 10, rir: 4 }),
    ];
    const r = recommendForExercise(sets, 'reps');
    expect(r?.kind).toBe('go-heavier');
    expect(r?.intensity).toBe('high');
  });
});

describe('recommendForExercise — time mode', () => {
  it('go longer (high) when avg RIR ≥ 4', () => {
    const sets = [
      set({ duration_seconds: 60, rir: 4 }),
      set({ duration_seconds: 60, rir: 5 }),
    ];
    const r = recommendForExercise(sets, 'time');
    expect(r?.kind).toBe('go-longer');
    expect(r?.intensity).toBe('high');
  });

  it('go longer (medium) when avg RIR ≥ 2', () => {
    const sets = [
      set({ duration_seconds: 45, rir: 2 }),
      set({ duration_seconds: 45, rir: 3 }),
    ];
    expect(recommendForExercise(sets, 'time')?.kind).toBe('go-longer');
  });

  it('hold when avg RIR ≤ 1', () => {
    const sets = [
      set({ duration_seconds: 30, rir: 0 }),
      set({ duration_seconds: 30, rir: 1 }),
    ];
    expect(recommendForExercise(sets, 'time')?.kind).toBe('hold');
  });

  it('skips zero-duration sets', () => {
    const sets = [set({ duration_seconds: 0, rir: 2 })];
    expect(recommendForExercise(sets, 'time')).toBeNull();
  });
});
