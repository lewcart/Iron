'use client';

/**
 * Routine volume fit tile — surfaces the routine projection inside the
 * /plans builder. Shows priority muscles (vision.build_emphasis) first
 * with single-glyph-per-row verdicts (worst-of volume × frequency ×
 * confidence), with diff-as-default rendering when a baseline snapshot
 * exists.
 *
 * Design rules baked in:
 *   - Single verdict glyph per row. Detail line names binding constraint.
 *   - Uncertain state visually distinct from optimal (no green checkmark).
 *   - Vision MAV override surfaced via small "★" indicator + tooltip.
 *   - 8 states covered (loading / empty routine / no vision / single-day /
 *     all-optimal / MEV-undefined / draft-vs-active / sub-muscle drilldown).
 *   - Diff-as-default: at-mount baseline; rows show before → after Δ.
 */

import { useMemo, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/local';
import type { LocalPlanWithRoutines } from '@/lib/useLocalDB-plans';
import { useActiveVision } from '@/lib/useLocalDB-strategy';
import { MUSCLE_DEFS, MUSCLE_SLUGS } from '@/lib/muscles';
import {
  projectWeeklyVolume,
  type ProjectedSetsByMuscleRow,
  type ProjectionInputs,
} from '@/lib/training/routine-projection';

// ─── Types ──────────────────────────────────────────────────────────────

type VerdictGlyph = '✓' | '⚠' | '⌀' | '●';

interface VerdictDisplay {
  glyph: VerdictGlyph;
  /** Tailwind text color for the glyph. */
  color: string;
  /** Aria/screen-reader description. */
  ariaLabel: string;
}

function verdictDisplay(row: ProjectedSetsByMuscleRow): VerdictDisplay {
  if (row.verdict === 'green') return { glyph: '✓', color: 'text-emerald-400', ariaLabel: 'in target range' };
  if (row.verdict === 'yellow') return { glyph: '⚠', color: 'text-amber-400', ariaLabel: 'borderline' };
  if (row.verdict === 'red') return { glyph: '⚠', color: 'text-rose-400', ariaLabel: 'needs attention' };
  return { glyph: '⌀', color: 'text-neutral-400', ariaLabel: 'uncertain' };
}

// ─── Hooks ──────────────────────────────────────────────────────────────

function useVisionOverrides(visionUuid: string | undefined | null) {
  return useLiveQuery(
    async () => {
      if (!visionUuid) return [];
      return db.vision_muscle_overrides
        .where('vision_uuid').equals(visionUuid)
        .filter((o) => !o._deleted)
        .toArray();
    },
    [visionUuid],
    [],
  );
}

// ─── Diff-as-default snapshot ───────────────────────────────────────────

/**
 * Capture the projection ONCE at mount (or when planUuid changes), then
 * compare subsequent recomputes against it. Shows `before → after (Δ)`
 * inline. New plans show absolute (baseline = empty).
 */
function useBaselineRows(
  rows: ProjectedSetsByMuscleRow[] | undefined,
  planUuid: string | undefined,
): Map<string, ProjectedSetsByMuscleRow> {
  const baselineRef = useRef<{ planUuid: string; rows: Map<string, ProjectedSetsByMuscleRow> } | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    if (rows == null || planUuid == null) return;
    // Only set baseline once per plan switch.
    if (baselineRef.current?.planUuid !== planUuid) {
      baselineRef.current = {
        planUuid,
        rows: new Map(rows.map((r) => [r.slug, r])),
      };
      force((n) => n + 1);
    }
  }, [rows, planUuid]);

  return baselineRef.current?.rows ?? new Map();
}

// ─── Components ─────────────────────────────────────────────────────────

interface RoutineVolumeFitProps {
  plan: LocalPlanWithRoutines;
  /** When true, the tile renders an inline header pill noting this plan
   *  is currently active (edits affect this week). */
  isActive: boolean;
}

export function RoutineVolumeFit({ plan, isActive }: RoutineVolumeFitProps) {
  const vision = useActiveVision();
  const overrides = useVisionOverrides(vision?.uuid);

  const projection = useMemo<ProjectedSetsByMuscleRow[] | undefined>(() => {
    if (overrides == null) return undefined;
    if (vision === undefined) return undefined;
    const inputs: ProjectionInputs = {
      routines: plan.routines.map((r) => ({
        uuid: r.uuid,
        cycle_length_days: r.cycle_length_days,
        frequency_per_week: r.frequency_per_week,
        exercises: r.exercises.map((e) => ({
          uuid: e.uuid,
          exercise: e.exercise
            ? {
                uuid: e.exercise.uuid,
                primary_muscles: e.exercise.primary_muscles,
                secondary_muscles: e.exercise.secondary_muscles,
                lateral_emphasis: e.exercise.lateral_emphasis ?? false,
              }
            : undefined,
          sets: e.sets.map((s) => ({
            uuid: s.uuid,
            target_rir: s.target_rir,
            max_repetitions: s.max_repetitions,
            target_duration_seconds: s.target_duration_seconds,
          })),
        })),
      })),
      vision: vision ?? null,
      overrides: overrides.map((o) => ({
        muscle_slug: o.muscle_slug,
        override_sets_min: o.override_sets_min,
        override_sets_max: o.override_sets_max,
        override_freq_min: o.override_freq_min,
        evidence: o.evidence,
      })),
      muscleDefs: MUSCLE_SLUGS.map((slug) => ({
        slug,
        display_name: MUSCLE_DEFS[slug].display_name,
        optimal_sets_min: MUSCLE_DEFS[slug].optimal_sets_min,
        optimal_sets_max: MUSCLE_DEFS[slug].optimal_sets_max,
        display_order: MUSCLE_DEFS[slug].display_order,
      })),
    };
    return projectWeeklyVolume(inputs);
  }, [plan, vision, overrides]);

  const baseline = useBaselineRows(projection, plan.uuid);

  // Loading state — initial render before live queries return
  if (projection === undefined) {
    return (
      <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Weekly projection</span>
        </div>
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-5 rounded bg-secondary animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Empty routine — suppress tile entirely
  const totalExercises = plan.routines.reduce((acc, r) => acc + r.exercises.length, 0);
  if (totalExercises === 0) {
    return (
      <div className="rounded-lg border border-border bg-secondary/30 p-3 text-center text-xs text-muted-foreground">
        Add exercises to see weekly projection
      </div>
    );
  }

  // No vision / empty build_emphasis — render only non-priority section
  const priorityRows = projection.filter((r) => r.is_priority);
  const otherRows = projection.filter((r) => !r.is_priority && r.set_count > 0);
  const hasPriority = priorityRows.length > 0;

  // All priority optimal — celebrate state
  const allPriorityGreen = hasPriority && priorityRows.every((r) => r.verdict === 'green');

  // Single-day footer (frequency-warning context)
  const isSingleDay = plan.routines.length === 1;

  // Confidence rollup count for footer
  const uncertainCount = priorityRows.filter((r) => r.confidence !== 'confident').length;

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Weekly projection
        </span>
        <div className="flex items-center gap-2 text-[10px]">
          {isActive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-primary font-medium">
              Active
            </span>
          )}
          <span className="text-muted-foreground">RIR-adjusted</span>
        </div>
      </div>

      {/* Priority muscles section */}
      {hasPriority && (
        <div className="space-y-1">
          {allPriorityGreen ? (
            <div className="flex items-center gap-2 text-sm text-emerald-400 py-1">
              <span aria-hidden>✓</span>
              <span>All {priorityRows.length} priority muscles in optimal range</span>
            </div>
          ) : (
            priorityRows.map((row) => (
              <ProjectionRow
                key={row.slug}
                row={row}
                baseline={baseline.get(row.slug)}
              />
            ))
          )}
        </div>
      )}

      {/* No-vision state */}
      {!hasPriority && (
        <p className="text-[11px] text-muted-foreground py-1">
          Set vision build emphasis to highlight priority muscles.
        </p>
      )}

      {/* Other muscles (collapsed by default — show count only) */}
      {otherRows.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground py-0.5 list-none flex items-center gap-1">
            <span>›</span>
            <span>{otherRows.length} other muscle{otherRows.length === 1 ? '' : 's'}</span>
          </summary>
          <div className="space-y-1 mt-1.5 pl-2 border-l border-border">
            {otherRows.map((row) => (
              <ProjectionRow key={row.slug} row={row} baseline={baseline.get(row.slug)} />
            ))}
          </div>
        </details>
      )}

      {/* Footer rollups */}
      {(isSingleDay || uncertainCount > 0) && (
        <div className="text-[10px] text-muted-foreground pt-1 border-t border-border space-y-0.5">
          {isSingleDay && (
            <p>1 day/week — most muscles can&apos;t hit their frequency floor with a single day.</p>
          )}
          {uncertainCount > 0 && (
            <p>
              {uncertainCount} muscle{uncertainCount === 1 ? '' : 's'} uncertain — populate RIR
              targets to sharpen.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Row component ──────────────────────────────────────────────────────

function ProjectionRow({
  row,
  baseline,
}: {
  row: ProjectedSetsByMuscleRow;
  baseline: ProjectedSetsByMuscleRow | undefined;
}) {
  const v = verdictDisplay(row);
  const beforeSets = baseline?.effective_set_count ?? 0;
  const afterSets = row.effective_set_count;
  const delta = afterSets - beforeSets;
  const showDelta = baseline != null && Math.abs(delta) >= 0.25;

  // Constraint-binding detail line
  let detail: string | null = null;
  if (row.binding_constraint === 'volume') {
    if (row.volume_zone === 'zero' || row.volume_zone === 'under') {
      const gap = row.range_min - row.effective_set_count;
      detail = `under ${row.range_min}–${row.range_max} (need ${gap.toFixed(1)} more)`;
    } else if (row.volume_zone === 'over') {
      detail = `over ${row.range_max} cap`;
    }
  } else if (row.binding_constraint === 'frequency') {
    detail = `${row.weekly_frequency.toFixed(0)}×/wk — needs ${row.freq_min}+`;
  } else if (row.binding_constraint === 'confidence') {
    if (row.confidence === 'uncertain_rir') detail = 'RIR targets missing';
    else if (row.confidence === 'uncertain_freq') detail = 'cycle frequency unknown';
    else if (row.confidence === 'uncertain_subgroup') detail = 'lateral undertrained';
  }

  return (
    <div className="flex items-center gap-2 py-0.5 text-sm">
      <span className={`shrink-0 ${v.color} font-mono w-3`} aria-label={v.ariaLabel}>
        {v.glyph}
      </span>
      <span className="flex-1 min-w-0 capitalize text-foreground truncate">
        {row.display_name}
      </span>
      <span className="shrink-0 text-muted-foreground tabular-nums text-xs">
        {row.confidence === 'uncertain_rir' && '~'}
        {Math.round(row.effective_set_count * 10) / 10} sets · {row.weekly_frequency.toFixed(0)}×/wk
        {row.range_overridden && (
          <span className="ml-1 text-primary" title="Vision-adjusted range">
            ★
          </span>
        )}
        {showDelta && (
          <span
            className={`ml-1 text-[10px] ${delta > 0 ? 'text-emerald-400' : 'text-amber-400'}`}
          >
            {delta > 0 ? '+' : ''}
            {delta.toFixed(1)}
          </span>
        )}
      </span>
      {detail && (
        <span className="hidden md:inline shrink-0 text-[11px] text-muted-foreground">
          {detail}
        </span>
      )}
    </div>
  );
}
