'use client';

import { useState } from 'react';
import type { SetsByMuscleRow } from '@/lib/api/feed-types';

/**
 * /feed "Muscles This Week" card.
 *
 * Default view: parent_group rollup (chest, back, shoulders, arms, core, legs).
 * Tap a group to expand its constituent muscles inline. Sets / Volume toggle
 * in the header switches the headline metric. Muscles with no exercises
 * tagged in the catalog at all (coverage='none') sink to a collapsed footer.
 *
 * Status colors:
 *   under   → amber  (clear miss)
 *   optimal → green  (in range)
 *   over    → violet (noted, watch recovery — NOT red, that's reserved for
 *                     Phase 3 junk-set / RIR-derived recovery debt)
 *   zero    → neutral grey
 */

type View = 'sets' | 'volume';
type Status = SetsByMuscleRow['status'];

const PARENT_GROUP_ORDER: Array<{ key: string; label: string }> = [
  { key: 'chest', label: 'Chest' },
  { key: 'back', label: 'Back' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'arms', label: 'Arms' },
  { key: 'core', label: 'Core' },
  { key: 'legs', label: 'Legs' },
];

/** Status priority for rollup display: surface misses first. */
function rollupStatus(children: SetsByMuscleRow[]): Status {
  // Only consider tagged muscles when picking a rollup status.
  const tagged = children.filter(c => c.coverage === 'tagged');
  if (tagged.length === 0) return 'zero';
  if (tagged.some(c => c.status === 'under')) return 'under';
  if (tagged.some(c => c.status === 'over')) return 'over';
  if (tagged.some(c => c.status === 'optimal')) return 'optimal';
  return 'zero';
}

function statusBg(status: Status): string {
  switch (status) {
    case 'under':   return 'bg-amber-100 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800';
    case 'optimal': return 'bg-emerald-100 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800';
    case 'over':    return 'bg-violet-100 dark:bg-violet-950/40 border-violet-300 dark:border-violet-800';
    case 'zero':    return 'bg-muted border-border';
  }
}

function statusBarFill(status: Status): string {
  switch (status) {
    case 'under':   return 'bg-amber-500';
    case 'optimal': return 'bg-emerald-500';
    case 'over':    return 'bg-violet-500';
    case 'zero':    return 'bg-muted-foreground/30';
  }
}

function formatVolume(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}k kg`;
  return `${Math.round(kg)} kg`;
}

/**
 * Junk-set warning fires when meaningful RIR data is present and most sets
 * are too far from failure to drive hypertrophy. Phase 3 weighting:
 *   effective_set_count / set_count < 0.6 AND set_count > 0
 *
 * NOTE: until the user logs RIR on most sets, the SQL fallback (RIR=NULL → 1.0)
 * keeps effective ≈ set_count, so the warning stays silent. As RIR data
 * accumulates, junk sets bring effective down and the badge surfaces.
 */
function isJunkWarning(setCount: number, effectiveSetCount: number): boolean {
  return setCount > 0 && effectiveSetCount / setCount < 0.6;
}

interface MuscleTileProps {
  display_name: string;
  set_count: number;
  effective_set_count: number;
  optimal_min: number;
  optimal_max: number;
  status: Status;
  kg_volume: number;
  view: View;
  expanded?: boolean;
}

function MuscleTile({ display_name, set_count, effective_set_count, optimal_min, optimal_max, status, kg_volume, view, expanded }: MuscleTileProps) {
  // Progress bar: fill = min(set_count / optimal_max, 1.2) capped, tick at min/max ratio.
  const fillRatio = Math.min(set_count / optimal_max, 1.2);
  const effectiveFillRatio = Math.min(effective_set_count / optimal_max, 1.2);
  const tickRatio = optimal_min / optimal_max;
  const headline = view === 'sets' ? String(set_count) : formatVolume(kg_volume);
  const subline = view === 'sets' && set_count > 0 ? `${optimal_min}–${optimal_max} optimal` : '';
  const junk = isJunkWarning(set_count, effective_set_count);

  return (
    <div className={`rounded-lg border p-3 flex flex-col gap-2 transition-colors ${statusBg(status)} ${expanded ? 'ring-1 ring-primary' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground/80 truncate flex items-center gap-1">
          {display_name}
          {view === 'sets' && junk && (
            <span
              className="text-[9px] font-bold px-1 leading-[14px] rounded-full text-rose-700 bg-rose-100 dark:text-rose-200 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800"
              title={`Effective sets ${effective_set_count.toFixed(1)} / ${set_count} — most sets logged too far from failure to drive hypertrophy`}
            >
              JUNK
            </span>
          )}
        </span>
        <span className="text-lg font-semibold tabular-nums text-foreground">{headline}</span>
      </div>
      {view === 'sets' && (
        <div className="relative h-1.5 bg-foreground/10 rounded-full overflow-hidden">
          {/* Raw fill (full width) — slightly muted so the effective fill reads as the headline */}
          <div
            className={`absolute left-0 top-0 h-full rounded-full transition-[width] duration-300 ${statusBarFill(status)} opacity-40`}
            style={{ width: `${Math.min(fillRatio, 1) * 100}%` }}
          />
          {/* Effective fill (overlaid full color). Equal to raw until RIR data exists. */}
          <div
            className={`absolute left-0 top-0 h-full rounded-full transition-[width] duration-300 ${statusBarFill(status)}`}
            style={{ width: `${Math.min(effectiveFillRatio, 1) * 100}%` }}
          />
          {/* tick at optimal_min */}
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground/40"
            style={{ left: `${tickRatio * 100}%` }}
            aria-hidden
          />
        </div>
      )}
      {subline && <span className="text-[10px] text-muted-foreground">{subline}</span>}
    </div>
  );
}

export interface MusclesThisWeekProps {
  setsByMuscle: SetsByMuscleRow[];
}

export function MusclesThisWeek({ setsByMuscle }: MusclesThisWeekProps) {
  const [view, setView] = useState<View>('sets');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // Group by parent_group, filtering out coverage='none' AND zero-set rows
  // (those go to the "Untagged in catalog" footer).
  const taggedRows = setsByMuscle.filter(r => !(r.coverage === 'none' && r.set_count === 0));
  const untaggedRows = setsByMuscle.filter(r => r.coverage === 'none' && r.set_count === 0);

  const byGroup = new Map<string, SetsByMuscleRow[]>();
  for (const row of taggedRows) {
    if (!byGroup.has(row.parent_group)) byGroup.set(row.parent_group, []);
    byGroup.get(row.parent_group)!.push(row);
  }
  // Sort each group's children by display_order.
  for (const arr of byGroup.values()) arr.sort((a, b) => a.display_order - b.display_order);

  const groups = PARENT_GROUP_ORDER.filter(g => byGroup.has(g.key)).map(g => {
    const children = byGroup.get(g.key)!;
    const totalSets = children.reduce((s, c) => s + c.set_count, 0);
    const totalEffective = children.reduce((s, c) => s + c.effective_set_count, 0);
    const totalVolume = children.reduce((s, c) => s + c.kg_volume, 0);
    const sumMin = children.reduce((s, c) => s + c.optimal_min, 0);
    const sumMax = children.reduce((s, c) => s + c.optimal_max, 0);
    return {
      key: g.key,
      label: g.label,
      children,
      totalSets,
      totalEffective,
      totalVolume,
      optimal_min: sumMin,
      optimal_max: sumMax,
      status: rollupStatus(children),
    };
  });

  return (
    <div className="rounded-xl bg-card border border-border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-primary uppercase tracking-wide">Muscles This Week</span>
        <div className="flex rounded-md border border-border bg-muted p-0.5 text-[11px] font-medium">
          <button
            type="button"
            onClick={() => setView('sets')}
            className={`px-2 py-0.5 rounded ${view === 'sets' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}
          >
            Sets
          </button>
          <button
            type="button"
            onClick={() => setView('volume')}
            className={`px-2 py-0.5 rounded ${view === 'volume' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}
          >
            Volume
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {groups.map(g => (
          <button
            type="button"
            key={g.key}
            onClick={() => setExpandedGroup(expandedGroup === g.key ? null : g.key)}
            className="text-left"
            aria-expanded={expandedGroup === g.key}
          >
            <MuscleTile
              display_name={g.label}
              set_count={g.totalSets}
              effective_set_count={g.totalEffective}
              optimal_min={g.optimal_min}
              optimal_max={g.optimal_max}
              status={g.status}
              kg_volume={g.totalVolume}
              view={view}
              expanded={expandedGroup === g.key}
            />
          </button>
        ))}
      </div>

      {expandedGroup && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {byGroup.get(expandedGroup)!.map(child => (
              <MuscleTile
                key={child.slug}
                display_name={child.display_name}
                set_count={child.set_count}
                effective_set_count={child.effective_set_count}
                optimal_min={child.optimal_min}
                optimal_max={child.optimal_max}
                status={child.status}
                kg_volume={child.kg_volume}
                view={view}
              />
            ))}
          </div>
        </div>
      )}

      {untaggedRows.length > 0 && (
        <details className="mt-3 pt-3 border-t border-border">
          <summary className="text-[11px] text-muted-foreground cursor-pointer">
            {untaggedRows.length} untagged in catalog ({untaggedRows.map(u => u.display_name).join(', ')})
          </summary>
          <p className="mt-2 text-[11px] text-muted-foreground">
            These canonical muscles have no exercises tagged in the catalog yet. The audit pass
            (scripts/audit-exercise-muscles.mjs) will tag exercises into them; until then they
            cannot accumulate sets.
          </p>
        </details>
      )}
    </div>
  );
}
