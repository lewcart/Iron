/**
 * Pure resolver: WeekFacts → WeekTile[].
 *
 * Each tile carries a state + data + message. The Week page renders tiles
 * by switching on `state` — never reading `data` outside `state === 'ok'`.
 * This keeps tile components dumb and the data-needs flag honest.
 *
 * No React, no fetching here — pure compute, easy to test.
 */

import {
  type VolumeLandmark,
  type Frequency,
  type Zone,
  landmarkFor,
  zoneFor,
} from '../training/volume-landmarks';
import {
  ANCHOR_LIFTS,
  resolveAnchorLift,
  type AnchorLiftConfig,
  type CatalogExercise,
} from '../training/anchor-lifts';
import {
  buildAnchorLiftTrend,
  type AnchorLiftSessionPoint,
} from '../training/anchor-lift-trend';
import { computeEwma, ewmaDeltaOverDays, type EwmaPoint } from '../training/ewma';
import { computeHrvBalance, type HrvBalanceResult } from '../training/hrv-balance';
import type { WeekFacts } from './week-facts';

// ─── Tile state shapes ───────────────────────────────────────────────────────

export type TileState = 'ok' | 'needs-data' | 'partial' | 'loading' | 'error';

export interface BaseTile {
  id: string;
  state: TileState;
  /** Empty-state copy shown when state !== 'ok'. */
  message?: string;
  /** Optional href for the tappable action link in the empty state. */
  fixHref?: string;
  /** Action label rendered next to the link (e.g. "Start a workout").
   *  When `fixHref` is present but `fixLabel` is omitted, the empty-state
   *  defaults to "Fix this" — but tiles SHOULD always supply a verb so the
   *  user knows what tapping it does. */
  fixLabel?: string;
}

// ── Tile 1 — Priority Muscles ──

export interface PriorityMuscleRow {
  slug: string;
  display_name: string;
  /** From summary.setsByMuscle.effective_set_count. */
  effective_set_count: number;
  set_count: number;
  zone: Zone;
  landmark: VolumeLandmark;
  /** Frequency-bound MRV used for the bar's right edge. */
  mrv: number;
  /** True when this muscle is in vision.build_emphasis (priority). */
  isPriority: boolean;
  /** True when this muscle is in vision.deemphasize. */
  isDeemphasis: boolean;
  /** True when no exercise in the catalog tags this muscle (data-needs). */
  needsTagging: boolean;
  /** v1.1: Number of recent weeks (out of last 8) with ≥1 effective set
   *  logged for this muscle. Drives the inline data-sufficiency badge.
   *  null when not computed (callers can omit; badge stays hidden). */
  weeks_with_data?: number | null;
}

export interface PriorityMusclesTileData {
  rows: PriorityMuscleRow[];
  frequencyThisWeek: Frequency;
}

// ── Tile 2 — Effective-Set Quality ──

export interface EffectiveSetQualityTileData {
  /** % of sets at RIR ≤ 3 this week (0..100). */
  quality_pct: number;
  total_sets: number;
  rir_logged_sets: number;
  rir_quality_sets: number;
  /** Last 8 weeks of quality % for sparkline. */
  history: { week_start: string; quality_pct: number; n_sets: number }[];
}

// ── Tile 3 — Anchor-Lift e1RM Trend ──

export interface AnchorLiftTrendRow {
  config: AnchorLiftConfig;
  /** Resolved catalog exercise, or null when no match. */
  exercise: CatalogExercise | null;
  /** When `exercise == null` (catalog gap) or trend is needs-data, set. */
  needsData: { reason: string } | null;
  /** Populated when trend resolved successfully. */
  trend: {
    sessions: AnchorLiftSessionPoint[];
    delta_kg: number;
    delta_pct: number;
  } | null;
}

export interface AnchorLiftTrendTileData {
  rows: AnchorLiftTrendRow[];
}

// ── Tile 4 — Recovery (HRV + sleep) ──

export interface RecoveryTileData {
  hrv: HrvBalanceResult;
  sleep: {
    avg_min: number | null;
    baseline_min: number | null;
    delta_min: number | null;
    nights_window: number;
  };
  /** When BOTH HRV is below band AND sleep avg is below baseline. */
  twoSignalsDown: boolean;
}

// ── Tile 5 — Bodyweight EWMA ──

export interface WeightEwmaTileData {
  series: EwmaPoint[];
  current_ewma: number;
  delta_28d_kg: number | null;
  /** Raw values from the underlying logs (hidden behind tap in the UI). */
  raw: { date: string; weight: number }[];
}

// ─── Discriminated tile union ───
//
// Discriminator is `id` first, `state` second. Each tile-id variant has BOTH
// an `ok`/`partial` shape (with `data`) and a fallback shape (no `data`,
// just `state` ∈ {needs-data, loading, error}). This dual-key encoding is
// what lets `switch (tile.id)` narrow inside an `if (state === 'ok')` block.

type Fallback<Id extends string, OkStates extends TileState> = BaseTile & {
  id: Id;
  state: Exclude<TileState, OkStates>;
  data?: undefined;
};

export type PriorityMusclesTile =
  | (BaseTile & { id: 'priority-muscles'; state: 'ok'; data: PriorityMusclesTileData })
  | Fallback<'priority-muscles', 'ok'>;

export type EffectiveSetQualityTile =
  | (BaseTile & { id: 'effective-set-quality'; state: 'ok'; data: EffectiveSetQualityTileData })
  | Fallback<'effective-set-quality', 'ok'>;

export type AnchorLiftTrendTile =
  | (BaseTile & { id: 'anchor-lift-trend'; state: 'ok' | 'partial'; data: AnchorLiftTrendTileData })
  | Fallback<'anchor-lift-trend', 'ok' | 'partial'>;

export type RecoveryTile =
  | (BaseTile & { id: 'recovery'; state: 'ok'; data: RecoveryTileData })
  | Fallback<'recovery', 'ok'>;

export type WeightEwmaTile =
  | (BaseTile & { id: 'weight-ewma'; state: 'ok'; data: WeightEwmaTileData })
  | Fallback<'weight-ewma', 'ok'>;

export type WeekTile =
  | PriorityMusclesTile
  | EffectiveSetQualityTile
  | AnchorLiftTrendTile
  | RecoveryTile
  | WeightEwmaTile;

// ─── Thresholds (mirrored from plan's data-needs flag table) ───

const RIR_LOGGED_THRESHOLD = 0.5; // tile 2 needs RIR on >= 50% of sets
/** V1.1 wait gate (Lou feedback): don't show the RIR-quality empty-state
 *  until ≥3 sessions have been logged in a rolling 14-day window. Below
 *  that, the tile stays silent — RIR was just added and Lou doesn't want
 *  to be nagged during the bootstrap window. */
const RIR_WAIT_MIN_SESSIONS_14D = 3;
const HRV_MIN_BASELINE_DAYS = 21;
const SLEEP_MIN_NIGHTS_7D = 5;
const WEIGHT_MIN_LOGS_14D = 7;
const WEIGHT_DELTA_WINDOW_DAYS = 28;

// ─── Resolver ───────────────────────────────────────────────────────────────

export interface ResolveOpts {
  /** When true, all tiles are forced to 'loading' (initial fetch in flight). */
  loading?: boolean;
}

export function resolveWeekTiles(facts: WeekFacts, opts: ResolveOpts = {}): WeekTile[] {
  if (opts.loading) {
    const ids: WeekTile['id'][] = [
      'priority-muscles',
      'effective-set-quality',
      'anchor-lift-trend',
      'recovery',
      'weight-ewma',
    ];
    return ids.map(id => ({ id, state: 'loading' } as WeekTile));
  }

  return [
    resolvePriorityMuscles(facts),
    resolveEffectiveSetQuality(facts),
    resolveAnchorLiftTrend(facts),
    resolveRecovery(facts),
    resolveWeightEwma(facts),
  ];
}

// ── Tile 1 ──────────────────────────────────────────────────────────────────

function resolvePriorityMuscles(facts: WeekFacts): WeekTile {
  if (facts.setsByMuscle.length === 0) {
    return {
      id: 'priority-muscles',
      state: 'needs-data',
      message: 'No working sets this week — start a session to see priority volume',
      fixHref: '/workout',
      fixLabel: 'Start a workout',
    };
  }

  const totalSets = facts.setsByMuscle.reduce((s, r) => s + r.set_count, 0);
  if (totalSets === 0) {
    return {
      id: 'priority-muscles',
      state: 'needs-data',
      message: 'No working sets this week — start a session to see priority volume',
      fixHref: '/workout',
      fixLabel: 'Start a workout',
    };
  }

  const frequency = clampFrequency(facts.sessions_this_week || 4);
  const buildEmphasis = new Set(
    (facts.vision?.build_emphasis ?? []).map(s => s.toLowerCase()),
  );
  const deemphasize = new Set(
    (facts.vision?.deemphasize ?? []).map(s => s.toLowerCase()),
  );

  // Build rows from the priority-muscle landmark set, falling back to summary
  // rows for non-landmarked muscles when they're in build_emphasis or
  // deemphasize. The volume-landmarks file uses Week-page slugs (which split
  // delts into side/rear); the canonical setsByMuscle uses 18-slug taxonomy.
  // For V1 we render the 14 landmark rows + show summary muscles only when
  // explicitly in vision lists.

  const rows: PriorityMuscleRow[] = [];

  // Prefer landmark-known muscles first (the 14 we have RP numbers for).
  for (const slug of Object.keys(LANDMARK_KEYS)) {
    const landmark = landmarkFor(slug);
    if (!landmark) continue;
    const summary = lookupSummaryRow(facts.setsByMuscle, slug);
    const effective = summary?.effective_set_count ?? 0;
    const setCount = summary?.set_count ?? 0;
    const mrv = mrvAtFreq(landmark, frequency);
    const zone = zoneFor(effective, frequency, landmark);
    rows.push({
      slug,
      display_name: landmark.display_name,
      effective_set_count: effective,
      set_count: setCount,
      zone,
      landmark,
      mrv,
      isPriority: buildEmphasis.has(slug.toLowerCase()) ||
                  buildEmphasis.has(landmark.display_name.toLowerCase()),
      isDeemphasis: deemphasize.has(slug.toLowerCase()) ||
                    deemphasize.has(landmark.display_name.toLowerCase()),
      needsTagging: summary?.coverage === 'none' ||
                    (slug === 'hip_abductors' && (summary?.set_count ?? 0) === 0),
    });
  }

  // Sort: priorities first (in vision order), then in-zone, then under,
  // then de-emphasis, then over/risk last.
  const visionOrder = (facts.vision?.build_emphasis ?? []).map(s => s.toLowerCase());
  rows.sort((a, b) => {
    if (a.isPriority && !b.isPriority) return -1;
    if (!a.isPriority && b.isPriority) return 1;
    if (a.isPriority && b.isPriority) {
      const ai = visionOrder.indexOf(a.slug.toLowerCase());
      const bi = visionOrder.indexOf(b.slug.toLowerCase());
      if (ai !== -1 && bi !== -1) return ai - bi;
    }
    if (a.isDeemphasis && !b.isDeemphasis) return 1;
    if (!a.isDeemphasis && b.isDeemphasis) return -1;
    // Within the same priority bucket, order by zone severity (under first
    // since those are actionable, then in-zone, then over/risk).
    return zoneOrder(a.zone) - zoneOrder(b.zone);
  });

  return {
    id: 'priority-muscles',
    state: 'ok',
    data: { rows, frequencyThisWeek: frequency },
  };
}

function zoneOrder(z: Zone): number {
  switch (z) {
    case 'under':   return 0;
    case 'in-zone': return 1;
    case 'over':    return 2;
    case 'risk':    return 3;
  }
}

// Lookup table — keys are the priority-muscle slugs from volume-landmarks.ts.
// Each entry MUST resolve to a row in `summary.setsByMuscle` (canonical
// 18-slug taxonomy) via lookupSummaryRow below. `delts` is a 1:1 match;
// `traps` is the only landmark slug that aggregates two canonical rows
// (mid_traps + lower_traps) — see comment in lookupSummaryRow.
const LANDMARK_KEYS: Record<string, true> = {
  glutes: true, lats: true, delts: true, chest: true,
  quads: true, hamstrings: true, hip_abductors: true, calves: true,
  triceps: true, biceps: true, traps: true, forearms: true, core: true,
};

function lookupSummaryRow(
  rows: WeekFacts['setsByMuscle'],
  slug: string,
) {
  // Direct match on canonical slug (most cases — including `delts`).
  const direct = rows.find(r => r.slug === slug);
  if (direct) return direct;
  // The landmark file uses a single `traps` slug; the canonical taxonomy
  // splits this into `mid_traps` + `lower_traps`. Sum both rows so traps
  // volume isn't undercounted by picking only one side.
  if (slug === 'traps') {
    const mid = rows.find(r => r.slug === 'mid_traps');
    const lower = rows.find(r => r.slug === 'lower_traps');
    if (!mid && !lower) return undefined;
    const combinedCoverage: 'none' | 'tagged' =
      mid?.coverage === 'tagged' || lower?.coverage === 'tagged' ? 'tagged' : 'none';
    return {
      slug: 'traps',
      display_name: 'Traps',
      parent_group: mid?.parent_group ?? lower?.parent_group ?? 'back',
      set_count: (mid?.set_count ?? 0) + (lower?.set_count ?? 0),
      effective_set_count:
        (mid?.effective_set_count ?? 0) + (lower?.effective_set_count ?? 0),
      optimal_min: mid?.optimal_min ?? lower?.optimal_min ?? 10,
      optimal_max: mid?.optimal_max ?? lower?.optimal_max ?? 20,
      display_order: mid?.display_order ?? lower?.display_order ?? 999,
      status: mid?.status ?? lower?.status ?? 'zero',
      coverage: combinedCoverage,
      kg_volume: (mid?.kg_volume ?? 0) + (lower?.kg_volume ?? 0),
    };
  }
  return undefined;
}

function clampFrequency(n: number): Frequency {
  if (n <= 2) return 2;
  if (n === 3) return 3;
  if (n === 4) return 4;
  return 5;
}

function mrvAtFreq(landmark: VolumeLandmark, freq: Frequency): number {
  // Re-export of mrvAt() inlined here so this module stays the single
  // resolver-layer abstraction over volume-landmarks.
  const exact = landmark.mrvByFrequency[freq];
  if (exact != null) return exact;
  const tabulated = (Object.entries(landmark.mrvByFrequency) as [string, number][])
    .map(([k, v]) => [Number(k) as Frequency, v] as const)
    .sort((a, b) => Math.abs(a[0] - freq) - Math.abs(b[0] - freq) || b[0] - a[0]);
  return tabulated[0]?.[1] ?? 0;
}

// ── Tile 2 ──────────────────────────────────────────────────────────────────

function resolveEffectiveSetQuality(facts: WeekFacts): WeekTile {
  const { total_sets, rir_logged_sets, rir_quality_sets } = facts.rirThisWeek;

  // V1.1 wait gate (Lou feedback): "we did just add RIR so if there isn't
  // enough data yet thats fine". Below the rolling-window threshold we
  // emit a quiet "waiting" message with NO CTA — there's nothing to
  // navigate to, the fix is logging RIR over time.
  if (facts.sessions_last_14d < RIR_WAIT_MIN_SESSIONS_14D) {
    return {
      id: 'effective-set-quality',
      state: 'needs-data',
      message:
        `Effective-Set Quality will appear once RIR is logged on more sets — `
        + `${facts.sessions_last_14d} of ${RIR_WAIT_MIN_SESSIONS_14D} sessions in the last 14 days.`,
      // No fixHref / fixLabel — the fix is "log RIR going forward", not a place to navigate to.
    };
  }

  if (total_sets === 0) {
    return {
      id: 'effective-set-quality',
      state: 'needs-data',
      message: 'No working sets this week — log RIR on each set to see stimulus quality',
      // No fixHref — same reasoning: the fix is over-time logging behaviour.
    };
  }
  const loggedRatio = rir_logged_sets / total_sets;
  if (loggedRatio < RIR_LOGGED_THRESHOLD) {
    return {
      id: 'effective-set-quality',
      state: 'needs-data',
      message:
        `RIR logged on ${rir_logged_sets} of ${total_sets} sets — `
        + `we just added RIR collection. Give it a couple more sessions.`,
      // Quiet — no CTA. Per Lou: this isn't actionable as a click.
    };
  }

  // % of sets at RIR ≤ 3, computed from logged sets only.
  const quality_pct = rir_logged_sets > 0
    ? Math.round((rir_quality_sets / rir_logged_sets) * 100)
    : 0;

  return {
    id: 'effective-set-quality',
    state: 'ok',
    data: {
      quality_pct,
      total_sets,
      rir_logged_sets,
      rir_quality_sets,
      history: facts.rirByWeek.slice(-8),
    },
  };
}

// ── Tile 3 ──────────────────────────────────────────────────────────────────

function resolveAnchorLiftTrend(facts: WeekFacts): WeekTile {
  const rows: AnchorLiftTrendRow[] = [];

  for (const config of ANCHOR_LIFTS) {
    const exercise = resolveAnchorLift(
      config,
      facts.catalog,
      facts.exerciseLogSignals,
    );
    if (!exercise) {
      rows.push({
        config,
        exercise: null,
        needsData: {
          reason: config.catalogGap
            ? `No "${config.display_name}" exercise tagged in catalog`
            : `no ${config.display_name.toLowerCase()} tagged yet`,
        },
        trend: null,
      });
      continue;
    }

    // Filter sets to just this exercise.
    const exerciseSets = facts.anchorSets.filter(s => s.exercise_uuid === exercise.uuid);
    const dateMap = new Map<string, string>();
    for (const s of exerciseSets) dateMap.set(s.workout_exercise_uuid, s.workout_date);

    const trend = buildAnchorLiftTrend(
      exerciseSets.map(s => ({
        is_completed: s.is_completed,
        excluded_from_pb: s.excluded_from_pb,
        repetitions: s.repetitions,
        weight: s.weight,
        workout_exercise_uuid: s.workout_exercise_uuid,
      })),
      dateMap,
      { anchorDisplayName: config.display_name },
    );

    if (trend.status === 'needs-data') {
      rows.push({
        config,
        exercise,
        needsData: { reason: trend.reason },
        trend: null,
      });
    } else {
      rows.push({
        config,
        exercise,
        needsData: null,
        trend: {
          sessions: trend.sessions,
          delta_kg: trend.delta_kg,
          delta_pct: trend.delta_pct,
        },
      });
    }
  }

  const okRows = rows.filter(r => r.trend != null).length;
  if (okRows === 0) {
    return {
      id: 'anchor-lift-trend',
      state: 'needs-data',
      message: 'Log a few sessions on your anchor lifts to see strength trends',
      fixHref: '/workout',
      fixLabel: 'Start a workout',
    };
  }
  if (okRows < rows.length) {
    return {
      id: 'anchor-lift-trend',
      state: 'partial',
      data: { rows },
    };
  }
  return {
    id: 'anchor-lift-trend',
    state: 'ok',
    data: { rows },
  };
}

// ── Tile 4 ──────────────────────────────────────────────────────────────────

function resolveRecovery(facts: WeekFacts): WeekTile {
  if (facts.recovery.status === 'not_connected') {
    return {
      id: 'recovery',
      state: 'needs-data',
      message: 'Connect Apple Health to see recovery (HRV + sleep)',
      fixHref: '/settings',
      fixLabel: 'Open settings',
    };
  }

  const hrv = computeHrvBalance(facts.recovery.hrv_daily, {
    asOf: facts.today,
    minBaselineDays: HRV_MIN_BASELINE_DAYS,
  });

  if (hrv.status === 'needs-data') {
    // HRV calibration is a "wait, no fix" state. Lou explicitly flagged
    // these CTAs as confusing because there's nothing to navigate to —
    // the fix is more days from Apple Health, which happens passively.
    return {
      id: 'recovery',
      state: 'needs-data',
      message: hrv.reason,
    };
  }

  const sleepNights = facts.recovery.sleep_nights_7d;
  if (sleepNights < SLEEP_MIN_NIGHTS_7D) {
    // We *have* HRV but not enough sleep nights — fall back to HRV-only ok.
    return {
      id: 'recovery',
      state: 'ok',
      data: {
        hrv,
        sleep: {
          avg_min: null,
          baseline_min: null,
          delta_min: null,
          nights_window: sleepNights,
        },
        twoSignalsDown: false,
      },
    };
  }

  const sleepAvg = facts.recovery.sleep_avg_min_7d;
  const sleepBaseline = facts.recovery.sleep_baseline_min_28d;
  const sleepDelta = sleepAvg != null && sleepBaseline != null
    ? Math.round(sleepAvg - sleepBaseline)
    : null;

  // "Two signals down" — HRV below band AND sleep < baseline by ≥10 min.
  const twoSignalsDown = hrv.state === 'below'
    && sleepDelta != null
    && sleepDelta < -10;

  return {
    id: 'recovery',
    state: 'ok',
    data: {
      hrv,
      sleep: {
        avg_min: sleepAvg,
        baseline_min: sleepBaseline,
        delta_min: sleepDelta,
        nights_window: sleepNights,
      },
      twoSignalsDown,
    },
  };
}

// ── Tile 5 ──────────────────────────────────────────────────────────────────

function resolveWeightEwma(facts: WeekFacts): WeekTile {
  const recent14 = facts.bodyweight.filter(p => {
    const ms = Date.parse(p.date);
    if (!Number.isFinite(ms)) return false;
    const todayMs = Date.parse(facts.today);
    if (!Number.isFinite(todayMs)) return true;
    return todayMs - ms <= 14 * 86400000;
  });

  if (recent14.length < WEIGHT_MIN_LOGS_14D) {
    const need = WEIGHT_MIN_LOGS_14D - recent14.length;
    return {
      id: 'weight-ewma',
      state: 'needs-data',
      message: `Need ${need} more weigh-in${need === 1 ? '' : 's'} to show smoothed trend`,
      fixHref: '/measurements',
      fixLabel: 'Log a weigh-in',
    };
  }

  const series = computeEwma(facts.bodyweight);
  const last = series[series.length - 1];
  const delta = ewmaDeltaOverDays(facts.bodyweight, WEIGHT_DELTA_WINDOW_DAYS);

  return {
    id: 'weight-ewma',
    state: 'ok',
    data: {
      series,
      current_ewma: last.ewma,
      delta_28d_kg: delta,
      raw: facts.bodyweight.map(p => ({ date: p.date, weight: p.weight })),
    },
  };
}
