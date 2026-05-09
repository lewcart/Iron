'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info, Loader2, Pencil } from 'lucide-react';
import type { PriorityMuscleRow, PriorityMusclesTileData } from '@/lib/api/resolveWeekTiles';
import type { Frequency, Zone } from '@/lib/training/volume-landmarks';
import { SufficiencyBadge } from './SufficiencyBadge';
import { VolumeContributorsSheet, type VolumeContributor } from '@/components/VolumeContributorsSheet';
import { useLoggedMuscleContributors } from '@/lib/useLocalDB-volume-contributors';

export interface PriorityMusclesTileProps {
  /** Set when state==='ok'. Omitted for loading / needs-data. */
  data?: PriorityMusclesTileData;
  /** Tile state. Defaults to 'ok' so the existing call sites work unchanged.
   *  When 'loading' or 'needs-data' the body shows a spinner / empty message
   *  but the header + week-picker still render — Lou flagged that going back
   *  too far made the picker disappear, trapping the user. */
  state?: 'ok' | 'loading' | 'needs-data';
  /** Empty-state copy when state==='needs-data'. */
  emptyMessage?: string;
  /** Optional CTA href for the empty state. */
  emptyFixHref?: string;
  /** Optional CTA label paired with `emptyFixHref`. */
  emptyFixLabel?: string;
  /** 0 = this week, -1 = last, etc. Used for the picker label + chevron gating. */
  weekOffset?: number;
  /** Selected week's Monday (YYYY-MM-DD, user-local TZ). Optional —
   *  hides the date label when omitted. */
  weekStart?: string;
  /** Selected week's Sunday (YYYY-MM-DD). */
  weekEnd?: string;
  /** Picker callback. Omit to hide the chevrons (e.g. tests). */
  onChangeWeekOffset?: (next: number) => void;
}

/** Tile 1 — Priority Muscles vs MEV/MAV/MRV (the headline tile).
 *
 *  Header / picker chrome renders for every state (ok / loading / needs-data)
 *  so the user is never trapped on a week without navigation. The header used
 *  to carry an inline frequency note + colored swatch legend + an RIR
 *  weighting footnote — those moved into the [i] popover so the tile reads as
 *  data-first. The InfoButton is the single place to learn vocabulary. */
export function PriorityMusclesTile({
  data,
  state = 'ok',
  emptyMessage,
  emptyFixHref,
  emptyFixLabel,
  weekOffset = 0,
  weekStart,
  weekEnd,
  onChangeWeekOffset,
}: PriorityMusclesTileProps) {
  const [expanded, setExpanded] = useState(false);
  const [drilldownSlug, setDrilldownSlug] = useState<string | null>(null);

  // Reset drill-down when the week changes — otherwise the sheet would
  // reopen against the new week's data with a slug from the prior view.
  useEffect(() => {
    setDrilldownSlug(null);
  }, [weekOffset]);

  const showPicker = onChangeWeekOffset != null;
  const canGoForward = weekOffset < 0;
  const weekLabel = formatWeekLabel(weekOffset, weekStart, weekEnd);

  const priority = data?.rows.filter(r => r.isPriority) ?? [];
  const inZoneOrUnder = data?.rows.filter(r => !r.isPriority && !r.isDeemphasis && (r.zone === 'in-zone' || r.zone === 'under')) ?? [];
  const deemphasis = data?.rows.filter(r => r.isDeemphasis) ?? [];
  const overOrRisk = data?.rows.filter(r => !r.isPriority && !r.isDeemphasis && (r.zone === 'over' || r.zone === 'risk')) ?? [];

  const drilldownRow = drilldownSlug != null
    ? data?.rows.find(r => r.slug === drilldownSlug) ?? null
    : null;
  // Compute contributors for the open muscle from logged-set Dexie data.
  const contributors = useLoggedMuscleContributors(
    drilldownRow != null ? weekOffset : null,
    drilldownRow != null ? drilldownSlug : null,
  );

  return (
    <section
      className="rounded-2xl bg-card border border-border shadow-sm p-5"
      aria-label="Priority muscles weekly volume"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">
          Priority Muscles
        </span>
        <div className="flex items-center gap-2">
          <InfoButton frequency={data?.frequencyThisWeek} />
          {/* Tap to edit build/maintain/de-emphasize on the Strategy page —
           *  reuses the existing EditVisionButton sheet rather than
           *  duplicating it inline. */}
          <Link
            href="/strategy"
            aria-label="Edit priority muscles on Strategy page"
            className="inline-flex h-9 w-9 -m-1 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        </div>
      </div>

      {showPicker && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onChangeWeekOffset!(weekOffset - 1)}
            aria-label="View previous week"
            className="inline-flex h-9 w-9 -m-1 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2} />
          </button>
          <span
            className="text-[11px] text-muted-foreground tabular-nums"
            aria-live="polite"
          >
            {weekLabel}
          </span>
          <button
            type="button"
            onClick={() => canGoForward && onChangeWeekOffset!(weekOffset + 1)}
            disabled={!canGoForward}
            aria-label="View next week"
            className="inline-flex h-9 w-9 -m-1 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      )}

      {state === 'loading' && (
        <div
          className="mt-6 flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>Loading {formatWeekLabel(weekOffset, weekStart, weekEnd)}…</span>
        </div>
      )}

      {state === 'needs-data' && (
        <div className="mt-4 py-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {emptyMessage ?? 'No working sets logged for this week.'}
          </p>
          {emptyFixHref && (
            <Link
              href={emptyFixHref}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {emptyFixLabel ?? 'Fix this'}
            </Link>
          )}
        </div>
      )}

      {state === 'ok' && (
        <>
          <div className="mt-3 space-y-2">
            {priority.map(row => (
              <MuscleRow key={row.slug} row={row} priority onTap={() => setDrilldownSlug(row.slug)} />
            ))}
          </div>

          {overOrRisk.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              {overOrRisk.map(row => (
                <MuscleRow key={row.slug} row={row} onTap={() => setDrilldownSlug(row.slug)} />
              ))}
            </div>
          )}

          {deemphasis.length > 0 && (
            <>
              <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                De-emphasis
              </div>
              <div className="mt-2 space-y-2">
                {deemphasis.map(row => (
                  <MuscleRow key={row.slug} row={row} onTap={() => setDrilldownSlug(row.slug)} />
                ))}
              </div>
            </>
          )}

          {inZoneOrUnder.length > 0 && (
            <>
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
                aria-expanded={expanded}
                aria-controls="other-muscles-list"
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                Other muscles ({inZoneOrUnder.length})
              </button>
              {expanded && (
                <div id="other-muscles-list" className="mt-2 space-y-2">
                  {inZoneOrUnder.map(row => (
                    <MuscleRow key={row.slug} row={row} onTap={() => setDrilldownSlug(row.slug)} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {drilldownRow && (
        <VolumeContributorsSheet
          open={drilldownSlug != null}
          onClose={() => setDrilldownSlug(null)}
          muscleDisplayName={drilldownRow.display_name}
          totalSetCount={drilldownRow.set_count ?? Math.round(drilldownRow.effective_set_count)}
          totalEffectiveSetCount={drilldownRow.effective_set_count}
          range={{ min: drilldownRow.landmark.mev, max: drilldownRow.landmark.mavMax }}
          zone={
            drilldownRow.zone === 'risk' ? 'red'
            : drilldownRow.zone === 'over' ? 'yellow'
            : drilldownRow.zone === 'in-zone' ? 'green'
            : drilldownRow.zone === 'under' ? 'red'
            : null
          }
          view="actual"
          contributors={(contributors ?? []).map<VolumeContributor>((c) => ({
            key: c.key,
            exercise_title: c.exercise_title,
            day_label: c.day_label,
            role: c.role,
            secondary_weight: c.secondary_weight,
            set_count: c.set_count,
            effective_set_count: c.effective_set_count,
            weight_source: c.weight_source,
          }))}
        />
      )}
    </section>
  );
}

function LegendSwatch({ className, label, hint }: { className: string; label: string; hint?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2 w-3 rounded-sm ${className}`} aria-hidden />
      <span>{label}</span>
      {hint && <span className="text-muted-foreground/70">— {hint}</span>}
    </span>
  );
}

function MuscleRow({ row, priority = false, onTap }: { row: PriorityMuscleRow; priority?: boolean; onTap?: () => void }) {
  const fill = priority ? 'bg-trans-pink' : row.isDeemphasis ? 'bg-trans-blue' : 'bg-muted-foreground/40';
  const overFill = row.zone === 'over' ? 'bg-amber-500' : row.zone === 'risk' ? 'bg-red-500' : fill;

  // Bar denominator = MRV (right edge).
  const denom = Math.max(row.mrv, row.landmark.mavMax, 1);
  const pct = Math.min((row.effective_set_count / denom) * 100, 100);
  const mevPct = Math.min((row.landmark.mev / denom) * 100, 100);
  const mavMaxPct = Math.min((row.landmark.mavMax / denom) * 100, 100);

  const sourceMark = row.landmark.source === 'extrapolated' ? '*' : '';

  if (row.needsTagging) {
    return (
      <Link
        href="/exercises"
        className="flex items-center gap-2 rounded-lg bg-muted/40 border border-dashed border-border px-2 py-2 hover:bg-muted/60 transition-colors min-h-[44px]"
        aria-label={`${row.display_name}: no exercises tagged — tap to fix`}
      >
        <div className="text-xs text-muted-foreground flex-1">
          {row.display_name}{sourceMark}
        </div>
        <div className="text-[11px] text-amber-600 dark:text-amber-400">
          no exercises tagged
        </div>
      </Link>
    );
  }

  const Wrapper: React.ElementType = onTap ? 'button' : 'div';
  const wrapperProps = onTap
    ? {
        type: 'button' as const,
        onClick: onTap,
        className:
          'text-xs w-full text-left rounded px-1 -mx-1 py-1 -my-1 hover:bg-secondary/40 transition-colors',
        'aria-label': `${row.display_name}: ${row.effective_set_count} effective sets, ${zoneAriaText(row.zone)}, MEV ${row.landmark.mev}, MAV ${row.landmark.mavMin}–${row.landmark.mavMax}, MRV ${row.mrv} — tap to drill down`,
      }
    : {
        className: 'text-xs',
        'aria-label': `${row.display_name}: ${row.effective_set_count} effective sets, ${zoneAriaText(row.zone)}, MEV ${row.landmark.mev}, MAV ${row.landmark.mavMin}–${row.landmark.mavMax}, MRV ${row.mrv}`,
      };

  return (
    <Wrapper {...wrapperProps}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-medium text-foreground">
          {row.display_name}{sourceMark}
        </span>
        <span className="tabular-nums text-muted-foreground inline-flex items-baseline gap-1">
          <span className={zoneTextClass(row.zone)}>{row.effective_set_count.toFixed(1)}</span>
          {' '}
          <span className="text-[10px]">eff sets</span>
          <SufficiencyBadge weeks={row.weeks_with_data} muscleName={row.display_name} />
        </span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
        {/* MEV / MAV reference markers */}
        <div className="absolute inset-y-0" style={{ left: `${mevPct}%`, width: 1 }}>
          <div className="h-full w-px bg-foreground/30" />
        </div>
        <div className="absolute inset-y-0" style={{ left: `${mavMaxPct}%`, width: 1 }}>
          <div className="h-full w-px bg-foreground/30" />
        </div>
        <div
          className={`h-full ${overFill} rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums mt-0.5">
        <span>MEV {row.landmark.mev}</span>
        <span>MAV {row.landmark.mavMin}–{row.landmark.mavMax}</span>
        <span>MRV {row.mrv}</span>
      </div>
      {(row.zone === 'over' || row.zone === 'risk') && (
        <p className={`mt-1 text-[10px] leading-snug ${zoneTextClass(row.zone)}`}>
          {zoneInlineHint(row.zone)}
        </p>
      )}
    </Wrapper>
  );
}

/** Build a terse week-picker label. Prefers human strings (this/last week)
 *  for the recent two; falls back to the ISO Mon–Sun span otherwise. */
export function formatWeekLabel(offset: number, weekStart?: string, weekEnd?: string): string {
  if (offset === 0) return 'this week';
  if (offset === -1) return 'last week';
  if (weekStart && weekEnd) return `${formatShortDate(weekStart)} – ${formatShortDate(weekEnd)}`;
  return `${offset} wk`;
}

/** YYYY-MM-DD → "Apr 20" (no year). Pure date math — no `Date` parse to
 *  avoid timezone shifts on the YYYY-MM-DD anchor. */
function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[m - 1]} ${d}`;
}

function zoneTextClass(zone: Zone): string {
  switch (zone) {
    case 'under':   return 'text-muted-foreground';
    case 'in-zone': return 'text-emerald-600 dark:text-emerald-400 font-semibold';
    case 'over':    return 'text-amber-600 dark:text-amber-400 font-semibold';
    case 'risk':    return 'text-red-600 dark:text-red-400 font-semibold';
  }
}

function zoneAriaText(zone: Zone): string {
  switch (zone) {
    case 'under':   return 'under MEV target';
    case 'in-zone': return 'in productive volume zone';
    case 'over':    return 'above MAV — high recovery cost';
    case 'risk':    return 'at or above MRV — overreaching risk';
  }
}

/** Plain-English line shown beneath the bar when a muscle's volume has
 *  crossed MAV. Volume is a weekly mental model, so the actions are framed
 *  per-week. The deload action is tied to the plan's actual deload trigger
 *  (HRV / e1RM stall) rather than to one week of high volume — those are
 *  separate signals. */
function zoneInlineHint(zone: Zone): string {
  switch (zone) {
    case 'over': return 'Above MAV — recovery cost rising. Trim 2–3 sets across the week (≈1 per session) to settle back inside the band.';
    case 'risk': return 'At or above MRV — recovery debt accumulating. Trim 2–3 sets/wk; if HRV stays low or e1RM stalls 2+ weeks, take a deload week.';
    default: return '';
  }
}

/** Single info popover for the entire tile. Consolidates the volume-landmarks
 *  glossary, the colour legend (was a separate footer), the RIR weighting
 *  footnote, the frequency-bound MRV note, and the sufficiency-badge meaning
 *  that Lou kept forgetting. One tap, one place. */
function InfoButton({ frequency }: { frequency?: Frequency }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Hide priority muscles glossary' : 'Show priority muscles glossary'}
        aria-expanded={open}
        className="inline-flex h-9 w-9 -m-1 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Info className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      {open && (
        <>
          {/* Click-outside scrim */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="dialog"
            aria-label="Priority muscles glossary"
            className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-3 text-xs text-foreground shadow-lg leading-snug space-y-3"
          >
            <section className="space-y-1.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Volume landmarks</h3>
              <p><span className="font-semibold">MEV</span> — Minimum Effective Volume. Sets/week below this don&apos;t grow muscle.</p>
              <p><span className="font-semibold">MAV</span> — Maximum Adaptive Volume. The productive zone where most growth happens.</p>
              <p><span className="font-semibold">MRV</span> — Maximum Recoverable Volume. Above this, fatigue outpaces recovery. Frequency-dependent.</p>
              {frequency != null && (
                <p className="text-muted-foreground italic">
                  MRV shown is bound to your current training frequency ({frequency}× / wk).
                </p>
              )}
            </section>

            <section className="space-y-1.5 pt-2 border-t border-border">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Effective sets &amp; RIR</h3>
              <p><span className="font-semibold">RIR</span> — Reps in Reserve. How many more reps you could&apos;ve done before failure.</p>
              <p><span className="font-semibold">eff sets</span> — RIR-weighted set count: 0–3 = full credit, 4 = half, 5+ = none. Your real hypertrophy stimulus.</p>
            </section>

            <section className="space-y-1.5 pt-2 border-t border-border">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Bar &amp; colour legend</h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground leading-snug">
                <LegendSwatch className="bg-trans-pink" label="priority" />
                <LegendSwatch className="bg-trans-blue" label="de-emphasis" />
                <LegendSwatch className="bg-muted-foreground/40" label="other" />
                <LegendSwatch className="bg-amber-500" label="over MAV" />
                <LegendSwatch className="bg-red-500" label="at MRV" />
              </div>
              <p className="text-muted-foreground">
                Vertical ticks on each bar mark MEV (left) and MAV ceiling (right). The bar fills from 0 to your effective sets; bar&apos;s right edge is MRV.
              </p>
            </section>

            <section className="space-y-1.5 pt-2 border-t border-border">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sufficiency badge</h3>
              <p>
                <span className="font-semibold">[N/8 wks]</span> — N of the last 8 weeks have effective sets logged for this muscle. At 8/8 we&apos;ll have enough history to start personalizing your landmarks; until then RP-2025 defaults are your best guide. Tap the badge for a per-muscle breakdown.
              </p>
            </section>

            <p className="text-muted-foreground pt-2 border-t border-border">
              Source: Renaissance Periodization (RP-2025).
            </p>
          </div>
        </>
      )}
    </span>
  );
}
