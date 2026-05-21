import { describe, it, expect } from 'vitest';
import { dissolveOrphanGroups, findGroupLeaders, planMetadataMoves, type ExerciseForGrouping } from './supersetGrouping';

const ex = (overrides: Partial<ExerciseForGrouping> & Pick<ExerciseForGrouping, 'uuid' | 'order_index'>): ExerciseForGrouping => ({
  superset_group_uuid: null,
  ...overrides,
});

describe('dissolveOrphanGroups', () => {
  it('no groups → no clears', () => {
    const exs = [
      ex({ uuid: 'a', order_index: 0 }),
      ex({ uuid: 'b', order_index: 1 }),
    ];
    expect(dissolveOrphanGroups(exs)).toEqual([]);
  });

  it('valid pair → no clears', () => {
    const exs = [
      ex({ uuid: 'a', order_index: 0, superset_group_uuid: 'g1' }),
      ex({ uuid: 'b', order_index: 1, superset_group_uuid: 'g1' }),
    ];
    expect(dissolveOrphanGroups(exs)).toEqual([]);
  });

  it('valid trio → no clears', () => {
    const exs = [
      ex({ uuid: 'a', order_index: 0, superset_group_uuid: 'g1' }),
      ex({ uuid: 'b', order_index: 1, superset_group_uuid: 'g1' }),
      ex({ uuid: 'c', order_index: 2, superset_group_uuid: 'g1' }),
    ];
    expect(dissolveOrphanGroups(exs)).toEqual([]);
  });

  it('non-member dragged between two members → group dissolves', () => {
    const exs = [
      ex({ uuid: 'a', order_index: 0, superset_group_uuid: 'g1' }),
      ex({ uuid: 'x', order_index: 1, superset_group_uuid: null }),
      ex({ uuid: 'b', order_index: 2, superset_group_uuid: 'g1' }),
    ];
    // Both 'a' and 'b' get cleared — group is broken.
    const toClear = dissolveOrphanGroups(exs);
    expect(toClear.sort()).toEqual(['a', 'b']);
  });

  it('single-member group (orphan from earlier removal) → clear the orphan', () => {
    const exs = [
      ex({ uuid: 'a', order_index: 0, superset_group_uuid: 'g1' }),
      ex({ uuid: 'b', order_index: 1, superset_group_uuid: null }),
    ];
    expect(dissolveOrphanGroups(exs)).toEqual(['a']);
  });

  it('member dragged out of group → orphan single member dissolves', () => {
    const exs = [
      ex({ uuid: 'a', order_index: 0, superset_group_uuid: 'g1' }),
      ex({ uuid: 'c', order_index: 1, superset_group_uuid: null }),  // dragged here from between a,b
      ex({ uuid: 'b', order_index: 2, superset_group_uuid: 'g1' }),
      // c was part of g1 but its membership was cleared explicitly already
    ];
    const toClear = dissolveOrphanGroups(exs);
    // a + b non-adjacent → group dissolves both
    expect(toClear.sort()).toEqual(['a', 'b']);
  });

  it('multiple valid groups don\'t interfere', () => {
    const exs = [
      ex({ uuid: 'a', order_index: 0, superset_group_uuid: 'g1' }),
      ex({ uuid: 'b', order_index: 1, superset_group_uuid: 'g1' }),
      ex({ uuid: 'c', order_index: 2, superset_group_uuid: 'g2' }),
      ex({ uuid: 'd', order_index: 3, superset_group_uuid: 'g2' }),
    ];
    expect(dissolveOrphanGroups(exs)).toEqual([]);
  });

  it('soft-deleted members are excluded from contiguity check', () => {
    const exs = [
      ex({ uuid: 'a', order_index: 0, superset_group_uuid: 'g1' }),
      ex({ uuid: 'gone', order_index: 1, superset_group_uuid: 'g1', _deleted: true }),
      ex({ uuid: 'b', order_index: 2, superset_group_uuid: 'g1' }),
    ];
    // The deleted row doesn't break adjacency for the surviving members.
    expect(dissolveOrphanGroups(exs)).toEqual([]);
  });
});

describe('findGroupLeaders', () => {
  it('returns lowest-order_index member per group', () => {
    const exs = [
      ex({ uuid: 'a', order_index: 0, superset_group_uuid: 'g1' }),
      ex({ uuid: 'b', order_index: 1, superset_group_uuid: 'g1' }),
      ex({ uuid: 'c', order_index: 2, superset_group_uuid: 'g2' }),
      ex({ uuid: 'd', order_index: 3, superset_group_uuid: 'g2' }),
    ];
    const leaders = findGroupLeaders(exs);
    expect(leaders.get('g1')).toBe('a');
    expect(leaders.get('g2')).toBe('c');
  });

  it('ignores non-members and deleted rows', () => {
    const exs = [
      ex({ uuid: 'x', order_index: 0 }),
      ex({ uuid: 'a', order_index: 1, superset_group_uuid: 'g1' }),
      ex({ uuid: 'gone', order_index: 2, superset_group_uuid: 'g1', _deleted: true }),
      ex({ uuid: 'b', order_index: 3, superset_group_uuid: 'g1' }),
    ];
    expect(findGroupLeaders(exs).get('g1')).toBe('a');
  });
});

describe('planMetadataMoves', () => {
  it('leader unchanged → moves include leader uuid + correct metadata', () => {
    const exs = [
      ex({ uuid: 'a', order_index: 0, superset_group_uuid: 'g1', superset_round_target: 3, superset_rest_override_seconds: 120 }),
      ex({ uuid: 'b', order_index: 1, superset_group_uuid: 'g1' }),
    ];
    const moves = planMetadataMoves(exs);
    expect(moves).toHaveLength(1);
    expect(moves[0].leaderUuid).toBe('a');
    expect(moves[0].siblingUuids).toEqual(['b']);
    expect(moves[0].round_target).toBe(3);
    expect(moves[0].rest_override_seconds).toBe(120);
  });

  it('metadata on later sibling is rescued (post-demote)', () => {
    // The original leader 'b' has the metadata, but after reorder 'a' is
    // now the leader. The pass should promote 'a' and report the metadata
    // (so the caller can write it to 'a' and clear it on 'b').
    const exs = [
      ex({ uuid: 'a', order_index: 0, superset_group_uuid: 'g1' }),
      ex({ uuid: 'b', order_index: 1, superset_group_uuid: 'g1', superset_round_target: 4, superset_rest_override_seconds: 90 }),
    ];
    const moves = planMetadataMoves(exs);
    expect(moves[0].leaderUuid).toBe('a');
    expect(moves[0].siblingUuids).toEqual(['b']);
    expect(moves[0].round_target).toBe(4);
    expect(moves[0].rest_override_seconds).toBe(90);
  });

  it('single-member group is skipped (no group at <2 members)', () => {
    const exs = [
      ex({ uuid: 'a', order_index: 0, superset_group_uuid: 'g1' }),
    ];
    expect(planMetadataMoves(exs)).toEqual([]);
  });
});
