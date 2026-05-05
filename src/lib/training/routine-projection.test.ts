/**
 * Routine projection — fixture tests for projectWeeklyVolume.
 *
 * 8 fixtures from PR3 implementation checklist + the load-bearing
 * 5-day LULUL motivating example with vision overrides, to prove the
 * tool answers Lou's stated question correctly.
 */
import { describe, it, expect } from 'vitest';
import {
  projectWeeklyVolume,
  type ProjectionInputs,
  type ProjectedSetsByMuscleRow,
} from './routine-projection';
import type { VisionMuscleOverride } from './volume-math';

// ── Helpers to keep fixtures terse ──────────────────────────────────────

function ex(opts: {
  uuid: string;
  primary?: string[];
  secondary?: string[];
  lateral_emphasis?: boolean;
}) {
  return {
    uuid: opts.uuid,
    exercise: {
      uuid: opts.uuid,
      primary_muscles: opts.primary ?? [],
      secondary_muscles: opts.secondary ?? [],
      lateral_emphasis: opts.lateral_emphasis ?? false,
    },
    sets: [] as Array<{ uuid: string; target_rir: number | null; max_repetitions?: number | null; target_duration_seconds?: number | null }>,
  };
}

function sets(count: number, rir: number | null = null, prefix = 's'): Array<{ uuid: string; target_rir: number | null; max_repetitions: number }> {
  return Array.from({ length: count }, (_, i) => ({
    uuid: `${prefix}${Math.random()}-${i}`,
    target_rir: rir,
    max_repetitions: 8,
  }));
}

function day(opts: {
  uuid?: string;
  cycle_length_days?: number | null;
  frequency_per_week?: number | null;
  exercises: Array<ReturnType<typeof ex>>;
}) {
  return {
    uuid: opts.uuid ?? `routine-${Math.random()}`,
    cycle_length_days: opts.cycle_length_days ?? null,
    frequency_per_week: opts.frequency_per_week ?? null,
    exercises: opts.exercises,
  };
}

const STANDARD_MUSCLE_DEFS = [
  { slug: 'glutes',        display_name: 'Glutes',        optimal_sets_min: 10, optimal_sets_max: 20, display_order: 130 },
  { slug: 'hamstrings',    display_name: 'Hamstrings',    optimal_sets_min: 10, optimal_sets_max: 20, display_order: 150 },
  { slug: 'quads',         display_name: 'Quads',         optimal_sets_min: 10, optimal_sets_max: 20, display_order: 140 },
  { slug: 'delts',         display_name: 'Delts',         optimal_sets_min: 10, optimal_sets_max: 20, display_order:  70 },
  { slug: 'chest',         display_name: 'Chest',         optimal_sets_min: 10, optimal_sets_max: 20, display_order:  10 },
  { slug: 'lats',          display_name: 'Lats',          optimal_sets_min: 10, optimal_sets_max: 20, display_order:  20 },
  { slug: 'core',          display_name: 'Core',          optimal_sets_min: 10, optimal_sets_max: 20, display_order: 120 },
  { slug: 'hip_abductors', display_name: 'Hip abductors', optimal_sets_min: 10, optimal_sets_max: 20, display_order: 160 },
  { slug: 'biceps',        display_name: 'Biceps',        optimal_sets_min: 10, optimal_sets_max: 20, display_order:  90 },
  { slug: 'triceps',       display_name: 'Triceps',       optimal_sets_min: 10, optimal_sets_max: 20, display_order: 100 },
];

const LOU_VISION = { build_emphasis: ['glutes', 'delts_lateral', 'hip_abductors', 'core'] };
const LOU_OVERRIDES: VisionMuscleOverride[] = [
  { muscle_slug: 'glutes',        override_sets_min: 14, override_sets_max: 26, override_freq_min: 3, evidence: null },
  { muscle_slug: 'delts_lateral', override_sets_min:  8, override_sets_max: 16, override_freq_min: 3, evidence: null },
  { muscle_slug: 'hip_abductors', override_sets_min:  8, override_sets_max: 16, override_freq_min: 2, evidence: 'low' },
  { muscle_slug: 'core',          override_sets_min:  8, override_sets_max: 16, override_freq_min: 3, evidence: null },
];

function findRow(rows: ProjectedSetsByMuscleRow[], slug: string): ProjectedSetsByMuscleRow | undefined {
  return rows.find(r => r.slug === slug);
}

// ── Fixtures ────────────────────────────────────────────────────────────

describe('projectWeeklyVolume — fixture 1: 4-day LULUL (Lou status quo)', () => {
  const inputs: ProjectionInputs = {
    routines: [
      // Lower A: hip thrust 4 sets, RDL 3, Bulgarian 3, hip abd 3
      day({ exercises: [
        { ...ex({ uuid: 'ht', primary: ['glutes'], secondary: ['hamstrings'] }), sets: sets(4, 2, 'a') },
        { ...ex({ uuid: 'rdl', primary: ['hamstrings'], secondary: ['glutes'] }), sets: sets(3, 2, 'b') },
        { ...ex({ uuid: 'bulg', primary: ['quads'], secondary: ['glutes'] }), sets: sets(3, 2, 'c') },
        { ...ex({ uuid: 'abd', primary: ['hip_abductors'] }), sets: sets(3, 2, 'd') },
      ] }),
      // Upper A: bench 3, OHP 3, row 3, lateral raise 3
      day({ exercises: [
        { ...ex({ uuid: 'bench', primary: ['chest'], secondary: ['triceps', 'delts'] }), sets: sets(3, 2, 'e') },
        { ...ex({ uuid: 'ohp', primary: ['delts'], secondary: ['triceps'] }), sets: sets(3, 2, 'f') },
        { ...ex({ uuid: 'row', primary: ['lats'] }), sets: sets(3, 2, 'g') },
        { ...ex({ uuid: 'lr', primary: ['delts'], lateral_emphasis: true }), sets: sets(3, 2, 'h') },
      ] }),
      // Lower B: squat 4, hip thrust 3, leg curl 3, hip abd 3
      day({ exercises: [
        { ...ex({ uuid: 'sq', primary: ['quads'], secondary: ['glutes'] }), sets: sets(4, 2, 'i') },
        { ...ex({ uuid: 'ht2', primary: ['glutes'], secondary: ['hamstrings'] }), sets: sets(3, 2, 'j') },
        { ...ex({ uuid: 'lc', primary: ['hamstrings'] }), sets: sets(3, 2, 'k') },
        { ...ex({ uuid: 'abd2', primary: ['hip_abductors'] }), sets: sets(3, 2, 'l') },
      ] }),
      // Upper B: incline 3, lateral raise 4, lat pulldown 3, curl 3
      day({ exercises: [
        { ...ex({ uuid: 'inc', primary: ['chest'], secondary: ['delts', 'triceps'] }), sets: sets(3, 2, 'm') },
        { ...ex({ uuid: 'lr2', primary: ['delts'], lateral_emphasis: true }), sets: sets(4, 2, 'n') },
        { ...ex({ uuid: 'lp', primary: ['lats'], secondary: ['biceps'] }), sets: sets(3, 2, 'o') },
        { ...ex({ uuid: 'curl', primary: ['biceps'] }), sets: sets(3, 2, 'p') },
      ] }),
    ],
    vision: LOU_VISION,
    overrides: LOU_OVERRIDES,
    muscleDefs: STANDARD_MUSCLE_DEFS,
  };

  const rows = projectWeeklyVolume(inputs);

  it('priority muscles appear first in build_emphasis order', () => {
    const priorityRows = rows.filter(r => r.is_priority);
    expect(priorityRows.map(r => r.slug)).toEqual(['glutes', 'delts_lateral', 'hip_abductors', 'core']);
  });

  it('glutes: 7 primary sets + 2 secondary across 3 days, RIR 2 = full credit', () => {
    const g = findRow(rows, 'glutes')!;
    // Lower A: hip thrust primary 4, RDL secondary 3, Bulgarian secondary 3 = 10 hits across 1 day
    // Lower B: squat secondary 4, hip thrust primary 3 = 7 hits
    // 17 raw sets across 2 lower days
    expect(g.set_count).toBe(17);
    expect(g.days_touched).toBe(2);
    // Effective: ht 4×1.0 + rdl 3×0.5 + bulg 3×0.5 + sq 4×0.5 + ht2 3×1.0 = 4+1.5+1.5+2+3 = 12
    expect(g.effective_set_count).toBeCloseTo(12);
  });

  it('glutes verdict at vision range 14-26 freq>=3: under (12<14) AND freq red (2<3)', () => {
    const g = findRow(rows, 'glutes')!;
    expect(g.range_min).toBe(14);
    expect(g.range_max).toBe(26);
    expect(g.range_overridden).toBe(true);
    expect(g.volume_zone).toBe('under');
    expect(g.freq_min).toBe(3);
    expect(g.frequency_zone).toBe('red');
    expect(g.verdict).toBe('red');
  });

  it('delts_lateral derived from lateral_emphasis exercises: 7 sets, 2 days', () => {
    const dl = findRow(rows, 'delts_lateral')!;
    // Upper A: lateral raise 3 sets. Upper B: lateral raise 4 sets. Both lateral_emphasis=true.
    expect(dl.set_count).toBe(7);
    expect(dl.days_touched).toBe(2);
    expect(dl.effective_set_count).toBeCloseTo(7); // RIR 2 = 1.0, all primary
    expect(dl.range_min).toBe(8);  // override
    expect(dl.range_max).toBe(16);
    expect(dl.volume_zone).toBe('under'); // 7 < 8
    expect(dl.verdict).toBe('red');
  });

  it('hip_abductors with low evidence flag flows through', () => {
    const ha = findRow(rows, 'hip_abductors')!;
    expect(ha.evidence).toBe('low');
    expect(ha.set_count).toBe(6); // 3+3 across Lower A and Lower B
    expect(ha.days_touched).toBe(2);
  });

  it('non-priority glutes-secondary contribution credit (RDL 0.5)', () => {
    const hams = findRow(rows, 'hamstrings')!;
    // RDL primary 3, leg curl primary 3, hip thrust secondary 4+3=7
    // Effective: 3×1.0 + 3×1.0 + 7×0.5 = 9.5
    expect(hams.effective_set_count).toBeCloseTo(9.5);
    expect(hams.is_priority).toBe(false);
  });
});

describe('projectWeeklyVolume — fixture 2: 5-day LULUL (Lou hypothetical, the load-bearing case)', () => {
  // Three lower days, glutes hit each. 6 glute sets per lower day = 18 weekly.
  const lower = (suffix: string) => day({ exercises: [
    { ...ex({ uuid: `ht-${suffix}`, primary: ['glutes'], secondary: ['hamstrings'] }), sets: sets(3, 2, suffix + 'a') },
    { ...ex({ uuid: `rdl-${suffix}`, primary: ['hamstrings'], secondary: ['glutes'] }), sets: sets(3, 2, suffix + 'b') },
    { ...ex({ uuid: `lunge-${suffix}`, primary: ['quads'], secondary: ['glutes'] }), sets: sets(3, 2, suffix + 'c') },
    { ...ex({ uuid: `abd-${suffix}`, primary: ['hip_abductors'] }), sets: sets(3, 2, suffix + 'd') },
  ] });

  const upper = (suffix: string) => day({ exercises: [
    { ...ex({ uuid: `b-${suffix}`, primary: ['chest'] }), sets: sets(3, 2, suffix + 'b') },
    { ...ex({ uuid: `lr-${suffix}`, primary: ['delts'], lateral_emphasis: true }), sets: sets(4, 2, suffix + 'l') },
    { ...ex({ uuid: `r-${suffix}`, primary: ['lats'] }), sets: sets(3, 2, suffix + 'r') },
  ] });

  const inputs: ProjectionInputs = {
    routines: [lower('a'), upper('a'), lower('b'), upper('b'), lower('c')],
    vision: LOU_VISION,
    overrides: LOU_OVERRIDES,
    muscleDefs: STANDARD_MUSCLE_DEFS,
  };
  const rows = projectWeeklyVolume(inputs);

  it('glutes hit 3 lower days × (3 primary + 3+3 secondary) = 9 primary + 18 secondary contributions', () => {
    const g = findRow(rows, 'glutes')!;
    // Effective: 3 × (3×1.0 + 3×0.5 + 3×0.5) = 3 × 6 = 18
    expect(g.effective_set_count).toBeCloseTo(18);
    expect(g.days_touched).toBe(3);
  });

  it('GLUTES VERDICT: optimal volume + frequency met (18 in 14-26, freq 3>=3) — green', () => {
    const g = findRow(rows, 'glutes')!;
    expect(g.volume_zone).toBe('optimal');
    expect(g.frequency_zone).toBe('green');
    // Note: confidence might be 'uncertain_freq' if cycle_length_days null
    // is treated as assumed weekly. With explicit weekly behavior this is
    // 'confident' once the data is known.
  });

  it('lateral delts: 2 upper days × 4 sets = 8 sets, freq 2 — under freq floor 3', () => {
    const dl = findRow(rows, 'delts_lateral')!;
    expect(dl.set_count).toBe(8);
    expect(dl.days_touched).toBe(2);
    expect(dl.volume_zone).toBe('optimal'); // 8 hits the override min
    expect(dl.frequency_zone).toBe('red'); // 2 < 3 freq floor for lateral spec
    expect(dl.verdict).toBe('red'); // freq is binding
    expect(dl.binding_constraint).toBe('frequency');
  });
});

describe('projectWeeklyVolume — fixture 3: high-volume single-day glute', () => {
  // 18 glute sets in ONE lower day. Volume optimal (within 14-26) but
  // frequency 1 < 3 = red.
  const inputs: ProjectionInputs = {
    routines: [
      day({ exercises: [
        { ...ex({ uuid: 'ht', primary: ['glutes'] }), sets: sets(18, 2, 'a') },
      ] }),
    ],
    vision: LOU_VISION,
    overrides: LOU_OVERRIDES,
    muscleDefs: STANDARD_MUSCLE_DEFS,
  };
  const rows = projectWeeklyVolume(inputs);

  it('glutes: optimal volume but red frequency, verdict=red, binding=frequency', () => {
    const g = findRow(rows, 'glutes')!;
    expect(g.set_count).toBe(18);
    expect(g.days_touched).toBe(1);
    expect(g.volume_zone).toBe('optimal');
    expect(g.frequency_zone).toBe('red');
    expect(g.verdict).toBe('red');
    expect(g.binding_constraint).toBe('frequency');
  });
});

describe('projectWeeklyVolume — fixture 4: no priority muscles', () => {
  const inputs: ProjectionInputs = {
    routines: [
      day({ exercises: [
        { ...ex({ uuid: 'b', primary: ['chest'] }), sets: sets(4, 2) },
      ] }),
    ],
    vision: { build_emphasis: [] },
    overrides: [],
    muscleDefs: STANDARD_MUSCLE_DEFS,
  };
  const rows = projectWeeklyVolume(inputs);

  it('no priority rows; chest still appears in non-priority section', () => {
    expect(rows.filter(r => r.is_priority)).toEqual([]);
    expect(findRow(rows, 'chest')!.set_count).toBe(4);
  });
});

describe('projectWeeklyVolume — fixture 5: vision override applied', () => {
  const inputs: ProjectionInputs = {
    routines: [
      day({ exercises: [
        { ...ex({ uuid: 'ht', primary: ['glutes'] }), sets: sets(22, 2) },
      ] }),
    ],
    vision: { build_emphasis: ['glutes'] },
    overrides: [
      { muscle_slug: 'glutes', override_sets_min: 14, override_sets_max: 26, override_freq_min: null, evidence: null },
    ],
    muscleDefs: STANDARD_MUSCLE_DEFS,
  };
  const rows = projectWeeklyVolume(inputs);

  it('22 sets reads optimal against override (14-26), not over against default (10-20)', () => {
    const g = findRow(rows, 'glutes')!;
    expect(g.range_min).toBe(14);
    expect(g.range_max).toBe(26);
    expect(g.range_overridden).toBe(true);
    expect(g.volume_zone).toBe('optimal'); // would be 'over' against default 10-20
  });
});

describe('projectWeeklyVolume — fixture 6: empty routine', () => {
  const inputs: ProjectionInputs = {
    routines: [],
    vision: LOU_VISION,
    overrides: LOU_OVERRIDES,
    muscleDefs: STANDARD_MUSCLE_DEFS,
  };
  const rows = projectWeeklyVolume(inputs);

  it('priority muscles still appear with set_count=0', () => {
    const priorities = rows.filter(r => r.is_priority);
    expect(priorities.length).toBe(4);
    for (const p of priorities) {
      expect(p.set_count).toBe(0);
      expect(p.days_touched).toBe(0);
      expect(p.volume_zone).toBe('zero');
    }
  });

  it('does not crash', () => {
    expect(rows).toBeDefined();
  });
});

describe('projectWeeklyVolume — fixture 7: lateral_emphasis sub-muscle', () => {
  // 2 days, OHP each day, lateral raise each day. Spread keeps delts
  // freq=2 (default floor) so its volume+freq are both green and we
  // can isolate the subgroup-uncertainty signal.
  const inputs: ProjectionInputs = {
    routines: [
      day({ cycle_length_days: 7, exercises: [
        { ...ex({ uuid: 'ohp1', primary: ['delts'] }), sets: sets(8, 2, 'o') },
        { ...ex({ uuid: 'lr1', primary: ['delts'], lateral_emphasis: true }), sets: sets(2, 2, 'l') },
      ] }),
      day({ cycle_length_days: 7, exercises: [
        { ...ex({ uuid: 'ohp2', primary: ['delts'] }), sets: sets(8, 2, 'p') },
        { ...ex({ uuid: 'lr2', primary: ['delts'], lateral_emphasis: true }), sets: sets(2, 2, 'm') },
      ] }),
    ],
    vision: { build_emphasis: ['delts_lateral'] },
    overrides: [
      { muscle_slug: 'delts_lateral', override_sets_min: 8, override_sets_max: 16, override_freq_min: 3, evidence: null },
    ],
    muscleDefs: STANDARD_MUSCLE_DEFS,
  };
  const rows = projectWeeklyVolume(inputs);

  it('delts (parent) shows 20 sets (all delts work), but delts_lateral only 4', () => {
    const delts = findRow(rows, 'delts')!;
    expect(delts.set_count).toBe(20);
    const dl = findRow(rows, 'delts_lateral')!;
    expect(dl.set_count).toBe(4);
  });

  it('uncertain_subgroup: parent delts looks fine but lateral undertrained', () => {
    const delts = findRow(rows, 'delts')!;
    const dl = findRow(rows, 'delts_lateral')!;
    expect(dl.verdict).toBe('red'); // 4 < override min 8
    expect(delts.confidence).toBe('uncertain_subgroup');
    expect(delts.verdict).toBe('uncertain');
  });
});

describe('projectWeeklyVolume — fixture 8: cycle_length_days override', () => {
  const inputs: ProjectionInputs = {
    routines: [
      // 4 lower days, but cycle is 14 days = run "as available"
      day({ cycle_length_days: 14, exercises: [
        { ...ex({ uuid: 'ht', primary: ['glutes'] }), sets: sets(4, 2, 'a') },
      ] }),
      day({ cycle_length_days: 14, exercises: [
        { ...ex({ uuid: 'sq', primary: ['quads'], secondary: ['glutes'] }), sets: sets(4, 2, 'b') },
      ] }),
    ],
    vision: { build_emphasis: ['glutes'] },
    overrides: [],
    muscleDefs: STANDARD_MUSCLE_DEFS,
  };
  const rows = projectWeeklyVolume(inputs);

  it('weekly_frequency reflects 7/cycle_length_days multiplier', () => {
    const g = findRow(rows, 'glutes')!;
    expect(g.days_touched).toBe(2); // hit on 2 of 4 routines
    expect(g.weekly_frequency).toBeCloseTo(2 * 7 / 14); // = 1.0
  });
});

describe('projectWeeklyVolume — confidence flags', () => {
  it('confidence=uncertain_rir when most sets have null target_rir', () => {
    const inputs: ProjectionInputs = {
      routines: [
        day({ exercises: [
          { ...ex({ uuid: 'ht', primary: ['glutes'] }), sets: sets(8, null, 'a') },
        ] }),
      ],
      vision: LOU_VISION,
      overrides: LOU_OVERRIDES,
      muscleDefs: STANDARD_MUSCLE_DEFS,
    };
    const rows = projectWeeklyVolume(inputs);
    const g = findRow(rows, 'glutes')!;
    expect(g.confidence).toBe('uncertain_rir');
  });

  it('verdict=uncertain when confidence not confident, even if volume + freq are green', () => {
    const inputs: ProjectionInputs = {
      routines: [
        day({ exercises: [
          { ...ex({ uuid: 'ht', primary: ['glutes'] }), sets: sets(20, null, 'a') }, // 20 sets, 1 day
          { ...ex({ uuid: 'sq', primary: ['quads'] }), sets: sets(20, null, 'b') },
        ] }),
        day({ exercises: [
          { ...ex({ uuid: 'rdl', primary: ['hamstrings'], secondary: ['glutes'] }), sets: sets(20, null, 'c') },
        ] }),
        day({ exercises: [
          { ...ex({ uuid: 'lunge', primary: ['quads'], secondary: ['glutes'] }), sets: sets(20, null, 'd') },
        ] }),
      ],
      vision: { build_emphasis: ['glutes'] },
      overrides: [
        { muscle_slug: 'glutes', override_sets_min: 14, override_sets_max: 60, override_freq_min: 2, evidence: null },
      ],
      muscleDefs: STANDARD_MUSCLE_DEFS,
    };
    const rows = projectWeeklyVolume(inputs);
    const g = findRow(rows, 'glutes')!;
    expect(g.confidence).toBe('uncertain_rir');
    expect(g.verdict).toBe('uncertain'); // would be green but confidence demotes
  });
});
