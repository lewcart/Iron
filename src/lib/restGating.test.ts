import { describe, it, expect } from 'vitest';
import {
  isMidDropChain,
  isMidSupersetRound,
  roundIndexOf,
  setNumberLabels,
  type SetForChain,
  type ExerciseForRound,
} from './restGating';

const set = (overrides: Partial<SetForChain> & Pick<SetForChain, 'uuid' | 'order_index'>): SetForChain => ({
  is_completed: false,
  tag: null,
  ...overrides,
});

describe('isMidDropChain (tag + adjacency, UC2)', () => {
  it('empty list → false', () => {
    expect(isMidDropChain(set({ uuid: 'a', order_index: 0, is_completed: true }), [])).toBe(false);
  });

  it('single bare set → false', () => {
    const a = set({ uuid: 'a', order_index: 0, is_completed: true });
    expect(isMidDropChain(a, [a])).toBe(false);
  });

  it('parent + 1 drop (just completed parent) → true', () => {
    const p = set({ uuid: 'p', order_index: 0, is_completed: true });
    const d = set({ uuid: 'd', order_index: 1, tag: 'dropSet' });
    expect(isMidDropChain(p, [p, d])).toBe(true);
  });

  it('parent + 1 drop (just completed drop, terminal) → false', () => {
    const p = set({ uuid: 'p', order_index: 0, is_completed: true });
    const d = set({ uuid: 'd', order_index: 1, tag: 'dropSet', is_completed: true });
    expect(isMidDropChain(d, [p, d])).toBe(false);
  });

  it('parent + 3 drops, just completed parent → true', () => {
    const p = set({ uuid: 'p', order_index: 0, is_completed: true });
    const d1 = set({ uuid: 'd1', order_index: 1, tag: 'dropSet' });
    const d2 = set({ uuid: 'd2', order_index: 2, tag: 'dropSet' });
    const d3 = set({ uuid: 'd3', order_index: 3, tag: 'dropSet' });
    expect(isMidDropChain(p, [p, d1, d2, d3])).toBe(true);
  });

  it('parent + 3 drops, just completed drop 2 → true (drop 3 pending)', () => {
    const p = set({ uuid: 'p', order_index: 0, is_completed: true });
    const d1 = set({ uuid: 'd1', order_index: 1, tag: 'dropSet', is_completed: true });
    const d2 = set({ uuid: 'd2', order_index: 2, tag: 'dropSet', is_completed: true });
    const d3 = set({ uuid: 'd3', order_index: 3, tag: 'dropSet' });
    expect(isMidDropChain(d2, [p, d1, d2, d3])).toBe(true);
  });

  it('parent + 3 drops, just completed drop 3 (terminal) → false', () => {
    const p = set({ uuid: 'p', order_index: 0, is_completed: true });
    const d1 = set({ uuid: 'd1', order_index: 1, tag: 'dropSet', is_completed: true });
    const d2 = set({ uuid: 'd2', order_index: 2, tag: 'dropSet', is_completed: true });
    const d3 = set({ uuid: 'd3', order_index: 3, tag: 'dropSet', is_completed: true });
    expect(isMidDropChain(d3, [p, d1, d2, d3])).toBe(false);
  });

  it('two parents in same exercise (working sets), just completed parent 1 → false (no drop next)', () => {
    const p1 = set({ uuid: 'p1', order_index: 0, is_completed: true });
    const p2 = set({ uuid: 'p2', order_index: 1 });
    expect(isMidDropChain(p1, [p1, p2])).toBe(false);
  });

  it('soft-deleted intermediate sets are skipped', () => {
    const p = set({ uuid: 'p', order_index: 0, is_completed: true });
    const deletedDrop = set({ uuid: 'gone', order_index: 1, tag: 'dropSet', _deleted: true });
    const realDrop = set({ uuid: 'd', order_index: 2, tag: 'dropSet' });
    expect(isMidDropChain(p, [p, deletedDrop, realDrop])).toBe(true);
  });
});

describe('roundIndexOf', () => {
  it('single bare set → 1', () => {
    const a = set({ uuid: 'a', order_index: 0 });
    expect(roundIndexOf(a, [a])).toBe(1);
  });

  it('two working sets → 1, 2', () => {
    const p1 = set({ uuid: 'p1', order_index: 0 });
    const p2 = set({ uuid: 'p2', order_index: 1 });
    expect(roundIndexOf(p1, [p1, p2])).toBe(1);
    expect(roundIndexOf(p2, [p1, p2])).toBe(2);
  });

  it('parent + 2 drops + parent → drops collapse into round 1', () => {
    const p1 = set({ uuid: 'p1', order_index: 0 });
    const d1 = set({ uuid: 'd1', order_index: 1, tag: 'dropSet' });
    const d2 = set({ uuid: 'd2', order_index: 2, tag: 'dropSet' });
    const p2 = set({ uuid: 'p2', order_index: 3 });
    const all = [p1, d1, d2, p2];
    expect(roundIndexOf(p1, all)).toBe(1);
    expect(roundIndexOf(d1, all)).toBe(1);
    expect(roundIndexOf(d2, all)).toBe(1);
    expect(roundIndexOf(p2, all)).toBe(2);
  });
});

describe('isMidSupersetRound (asymmetric counts supported)', () => {
  const mkEx = (overrides: Partial<ExerciseForRound> & Pick<ExerciseForRound, 'uuid' | 'sets'>): ExerciseForRound => ({
    workout_uuid: 'w',
    superset_group_uuid: 'g1',
    order_index: 0,
    ...overrides,
  });

  it('exercise not in a group → false', () => {
    const ex = mkEx({ uuid: 'ex', superset_group_uuid: null, sets: [set({ uuid: 's', order_index: 0, is_completed: true })] });
    expect(isMidSupersetRound(ex.sets[0], ex, [ex])).toBe(false);
  });

  it('group of 2, A round 1 just done, B round 1 pending → true', () => {
    const aSet = set({ uuid: 'a1', order_index: 0, is_completed: true });
    const bSet = set({ uuid: 'b1', order_index: 0 });
    const A = mkEx({ uuid: 'A', order_index: 0, sets: [aSet] });
    const B = mkEx({ uuid: 'B', order_index: 1, sets: [bSet] });
    expect(isMidSupersetRound(aSet, A, [A, B])).toBe(true);
  });

  it('group of 2, A and B round 1 both done → false (round complete)', () => {
    const aSet = set({ uuid: 'a1', order_index: 0, is_completed: true });
    const bSet = set({ uuid: 'b1', order_index: 0, is_completed: true });
    const A = mkEx({ uuid: 'A', order_index: 0, sets: [aSet] });
    const B = mkEx({ uuid: 'B', order_index: 1, sets: [bSet] });
    expect(isMidSupersetRound(bSet, B, [A, B])).toBe(false);
  });

  it('asymmetric: A has 4 sets, B has 3 — A round 4 done → false (B has no round 4)', () => {
    const a1 = set({ uuid: 'a1', order_index: 0, is_completed: true });
    const a2 = set({ uuid: 'a2', order_index: 1, is_completed: true });
    const a3 = set({ uuid: 'a3', order_index: 2, is_completed: true });
    const a4 = set({ uuid: 'a4', order_index: 3, is_completed: true });
    const b1 = set({ uuid: 'b1', order_index: 0, is_completed: true });
    const b2 = set({ uuid: 'b2', order_index: 1, is_completed: true });
    const b3 = set({ uuid: 'b3', order_index: 2, is_completed: true });
    const A = mkEx({ uuid: 'A', order_index: 0, sets: [a1, a2, a3, a4] });
    const B = mkEx({ uuid: 'B', order_index: 1, sets: [b1, b2, b3] });
    expect(isMidSupersetRound(a4, A, [A, B])).toBe(false);
  });

  it('group of 3, A done, B + C pending → true', () => {
    const a1 = set({ uuid: 'a1', order_index: 0, is_completed: true });
    const b1 = set({ uuid: 'b1', order_index: 0 });
    const c1 = set({ uuid: 'c1', order_index: 0 });
    const A = mkEx({ uuid: 'A', order_index: 0, sets: [a1] });
    const B = mkEx({ uuid: 'B', order_index: 1, sets: [b1] });
    const C = mkEx({ uuid: 'C', order_index: 2, sets: [c1] });
    expect(isMidSupersetRound(a1, A, [A, B, C])).toBe(true);
  });

  it('group of 3, A and B done, C pending → true', () => {
    const a1 = set({ uuid: 'a1', order_index: 0, is_completed: true });
    const b1 = set({ uuid: 'b1', order_index: 0, is_completed: true });
    const c1 = set({ uuid: 'c1', order_index: 0 });
    const A = mkEx({ uuid: 'A', order_index: 0, sets: [a1] });
    const B = mkEx({ uuid: 'B', order_index: 1, sets: [b1] });
    const C = mkEx({ uuid: 'C', order_index: 2, sets: [c1] });
    expect(isMidSupersetRound(b1, B, [A, B, C])).toBe(true);
  });

  it('orphan group (single member) → false', () => {
    const a1 = set({ uuid: 'a1', order_index: 0, is_completed: true });
    const A = mkEx({ uuid: 'A', order_index: 0, sets: [a1] });
    expect(isMidSupersetRound(a1, A, [A])).toBe(false);
  });

  it('drop in superset leg counts as parent round (B parent round 1 still pending)', () => {
    const a1 = set({ uuid: 'a1', order_index: 0, is_completed: true });
    const ad1 = set({ uuid: 'ad1', order_index: 1, tag: 'dropSet', is_completed: true });
    const b1 = set({ uuid: 'b1', order_index: 0 });
    const A = mkEx({ uuid: 'A', order_index: 0, sets: [a1, ad1] });
    const B = mkEx({ uuid: 'B', order_index: 1, sets: [b1] });
    // Finishing the drop in A is still round 1 (drops collapse). B's round 1 is pending → true.
    expect(isMidSupersetRound(ad1, A, [A, B])).toBe(true);
  });
});

describe('setNumberLabels', () => {
  it('all working: 1, 2, 3', () => {
    const sets = [
      set({ uuid: 'a', order_index: 0 }),
      set({ uuid: 'b', order_index: 1 }),
      set({ uuid: 'c', order_index: 2 }),
    ];
    expect(setNumberLabels(sets)).toEqual(['1', '2', '3']);
  });

  it('parent + 2 drops + parent → 1, D1, D2, 2', () => {
    const sets = [
      set({ uuid: 'p1', order_index: 0 }),
      set({ uuid: 'd1', order_index: 1, tag: 'dropSet' }),
      set({ uuid: 'd2', order_index: 2, tag: 'dropSet' }),
      set({ uuid: 'p2', order_index: 3 }),
    ];
    expect(setNumberLabels(sets)).toEqual(['1', 'D1', 'D2', '2']);
  });

  it('handles unsorted input by order_index', () => {
    const sets = [
      set({ uuid: 'p2', order_index: 3 }),
      set({ uuid: 'd2', order_index: 2, tag: 'dropSet' }),
      set({ uuid: 'p1', order_index: 0 }),
      set({ uuid: 'd1', order_index: 1, tag: 'dropSet' }),
    ];
    // Result is in INPUT order — caller renders sets in input order.
    expect(setNumberLabels(sets)).toEqual(['2', 'D2', '1', 'D1']);
  });

  it('soft-deleted sets get empty string', () => {
    const sets = [
      set({ uuid: 'p1', order_index: 0 }),
      set({ uuid: 'gone', order_index: 1, _deleted: true }),
      set({ uuid: 'p2', order_index: 2 }),
    ];
    expect(setNumberLabels(sets)).toEqual(['1', '', '2']);
  });
});
