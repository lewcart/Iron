import { describe, it, expect } from 'vitest';
import {
  ANCHOR_LIFTS,
  resolveAnchorLift,
  exerciseTagsMuscle,
  type CatalogExercise,
  type ExerciseLogSignal,
} from './anchor-lifts';

describe('ANCHOR_LIFTS seed (v1.1 — canonical taxonomy)', () => {
  it('uses canonical muscle slugs only (no legacy side_delts/rear_delts)', () => {
    const muscles = ANCHOR_LIFTS.map(a => a.muscle).sort();
    // delts replaces split rear/side delts; aligns with the canonical
    // muscles taxonomy in src/lib/muscles.ts.
    expect(muscles).toEqual(['delts', 'glutes', 'hip_abductors', 'lats']);
  });

  it('hip_abductors is flagged as catalogGap', () => {
    const hipAb = ANCHOR_LIFTS.find(a => a.muscle === 'hip_abductors')!;
    expect(hipAb.catalogGap).toBe(true);
  });

  it('lats matcher includes both Pulldown variants and Pull Up', () => {
    const lats = ANCHOR_LIFTS.find(a => a.muscle === 'lats')!;
    expect(lats.nameLike).toEqual(expect.arrayContaining(['Lat Pulldown', 'Pulldown', 'Pull Up']));
  });

  it('delts matcher tolerates rear-delt fly + lateral raise + face pull spellings', () => {
    const d = ANCHOR_LIFTS.find(a => a.muscle === 'delts')!;
    expect(d.nameLike).toEqual(expect.arrayContaining(['Lateral Raise', 'Reverse Flyes', 'Reverse Fly']));
    expect(d.nameLike).toEqual(expect.arrayContaining(['Face Pulls', 'Face Pull']));
  });
});

describe('exerciseTagsMuscle', () => {
  it('matches primary muscle tag', () => {
    const ex: CatalogExercise = { uuid: 'a', title: 'x', primary_muscles: ['delts'] };
    expect(exerciseTagsMuscle(ex, 'delts')).toBe(true);
  });

  it('matches secondary muscle tag', () => {
    const ex: CatalogExercise = { uuid: 'a', title: 'x', primary_muscles: ['triceps'], secondary_muscles: ['delts'] };
    expect(exerciseTagsMuscle(ex, 'delts')).toBe(true);
  });

  it('resolves legacy synonyms (e.g. "rear delts" → delts)', () => {
    const ex: CatalogExercise = { uuid: 'a', title: 'x', primary_muscles: ['rear delts'] };
    expect(exerciseTagsMuscle(ex, 'delts')).toBe(true);
  });

  it('returns false when muscle not present', () => {
    const ex: CatalogExercise = { uuid: 'a', title: 'x', primary_muscles: ['quads'] };
    expect(exerciseTagsMuscle(ex, 'delts')).toBe(false);
  });

  it('handles missing muscle arrays gracefully', () => {
    const ex: CatalogExercise = { uuid: 'a', title: 'x' };
    expect(exerciseTagsMuscle(ex, 'delts')).toBe(false);
  });
});

describe('resolveAnchorLift — muscle-tagging-first', () => {
  // Lou's actual catalog reality: many delt exercises tagged but with names
  // that don't substring-match the legacy nameLike[]. The resolver should
  // pick the most-logged one.
  const catalog: CatalogExercise[] = [
    { uuid: 'hipthrust', title: 'Hip Thrust (Barbell)', primary_muscles: ['glutes'], secondary_muscles: ['hamstrings'] },
    { uuid: 'pulldown', title: 'Lat Pulldown — Wide Grip', primary_muscles: ['lats'] },
    { uuid: 'pullup', title: 'Pull Up', alias: ['Chinups'], primary_muscles: ['lats'], secondary_muscles: ['biceps'] },
    { uuid: 'dbrearfly', title: 'Dumbbell Rear Delt Fly', primary_muscles: ['rear delts'] }, // legacy synonym!
    { uuid: 'lateral', title: 'Lateral Raise: Dumbbell', primary_muscles: ['side delts'] }, // legacy synonym!
    { uuid: 'cabletilt', title: 'Cable Hip Adduction', primary_muscles: ['hip_adductors'] }, // OPPOSITE muscle
    { uuid: 'bench', title: 'Bench Press', primary_muscles: ['chest'] },
  ];

  it('picks the most-logged tagged exercise for delts (rear delt fly with most sessions)', () => {
    const cfg = ANCHOR_LIFTS.find(a => a.muscle === 'delts')!;
    const signals: ExerciseLogSignal[] = [
      { exercise_uuid: 'lateral', session_count: 2, set_count: 6, last_workout_date: '2026-04-15' },
      { exercise_uuid: 'dbrearfly', session_count: 5, set_count: 15, last_workout_date: '2026-04-22' },
    ];
    const match = resolveAnchorLift(cfg, catalog, signals);
    // Even though the title doesn't match `nameLike` strongly, the
    // muscle-tag + log-signal path picks Dumbbell Rear Delt Fly.
    expect(match?.uuid).toBe('dbrearfly');
  });

  it('breaks ties by set_count then last_workout_date', () => {
    const cfg = ANCHOR_LIFTS.find(a => a.muscle === 'delts')!;
    const signals: ExerciseLogSignal[] = [
      { exercise_uuid: 'lateral', session_count: 3, set_count: 9, last_workout_date: '2026-04-15' },
      { exercise_uuid: 'dbrearfly', session_count: 3, set_count: 12, last_workout_date: '2026-04-15' },
    ];
    const match = resolveAnchorLift(cfg, catalog, signals);
    expect(match?.uuid).toBe('dbrearfly'); // higher set_count
  });

  it('falls back to nameLike when no tagged exercise has been logged', () => {
    const cfg = ANCHOR_LIFTS.find(a => a.muscle === 'glutes')!;
    // No signals → nameLike substring path takes over.
    const match = resolveAnchorLift(cfg, catalog, []);
    expect(match?.uuid).toBe('hipthrust');
  });

  it('falls back to nameLike when tagged exercises exist but none have signals', () => {
    const cfg = ANCHOR_LIFTS.find(a => a.muscle === 'lats')!;
    // Tagged exercises exist (pulldown, pullup) but no log signals → fallback.
    const match = resolveAnchorLift(cfg, catalog, []);
    // First catalog hit on `Lat Pulldown` substring wins.
    expect(match?.uuid).toBe('pulldown');
  });

  it('returns null when neither tagging nor nameLike matches', () => {
    const cfg = ANCHOR_LIFTS.find(a => a.muscle === 'hip_abductors')!;
    expect(resolveAnchorLift(cfg, catalog, [])).toBeNull();
  });

  it('does NOT return Cable Hip Adduction for hip_abductors (opposite muscle)', () => {
    const cfg = ANCHOR_LIFTS.find(a => a.muscle === 'hip_abductors')!;
    const signals: ExerciseLogSignal[] = [
      { exercise_uuid: 'cabletilt', session_count: 5, set_count: 15, last_workout_date: '2026-04-22' },
    ];
    expect(resolveAnchorLift(cfg, catalog, signals)).toBeNull();
  });

  it('case-insensitive substring match in nameLike fallback', () => {
    const cfg = ANCHOR_LIFTS.find(a => a.muscle === 'delts')!;
    const c: CatalogExercise[] = [
      { uuid: 'x', title: 'CABLE LATERAL RAISE', primary_muscles: [] },
    ];
    expect(resolveAnchorLift(cfg, c, [])?.uuid).toBe('x');
  });

  it('handles catalog with null/undefined alias', () => {
    const cfg = ANCHOR_LIFTS.find(a => a.muscle === 'glutes')!;
    const c: CatalogExercise[] = [{ uuid: 'x', title: 'Hip Thrust' }];
    expect(resolveAnchorLift(cfg, c, [])?.uuid).toBe('x');
  });
});
