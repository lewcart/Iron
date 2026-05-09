import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/db/local';
import {
  excludeSetFromPb,
  excludeSetsForExerciseThroughDate,
  restorePbForSets,
} from '@/lib/mutations';
import { getExerciseProgressLocal, getExerciseTimePRsLocal } from '@/lib/useLocalDB';
import { calculatePRs, calculateTimePRs } from '@/lib/pr';
import { buildAnchorLiftTrend } from '@/lib/training/anchor-lift-trend';

// ── Test fixtures ──────────────────────────────────────────────────────────

const BENCH_UUID_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
/** Canonical-group sibling of BENCH_UUID_A (same everkinetic_id). Used to
 *  prove canonical-grouping behavior end-to-end across the Dexie path. */
const BENCH_UUID_B = 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff';
const BENCH_EVERKINETIC_ID = 9999;

const PLANK_UUID = '11111111-2222-3333-4444-555555555555';
const PLANK_EVERKINETIC_ID = 7777;

async function seedBenchPair() {
  for (const [uuid, title] of [
    [BENCH_UUID_A, 'Bench Press'],
    [BENCH_UUID_B, 'Bench Press'],
  ] as const) {
    await db.exercises.put({
      uuid,
      everkinetic_id: BENCH_EVERKINETIC_ID,
      title,
      alias: [],
      description: null,
      primary_muscles: ['chest'],
      secondary_muscles: [],
      equipment: [],
      steps: [],
      tips: [],
      is_custom: false,
      is_hidden: false,
      movement_pattern: null,
      tracking_mode: 'reps',
      image_count: 0,
      youtube_url: null,
      image_urls: [],
      has_sides: false,
      lateral_emphasis: false,
      secondary_weights: null,
      weight_source: null,
    });
  }
}

async function seedPlank() {
  await db.exercises.put({
    uuid: PLANK_UUID,
    everkinetic_id: PLANK_EVERKINETIC_ID,
    title: 'Plank',
    alias: [],
    description: null,
    primary_muscles: ['core'],
    secondary_muscles: [],
    equipment: [],
    steps: [],
    tips: [],
    is_custom: false,
    is_hidden: false,
    movement_pattern: null,
    tracking_mode: 'time',
    image_count: 0,
    youtube_url: null,
    image_urls: [],
    has_sides: false,
    lateral_emphasis: false,
    secondary_weights: null,
    weight_source: null,
  });
}

async function seedRepsSet(opts: {
  uuid: string;
  exerciseUuid: string;
  weUuid: string;
  workoutUuid: string;
  startTime: string;
  weight: number;
  reps: number;
  excludedFromPb?: boolean;
  orderIndex?: number;
}) {
  await db.workouts.put({
    uuid: opts.workoutUuid,
    start_time: opts.startTime,
    end_time: opts.startTime,
    title: null,
    comment: null,
    is_current: false,
    workout_routine_uuid: null,
    _synced: true,
    _updated_at: 0,
    _deleted: false,
  } as never);
  await db.workout_exercises.put({
    uuid: opts.weUuid,
    workout_uuid: opts.workoutUuid,
    exercise_uuid: opts.exerciseUuid,
    comment: null,
    order_index: 0,
    _synced: true,
    _updated_at: 0,
    _deleted: false,
  } as never);
  await db.workout_sets.put({
    uuid: opts.uuid,
    workout_exercise_uuid: opts.weUuid,
    weight: opts.weight,
    repetitions: opts.reps,
    min_target_reps: null,
    max_target_reps: null,
    rpe: null,
    rir: null,
    tag: null,
    comment: null,
    is_completed: true,
    is_pr: false,
    excluded_from_pb: opts.excludedFromPb ?? false,
    duration_seconds: null,
    order_index: opts.orderIndex ?? 0,
    _synced: true,
    _updated_at: 0,
    _deleted: false,
  });
}

async function seedTimeSet(opts: {
  uuid: string;
  weUuid: string;
  workoutUuid: string;
  startTime: string;
  durationSeconds: number;
  excludedFromPb?: boolean;
}) {
  await db.workouts.put({
    uuid: opts.workoutUuid,
    start_time: opts.startTime,
    end_time: opts.startTime,
    title: null,
    comment: null,
    is_current: false,
    workout_routine_uuid: null,
    _synced: true,
    _updated_at: 0,
    _deleted: false,
  } as never);
  await db.workout_exercises.put({
    uuid: opts.weUuid,
    workout_uuid: opts.workoutUuid,
    exercise_uuid: PLANK_UUID,
    comment: null,
    order_index: 0,
    _synced: true,
    _updated_at: 0,
    _deleted: false,
  } as never);
  await db.workout_sets.put({
    uuid: opts.uuid,
    workout_exercise_uuid: opts.weUuid,
    weight: null,
    repetitions: null,
    min_target_reps: null,
    max_target_reps: null,
    rpe: null,
    rir: null,
    tag: null,
    comment: null,
    is_completed: true,
    is_pr: false,
    excluded_from_pb: opts.excludedFromPb ?? false,
    duration_seconds: opts.durationSeconds,
    order_index: 0,
    _synced: true,
    _updated_at: 0,
    _deleted: false,
  });
}

beforeEach(async () => {
  await Promise.all([
    db.exercises.clear(),
    db.workouts.clear(),
    db.workout_exercises.clear(),
    db.workout_sets.clear(),
  ]);
});

// ── calculatePRs respects excluded ─────────────────────────────────────────

describe('calculatePRs — pure', () => {
  it('does not see excluded sets (caller must pre-filter)', () => {
    // The pure helper has no excluded_from_pb field — that's by design.
    // Read sites filter at the SQL / Dexie layer. This test pins the
    // contract: if an excluded set is filtered upstream, the result
    // reflects only the remaining sets.
    const filteredOut = calculatePRs([
      { weight: 100, repetitions: 5, date: '2026-01-01' },  // e1RM 116.67
    ]);
    const allIncluded = calculatePRs([
      { weight: 100, repetitions: 5, date: '2026-01-01' },
      { weight: 200, repetitions: 1, date: '2026-01-02' },  // e1RM 206.67
    ]);
    expect(allIncluded.estimated1RM?.weight).toBe(200);
    expect(filteredOut.estimated1RM?.weight).toBe(100);
  });
});

// ── Dexie-side bulk exclusion ──────────────────────────────────────────────

describe('excludeSetsForExerciseThroughDate', () => {
  it('flips only sets on or before the cutoff (inclusive)', async () => {
    await seedBenchPair();
    // Three sessions over 3 weeks. Cutoff at the middle one — first two
    // (incl. cutoff date) flip; last one stays included.
    await seedRepsSet({
      uuid: 's-old',  exerciseUuid: BENCH_UUID_A,
      weUuid: 'we-old', workoutUuid: 'wo-old',
      startTime: '2026-04-01T10:00:00Z',
      weight: 80, reps: 5,
    });
    await seedRepsSet({
      uuid: 's-cut',  exerciseUuid: BENCH_UUID_A,
      weUuid: 'we-cut', workoutUuid: 'wo-cut',
      startTime: '2026-04-15T10:00:00Z',
      weight: 90, reps: 5,
    });
    await seedRepsSet({
      uuid: 's-new',  exerciseUuid: BENCH_UUID_A,
      weUuid: 'we-new', workoutUuid: 'wo-new',
      startTime: '2026-05-01T10:00:00Z',
      weight: 100, reps: 5,
    });

    const result = await excludeSetsForExerciseThroughDate(BENCH_UUID_A, '2026-04-15', true);

    expect(result.newly_changed_count).toBe(2);
    expect(result.workouts_affected_count).toBe(2);
    expect(new Set(result.affected_set_uuids)).toEqual(new Set(['s-old', 's-cut']));

    const persisted = await db.workout_sets.toArray();
    const byUuid = Object.fromEntries(persisted.map(s => [s.uuid, s]));
    expect(byUuid['s-old'].excluded_from_pb).toBe(true);
    expect(byUuid['s-cut'].excluded_from_pb).toBe(true);
    expect(byUuid['s-new'].excluded_from_pb).toBe(false);
  });

  it('walks the canonical exercise group (same everkinetic_id)', async () => {
    await seedBenchPair();
    // One set on each canonical-sibling exercise row, on the same date.
    // A bulk exclude on row A must catch both.
    await seedRepsSet({
      uuid: 's-a', exerciseUuid: BENCH_UUID_A,
      weUuid: 'we-a', workoutUuid: 'wo-a',
      startTime: '2026-04-01T10:00:00Z',
      weight: 80, reps: 5,
    });
    await seedRepsSet({
      uuid: 's-b', exerciseUuid: BENCH_UUID_B,
      weUuid: 'we-b', workoutUuid: 'wo-b',
      startTime: '2026-04-02T10:00:00Z',
      weight: 90, reps: 5,
    });

    const result = await excludeSetsForExerciseThroughDate(BENCH_UUID_A, '2026-04-30', true);

    expect(result.newly_changed_count).toBe(2);
    const persisted = await db.workout_sets.toArray();
    expect(persisted.find(s => s.uuid === 's-a')?.excluded_from_pb).toBe(true);
    expect(persisted.find(s => s.uuid === 's-b')?.excluded_from_pb).toBe(true);
  });

  it('is idempotent — second call reports already_in_target_state', async () => {
    await seedBenchPair();
    await seedRepsSet({
      uuid: 's-1', exerciseUuid: BENCH_UUID_A,
      weUuid: 'we-1', workoutUuid: 'wo-1',
      startTime: '2026-04-01T10:00:00Z',
      weight: 80, reps: 5,
    });

    const first = await excludeSetsForExerciseThroughDate(BENCH_UUID_A, '2026-04-30', true);
    expect(first.newly_changed_count).toBe(1);
    expect(first.already_in_target_state_count).toBe(0);

    const second = await excludeSetsForExerciseThroughDate(BENCH_UUID_A, '2026-04-30', true);
    expect(second.newly_changed_count).toBe(0);
    expect(second.already_in_target_state_count).toBe(1);
  });

  it('restorePbForSets reverses a previous bulk exclude', async () => {
    await seedBenchPair();
    await seedRepsSet({
      uuid: 's-1', exerciseUuid: BENCH_UUID_A,
      weUuid: 'we-1', workoutUuid: 'wo-1',
      startTime: '2026-04-01T10:00:00Z',
      weight: 80, reps: 5,
    });
    const applied = await excludeSetsForExerciseThroughDate(BENCH_UUID_A, '2026-04-30', true);
    expect(applied.affected_set_uuids).toEqual(['s-1']);

    const restoredCount = await restorePbForSets(applied.affected_set_uuids);
    expect(restoredCount).toBe(1);
    const persisted = await db.workout_sets.get('s-1');
    expect(persisted?.excluded_from_pb).toBe(false);
  });
});

// ── Single-set toggle ──────────────────────────────────────────────────────

describe('excludeSetFromPb (single-set)', () => {
  it('flips the column and clears optimistic is_pr', async () => {
    await seedBenchPair();
    await seedRepsSet({
      uuid: 's-1', exerciseUuid: BENCH_UUID_A,
      weUuid: 'we-1', workoutUuid: 'wo-1',
      startTime: '2026-04-01T10:00:00Z',
      weight: 100, reps: 5,
    });
    // Force is_pr=true so we can see the optimistic clear behavior.
    await db.workout_sets.update('s-1', { is_pr: true });

    await excludeSetFromPb('s-1', true);
    const after = await db.workout_sets.get('s-1');
    expect(after?.excluded_from_pb).toBe(true);
    expect(after?.is_pr).toBe(false); // optimistic clear

    // Restore: the flag flips back. is_pr is left alone — server
    // recompute will re-stamp it on the next pull.
    await excludeSetFromPb('s-1', false);
    const restored = await db.workout_sets.get('s-1');
    expect(restored?.excluded_from_pb).toBe(false);
  });
});

// ── Read-site filtering ────────────────────────────────────────────────────

describe('getExerciseProgressLocal filters excluded sets', () => {
  it('returns the post-exclusion top e1RM, not the original best', async () => {
    await seedBenchPair();
    // 100kg×5 (e1RM 116.67) — newer, will be excluded
    // 80kg×5  (e1RM 93.33)  — older, remains a candidate
    await seedRepsSet({
      uuid: 's-old', exerciseUuid: BENCH_UUID_A,
      weUuid: 'we-old', workoutUuid: 'wo-old',
      startTime: '2026-03-01T10:00:00Z',
      weight: 80, reps: 5,
    });
    await seedRepsSet({
      uuid: 's-new', exerciseUuid: BENCH_UUID_A,
      weUuid: 'we-new', workoutUuid: 'wo-new',
      startTime: '2026-04-01T10:00:00Z',
      weight: 100, reps: 5,
    });

    const before = await getExerciseProgressLocal(BENCH_UUID_A);
    expect(before.prs.estimated1RM?.weight).toBe(100);

    await excludeSetFromPb('s-new', true);

    const after = await getExerciseProgressLocal(BENCH_UUID_A);
    expect(after.prs.estimated1RM?.weight).toBe(80);
  });
});

// ── Time-mode parity ───────────────────────────────────────────────────────

describe('time-mode exclusion', () => {
  it('calculateTimePRs filters excluded (caller pre-filters)', () => {
    const r1 = calculateTimePRs([
      { duration_seconds: 60, date: '2026-01-01' },
      { duration_seconds: 120, date: '2026-01-02' }, // would be longest
    ]);
    expect(r1.longestHold?.duration_seconds).toBe(120);

    // Simulate pre-filter: caller excludes the 120s set.
    const r2 = calculateTimePRs([
      { duration_seconds: 60, date: '2026-01-01' },
    ]);
    expect(r2.longestHold?.duration_seconds).toBe(60);
  });

  it('getExerciseTimePRsLocal skips excluded plank holds', async () => {
    await seedPlank();
    await seedTimeSet({
      uuid: 's-short', weUuid: 'we-short', workoutUuid: 'wo-short',
      startTime: '2026-04-01T10:00:00Z', durationSeconds: 60,
    });
    await seedTimeSet({
      uuid: 's-long', weUuid: 'we-long', workoutUuid: 'wo-long',
      startTime: '2026-04-02T10:00:00Z', durationSeconds: 180,
    });

    const before = await getExerciseTimePRsLocal(PLANK_UUID);
    expect(before.longestHold?.duration_seconds).toBe(180);

    await excludeSetFromPb('s-long', true);

    const after = await getExerciseTimePRsLocal(PLANK_UUID);
    expect(after.longestHold?.duration_seconds).toBe(60);
  });
});

// ── Anchor-lift trend respects excluded ────────────────────────────────────

describe('buildAnchorLiftTrend skips excluded sets', () => {
  it('drops the excluded session from the trend (4 sessions → 3)', () => {
    const dates = new Map([
      ['we-1', '2026-04-01'],
      ['we-2', '2026-04-08'],
      ['we-3', '2026-04-15'],
      ['we-4', '2026-04-22'],
    ]);
    const baseSets = [
      { is_completed: true, excluded_from_pb: false, repetitions: 5, weight: 80, workout_exercise_uuid: 'we-1' },
      { is_completed: true, excluded_from_pb: false, repetitions: 5, weight: 90, workout_exercise_uuid: 'we-2' },
      { is_completed: true, excluded_from_pb: false, repetitions: 5, weight: 100, workout_exercise_uuid: 'we-3' },
      { is_completed: true, excluded_from_pb: false, repetitions: 5, weight: 110, workout_exercise_uuid: 'we-4' },
    ];

    const all = buildAnchorLiftTrend(baseSets, dates);
    expect(all.status).toBe('ok');
    if (all.status === 'ok') expect(all.sessions).toHaveLength(4);

    const oneExcluded = buildAnchorLiftTrend(
      [
        baseSets[0],
        { ...baseSets[1], excluded_from_pb: true },  // 04-08 should drop
        baseSets[2],
        baseSets[3],
      ],
      dates,
    );
    expect(oneExcluded.status).toBe('ok');
    if (oneExcluded.status === 'ok') {
      expect(oneExcluded.sessions).toHaveLength(3);
      expect(oneExcluded.sessions.find(s => s.date === '2026-04-08')).toBeUndefined();
    }
  });
});

// ── Volume preserved (gate decision) ────────────────────────────────────────

describe('excluded sets still count toward volume / set counts', () => {
  it('Dexie row remains discoverable for non-PB queries', async () => {
    await seedBenchPair();
    await seedRepsSet({
      uuid: 's-1', exerciseUuid: BENCH_UUID_A,
      weUuid: 'we-1', workoutUuid: 'wo-1',
      startTime: '2026-04-01T10:00:00Z',
      weight: 100, reps: 5,
    });
    await excludeSetFromPb('s-1', true);

    // The row is still there with the same volume contribution.
    // Volume aggregations don't filter excluded_from_pb (per gate decision).
    const allSets = await db.workout_sets
      .filter(s => !s._deleted && s.is_completed)
      .toArray();
    expect(allSets).toHaveLength(1);
    expect(allSets[0].weight).toBe(100);
    expect(allSets[0].repetitions).toBe(5);
    // weight × reps = 500 kg of volume — still credited even though
    // excluded from PB.
    expect((allSets[0].weight ?? 0) * (allSets[0].repetitions ?? 0)).toBe(500);
  });
});
