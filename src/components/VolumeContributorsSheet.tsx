'use client';

/**
 * Volume contributors drill-down — answers Lou's "is the 25 sets accurate?"
 * forcing question by surfacing per-(exercise, day) breakdown of what fed
 * a muscle's weekly count.
 *
 * Two entry points share this component:
 *   - Routine page Volume Fit row → tap → opens with view='projected'
 *     (sets come from active routine config, RIR-target-driven effective
 *     count, plus per-exercise secondary_weights when audited)
 *   - /feed Muscles This Week tile → tap → opens with view='actual'
 *     (sets come from past 7 days logged data, actual-RIR-driven
 *     effective count, same per-exercise weights)
 *
 * Design rules baked in (from /autoplan gate-locked decisions):
 *   - Single component, two views via `defaultView` prop. No fork.
 *   - Modal sheet on routine page (preserves edit context, matches existing
 *     iOS sheet pattern). Inline expansion on /feed handled by the parent
 *     (MusclesThisWeek wires this component directly when expanded muscle
 *     is non-null).
 *   - Contributor sort: effective_set_count DESC. Surfaces the contributor
 *     that surprised Lou first (e.g. "OHP contributes 0.9 to lateral via
 *     secondary" before the lateral raise rows).
 *   - Spillover detection: NEUTRAL annotation language ("scheduled on
 *     Upper B and Lower A — cross-day spillover"), NOT prescriptive
 *     ("move it"). Per CLAUDE.md "two coaches" guardrail.
 *   - Per-exercise weight badge: shows the secondary multiplier (e.g.
 *     ×0.7) inline on each contributor row, with a `weight_source` badge
 *     ('audited' / 'inferred' / 'default' / 'manual-override') so Lou can
 *     see at a glance which weights are reliable.
 */

import { useMemo } from 'react';
import { Sheet } from '@/components/ui/sheet';

// ─── Types ──────────────────────────────────────────────────────────────

export interface VolumeContributor {
  /** Stable identifier for React keys. */
  key: string;
  /** Exercise display title. */
  exercise_title: string;
  /** Optional per-day label (e.g. "Lower A — Glute & Hip Builder"). When
   *  the same exercise appears on multiple days, render one row per day so
   *  spillover is visible. */
  day_label?: string | null;
  /** How this exercise credits the muscle: 'primary' (1.0) or 'secondary'
   *  (per-(exercise, muscle) weight from secondary_weights, default 0.5). */
  role: 'primary' | 'secondary';
  /** The secondary weight applied (if role==='secondary'). 0.5 = legacy
   *  default fallback. Null when role==='primary'. */
  secondary_weight: number | null;
  /** Distinct sets crediting this muscle from this contributor on this day. */
  set_count: number;
  /** Effective (RIR-weighted × credit-weighted) set contribution. */
  effective_set_count: number;
  /** Provenance for the secondary_weight, if known. */
  weight_source?: 'audited' | 'inferred' | 'default' | 'manual-override' | null;
}

interface VolumeContributorsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Display name like "Glutes" — used in sheet header. */
  muscleDisplayName: string;
  /** Total set_count for this muscle (sum across contributors). Headline. */
  totalSetCount: number;
  /** Total effective_set_count (the RIR + secondary-weighted truth). */
  totalEffectiveSetCount: number;
  /** Optional weekly frequency (×/wk). Renders alongside the headline
   *  count when provided. */
  weeklyFrequency?: number;
  /** Resolved volume range (vision-overridden or default), if known. */
  range?: { min: number; max: number; overridden?: boolean } | null;
  /** Verdict zone for the muscle. Drives the headline color only. */
  zone?: 'green' | 'yellow' | 'red' | 'uncertain' | null;
  /** Source of the data — drives "Projected" vs "Actual" label. */
  view: 'projected' | 'actual';
  /** Pre-computed contributors. Component sorts by effective_set_count DESC. */
  contributors: VolumeContributor[];
}

// ─── Component ──────────────────────────────────────────────────────────

export function VolumeContributorsSheet(props: VolumeContributorsSheetProps) {
  const {
    open, onClose, muscleDisplayName, totalSetCount, totalEffectiveSetCount,
    weeklyFrequency, range, zone, view, contributors,
  } = props;

  // Sort: effective_set_count DESC. Surfaces the surprise contributor first.
  const sorted = useMemo(() => {
    return [...contributors].sort((a, b) => b.effective_set_count - a.effective_set_count);
  }, [contributors]);

  // Spillover detection: same exercise appearing on multiple days. Surfaces
  // the kind of cross-day issue Lou was worried about (Cable Hip Abduction
  // on Upper B AND Lower A). NEUTRAL language only — no "move it" copy.
  const spillovers = useMemo(() => {
    const byTitle = new Map<string, Set<string>>();
    for (const c of contributors) {
      if (!c.day_label) continue;
      let days = byTitle.get(c.exercise_title);
      if (!days) {
        days = new Set();
        byTitle.set(c.exercise_title, days);
      }
      days.add(c.day_label);
    }
    return Array.from(byTitle.entries())
      .filter(([, days]) => days.size > 1)
      .map(([title, days]) => ({ title, days: Array.from(days) }));
  }, [contributors]);

  const headlineZoneClass =
    zone === 'red' ? 'text-rose-400'
    : zone === 'yellow' ? 'text-amber-400'
    : zone === 'green' ? 'text-emerald-400'
    : zone === 'uncertain' ? 'text-neutral-400'
    : 'text-foreground';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={muscleDisplayName}
      height="auto"
      testId={`m-sheet-volume-contributors-${muscleDisplayName.toLowerCase()}`}
    >
      <div className="space-y-4 px-4 pb-4">
        {/* Headline — total + range + verdict */}
        <div>
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-semibold tabular-nums ${headlineZoneClass}`}>
              {Math.round(totalEffectiveSetCount * 10) / 10}
            </span>
            <span className="text-sm text-muted-foreground">
              effective sets {view === 'projected' ? 'projected' : 'this week'}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
            <span>{totalSetCount} raw</span>
            {weeklyFrequency != null && (
              <>
                <span aria-hidden>·</span>
                <span>{weeklyFrequency.toFixed(0)}×/wk</span>
              </>
            )}
            {range && (
              <>
                <span aria-hidden>·</span>
                <span>
                  range {range.min}–{range.max}
                  {range.overridden && (
                    <span className="ml-1 text-primary" title="Vision-adjusted range">★</span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Range bar — same visual language as MusclesThisWeek */}
        {range && (
          <RangeBar
            effectiveSetCount={totalEffectiveSetCount}
            rawSetCount={totalSetCount}
            min={range.min}
            max={range.max}
            zone={zone ?? null}
          />
        )}

        {/* Contributors ledger */}
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Contributors
            <span className="text-[10px] font-normal text-muted-foreground/60 normal-case ml-2">
              sorted by effective sets
            </span>
          </div>
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No exercises credit this muscle {view === 'projected' ? 'in the active routine' : 'in the past 7 days'}.
            </p>
          ) : (
            <div className="space-y-1">
              {sorted.map((c) => (
                <ContributorRow key={c.key} contributor={c} />
              ))}
            </div>
          )}
        </div>

        {/* Neutral spillover annotations */}
        {spillovers.length > 0 && (
          <div className="rounded-md border border-border/60 bg-secondary/40 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
            <div className="font-medium text-foreground/80">Cross-day spillover</div>
            {spillovers.map((s) => (
              <p key={s.title}>
                <span className="text-foreground">{s.title}</span> appears on{' '}
                {s.days.join(' and ')}.
              </p>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function RangeBar({
  effectiveSetCount,
  rawSetCount,
  min,
  max,
  zone,
}: {
  effectiveSetCount: number;
  rawSetCount: number;
  min: number;
  max: number;
  zone: 'green' | 'yellow' | 'red' | 'uncertain' | null;
}) {
  const fillRatio = Math.min(rawSetCount / max, 1.2);
  const effectiveFillRatio = Math.min(effectiveSetCount / max, 1.2);
  const tickRatio = max > 0 ? min / max : 0;

  const fillColor =
    zone === 'red' ? 'bg-rose-500'
    : zone === 'yellow' ? 'bg-amber-500'
    : zone === 'green' ? 'bg-emerald-500'
    : 'bg-muted-foreground/40';

  return (
    <div className="space-y-1">
      <div className="relative h-2 bg-foreground/10 rounded-full overflow-hidden">
        {/* Raw fill — slightly muted */}
        <div
          className={`absolute left-0 top-0 h-full rounded-full ${fillColor} opacity-30`}
          style={{ width: `${Math.min(fillRatio, 1) * 100}%` }}
        />
        {/* Effective fill — full color */}
        <div
          className={`absolute left-0 top-0 h-full rounded-full ${fillColor}`}
          style={{ width: `${Math.min(effectiveFillRatio, 1) * 100}%` }}
        />
        {/* Tick at MEV */}
        <div
          className="absolute top-0 h-full w-0.5 bg-foreground/40"
          style={{ left: `${tickRatio * 100}%` }}
          aria-hidden
        />
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums">
        <span>0</span>
        <span>MEV {min}</span>
        <span>MAV {max}</span>
      </div>
    </div>
  );
}

function ContributorRow({ contributor }: { contributor: VolumeContributor }) {
  const { exercise_title, day_label, role, secondary_weight, set_count, effective_set_count, weight_source } = contributor;

  // Weight badge: show the multiplier inline. Primary always 1.0, secondary
  // shows the per-exercise weight (0.5 default, audited values 0.0-1.0).
  const weightLabel =
    role === 'primary' ? 'primary' : `×${(secondary_weight ?? 0.5).toFixed(1)}`;
  const weightColor =
    role === 'primary' ? 'text-emerald-400/80'
    : (secondary_weight ?? 0.5) >= 0.6 ? 'text-amber-400/80'
    : 'text-muted-foreground';

  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <div className="flex-1 min-w-0">
        <div className="truncate text-foreground">{exercise_title}</div>
        {day_label && (
          <div className="truncate text-[10px] text-muted-foreground">{day_label}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-[10px] font-mono tabular-nums ${weightColor}`}>
          {weightLabel}
        </span>
        {weight_source === 'manual-override' && (
          <span
            className="text-[9px] px-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30"
            title="Weight set via chat — not audited"
          >
            override
          </span>
        )}
        {weight_source === 'inferred' && (
          <span
            className="text-[9px] px-1 rounded bg-neutral-500/10 text-neutral-400 border border-neutral-500/30"
            title="Weight inferred from biomechanics — not from research"
          >
            inferred
          </span>
        )}
        <span className="text-xs tabular-nums text-foreground/80 w-10 text-right">
          {Math.round(effective_set_count * 10) / 10}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground w-6 text-right">
          ({set_count})
        </span>
      </div>
    </div>
  );
}
