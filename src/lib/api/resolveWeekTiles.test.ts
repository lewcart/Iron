import { describe, it, expect } from 'vitest';
import { resolveWeekTiles } from './resolveWeekTiles';
import { emptyWeekFacts, type WeekFacts } from './week-facts';
import type { SetsByMuscleRow } from './feed-types';

function muscleRow(slug: string, partial: Partial<SetsByMuscleRow> = {}): SetsByMuscleRow {
  return {
    slug,
    display_name: slug,
    parent_group: 'legs',
    set_count: 0,
    effective_set_count: 0,
    optimal_min: 10,
    optimal_max: 20,
    display_order: 100,
    status: 'zero',
    coverage: 'tagged',
    kg_volume: 0,
    ...partial,
  };
}

function healthyFacts(): WeekFacts {
  const f = emptyWeekFacts(new Date('2026-04-30T12:00:00Z'));
  // 28 days of HRV samples
  for (let i = 0; i < 28; i++) {
    const d = new Date(Date.parse('2026-04-30') - (27 - i) * 86400000).toISOString().slice(0, 10);
    f.recovery.hrv_daily.push({ date: d, value: 50 });
  }
  f.recovery.status = 'connected';
  f.recovery.sleep_avg_min_7d = 420;
  f.recovery.sleep_baseline_min_28d = 420;
  f.recovery.sleep_nights_7d = 7;

  // 14 days of bodyweight
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.parse('2026-04-30') - (13 - i) * 86400000).toISOString().slice(0, 10);
    f.bodyweight.push({ date: d, weight: 70 - i * 0.05 });
  }

  f.setsByMuscle = [
    muscleRow('glutes', { set_count: 8, effective_set_count: 8 }),
    muscleRow('lats', { set_count: 12, effective_set_count: 12 }),
  ];
  f.rirThisWeek = { total_sets: 20, rir_logged_sets: 18, rir_quality_sets: 14 };
  f.sessions_this_week = 4;
  // Past the V1.1 RIR-quality wait gate (≥3 sessions in last 14 days).
  f.sessions_last_14d = 6;

  // Mock anchor lift data — Hip Thrust catalog match + 4 sessions.
  f.catalog = [
    { uuid: 'hipthrust-uuid', title: 'Hip Thrust (Barbell)', alias: [] },
    { uuid: 'pulldown-uuid', title: 'Lat Pulldown', alias: [] },
    { uuid: 'lr-uuid', title: 'Lateral Raise', alias: [] },
    { uuid: 'rd-uuid', title: 'Reverse Flyes', alias: [] },
  ];
  for (const exId of ['hipthrust-uuid', 'pulldown-uuid', 'lr-uuid', 'rd-uuid']) {
    for (let i = 0; i < 4; i++) {
      const d = new Date(Date.parse('2026-04-30') - i * 7 * 86400000).toISOString().slice(0, 10);
      f.anchorSets.push({
        exercise_uuid: exId,
        workout_exercise_uuid: `${exId}-we${i}`,
        is_completed: true,
        weight: 100 + i,
        repetitions: 5,
        rir: 2,
        workout_date: d,
      });
    }
  }
  return f;
}

describe('resolveWeekTiles', () => {
  it('R1: healthy facts → most tiles ok (anchor-trend may be partial due to hip_abduction catalog gap)', () => {
    const tiles = resolveWeekTiles(healthyFacts());
    expect(tiles).toHaveLength(5);
    expect(tiles.find(t => t.id === 'priority-muscles')!.state).toBe('ok');
    expect(tiles.find(t => t.id === 'effective-set-quality')!.state).toBe('ok');
    expect(tiles.find(t => t.id === 'recovery')!.state).toBe('ok');
    expect(tiles.find(t => t.id === 'weight-ewma')!.state).toBe('ok');
    // Anchor lift will be 'partial' because hip_abductors has no catalog match.
    expect(['ok', 'partial']).toContain(tiles.find(t => t.id === 'anchor-lift-trend')!.state);
  });

  it('R2: no working sets → priority-muscles needs-data', () => {
    const f = healthyFacts();
    f.setsByMuscle = [];
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'priority-muscles')!;
    expect(t.state).toBe('needs-data');
    expect(t.message).toMatch(/no working sets/i);
  });

  it('R3: RIR logged on <50% → effective-set-quality needs-data (no CTA — fix is over-time logging)', () => {
    const f = healthyFacts();
    f.rirThisWeek = { total_sets: 20, rir_logged_sets: 5, rir_quality_sets: 4 };
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'effective-set-quality')!;
    expect(t.state).toBe('needs-data');
    expect(t.message).toMatch(/5 of 20/);
    // V1.1 (Lou feedback): below-50% empty state has no CTA — there's nothing
    // to navigate to, the fix is logging RIR going forward.
    expect(t.fixHref).toBeUndefined();
  });

  it('R3b: V1.1 wait gate — <3 sessions in last 14d hides RIR-quality nag with no CTA', () => {
    const f = healthyFacts();
    f.sessions_last_14d = 1;
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'effective-set-quality')!;
    expect(t.state).toBe('needs-data');
    expect(t.message).toMatch(/1 of 3 sessions/);
    expect(t.fixHref).toBeUndefined();
  });

  it('R3c: V1.1 wait gate — exactly 3 sessions unlocks the metric', () => {
    const f = healthyFacts();
    f.sessions_last_14d = 3;
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'effective-set-quality')!;
    expect(t.state).toBe('ok');
  });

  it('R4: anchor lift not seen in 8 weeks → that row reports needs-data', () => {
    const f = healthyFacts();
    // Drop hip thrust sets entirely.
    f.anchorSets = f.anchorSets.filter(s => s.exercise_uuid !== 'hipthrust-uuid');
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'anchor-lift-trend')!;
    if (t.state === 'ok' || t.state === 'partial') {
      const hipRow = t.data.rows.find(r => r.config.muscle === 'glutes')!;
      expect(hipRow.needsData).not.toBeNull();
      expect(hipRow.trend).toBeNull();
    } else {
      throw new Error(`expected ok/partial state, got ${t.state}`);
    }
  });

  it('R5: <21 days of HRV → recovery needs-data', () => {
    const f = healthyFacts();
    f.recovery.hrv_daily = f.recovery.hrv_daily.slice(0, 10);
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'recovery')!;
    expect(t.state).toBe('needs-data');
  });

  it('R6: <7 weight logs in 14 days → weight-ewma needs-data with renamed CTA', () => {
    const f = healthyFacts();
    f.bodyweight = f.bodyweight.slice(0, 5);
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'weight-ewma')!;
    expect(t.state).toBe('needs-data');
    expect(t.message).toMatch(/2 more weigh-ins/);
    // V1.1 (Lou feedback): generic "Fix this" replaced with action verb.
    expect(t.fixLabel).toBe('Log a weigh-in');
    expect(t.fixHref).toBe('/measurements');
  });

  it('R6b: priority-muscles needs-data uses "Start a workout" CTA', () => {
    const f = healthyFacts();
    f.setsByMuscle = [];
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'priority-muscles')!;
    expect(t.state).toBe('needs-data');
    expect(t.fixLabel).toBe('Start a workout');
    expect(t.fixHref).toBe('/workout');
  });

  it('R6c: HRV calibrating empty-state has NO CTA (passive — wait for data)', () => {
    const f = healthyFacts();
    f.recovery.hrv_daily = f.recovery.hrv_daily.slice(0, 10);
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'recovery')!;
    expect(t.state).toBe('needs-data');
    expect(t.fixHref).toBeUndefined();
    expect(t.fixLabel).toBeUndefined();
  });

  it('R7: vision absent → priority-muscles still renders (no priority sort)', () => {
    const f = healthyFacts();
    f.vision = null;
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'priority-muscles')!;
    expect(t.state).toBe('ok');
    if (t.state === 'ok') {
      expect(t.data.rows.length).toBeGreaterThan(0);
      // No row is marked priority.
      expect(t.data.rows.some(r => r.isPriority)).toBe(false);
    }
  });

  it('R7b: vision priorities sort first', () => {
    const f = healthyFacts();
    f.vision = { build_emphasis: ['lats', 'delts'], deemphasize: [] };
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'priority-muscles')!;
    if (t.state === 'ok') {
      const ordered = t.data.rows.map(r => r.slug);
      expect(ordered.indexOf('lats')).toBeLessThan(ordered.indexOf('glutes'));
    }
  });

  it('R7d: delts row uses the actual delts summary row, not a parent fallback (regression for taxonomy collision)', () => {
    const f = healthyFacts();
    f.setsByMuscle = [
      muscleRow('delts', { set_count: 14, effective_set_count: 14 }),
      muscleRow('lats', { set_count: 12, effective_set_count: 12 }),
    ];
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'priority-muscles')!;
    if (t.state === 'ok') {
      const delts = t.data.rows.find(r => r.slug === 'delts')!;
      // delts MEV=8, MAV 16-22 → 14 effective is in-zone (>= MEV)
      expect(delts.effective_set_count).toBe(14);
      expect(delts.zone).toBe('in-zone');
    } else {
      throw new Error(`expected ok state, got ${t.state}`);
    }
  });

  it('R7e: traps row sums mid_traps + lower_traps from canonical taxonomy', () => {
    const f = healthyFacts();
    f.setsByMuscle = [
      muscleRow('mid_traps', { set_count: 4, effective_set_count: 4, kg_volume: 100 }),
      muscleRow('lower_traps', { set_count: 3, effective_set_count: 3, kg_volume: 80 }),
    ];
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'priority-muscles')!;
    if (t.state === 'ok') {
      const traps = t.data.rows.find(r => r.slug === 'traps')!;
      // 4 + 3 = 7, traps MEV=4 → in-zone (>= MEV, < MAV.max=12)
      expect(traps.effective_set_count).toBe(7);
      expect(traps.set_count).toBe(7);
      expect(traps.zone).toBe('in-zone');
    } else {
      throw new Error(`expected ok state, got ${t.state}`);
    }
  });

  it('R7c: vision deemphasize → those muscles flagged isDeemphasis', () => {
    const f = healthyFacts();
    f.vision = { build_emphasis: [], deemphasize: ['quads'] };
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'priority-muscles')!;
    if (t.state === 'ok') {
      const quads = t.data.rows.find(r => r.slug === 'quads')!;
      expect(quads.isDeemphasis).toBe(true);
    }
  });

  it('R8: multiple needs-data tiles flagged independently', () => {
    const f = healthyFacts();
    f.setsByMuscle = [];
    f.bodyweight = [];
    const tiles = resolveWeekTiles(f);
    expect(tiles.find(t => t.id === 'priority-muscles')!.state).toBe('needs-data');
    expect(tiles.find(t => t.id === 'weight-ewma')!.state).toBe('needs-data');
    // others can still be ok.
    expect(tiles).toHaveLength(5);
  });

  it('loading flag → all tiles loading', () => {
    const tiles = resolveWeekTiles(emptyWeekFacts(), { loading: true });
    expect(tiles.every(t => t.state === 'loading')).toBe(true);
  });

  it('not_connected health → recovery needs-data', () => {
    const f = healthyFacts();
    f.recovery.status = 'not_connected';
    f.recovery.hrv_daily = [];
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'recovery')!;
    expect(t.state).toBe('needs-data');
    expect(t.message).toMatch(/Apple Health/i);
  });

  it('client-side zone status uses effective_set_count, NOT set_count', () => {
    const f = healthyFacts();
    // Set raw count high but effective low (RIR drift) — should be "under".
    f.setsByMuscle = [muscleRow('lats', { set_count: 30, effective_set_count: 5, status: 'over' })];
    f.vision = { build_emphasis: ['lats'], deemphasize: [] };
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'priority-muscles')!;
    if (t.state === 'ok') {
      const lats = t.data.rows.find(r => r.slug === 'lats')!;
      // lats MEV=10, so 5 effective is under.
      expect(lats.zone).toBe('under');
    }
  });

  it('twoSignalsDown true when HRV below + sleep < baseline by ≥10min', () => {
    const f = healthyFacts();
    // Push 7-day mean below baseline - SD.
    for (let i = 21; i < 28; i++) f.recovery.hrv_daily[i] = { date: f.recovery.hrv_daily[i].date, value: 30 };
    f.recovery.sleep_avg_min_7d = 380;
    f.recovery.sleep_baseline_min_28d = 420;
    const tiles = resolveWeekTiles(f);
    const t = tiles.find(t => t.id === 'recovery')!;
    if (t.state === 'ok') {
      expect(t.data.twoSignalsDown).toBe(true);
    }
  });
});
