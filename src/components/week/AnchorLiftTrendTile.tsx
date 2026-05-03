'use client';

import type { AnchorLiftTrendTileData } from '@/lib/api/resolveWeekTiles';
import { TrendSparkline } from './TrendSparkline';

/** Tile 3 — Anchor-Lift e1RM Trend (4–8 weeks per priority muscle). */
export function AnchorLiftTrendTile({ data }: { data: AnchorLiftTrendTileData }) {
  return (
    <section
      className="rounded-2xl bg-card border border-border shadow-sm p-4"
      aria-label="Anchor lift estimated 1RM trend"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-primary">
        Anchor-Lift Trend
      </span>

      <div className="mt-3 space-y-3">
        {data.rows.map(row => {
          // Prefer the resolved exercise's actual title (e.g. "Dumbbell Rear
          // Delt Fly") over the canonical anchor display_name — the title
          // is what Lou recognises from their workouts.
          const titleForRow = row.exercise?.title ?? row.config.display_name;

          if (row.needsData) {
            return (
              <div
                key={row.config.muscle}
                className="flex flex-wrap items-baseline justify-between text-xs gap-x-2 gap-y-0.5"
                aria-label={`${titleForRow} trend: ${row.needsData.reason}`}
              >
                <span className="text-muted-foreground shrink-0">{titleForRow}</span>
                <span className="text-[11px] text-muted-foreground italic text-right break-words min-w-0">
                  {row.needsData.reason}
                </span>
              </div>
            );
          }

          const trend = row.trend!;
          const sparkValues = trend.sessions.map(s => s.e1rm);
          const last = trend.sessions[trend.sessions.length - 1];

          const deltaTone = trend.delta_kg > 0
            ? 'text-emerald-600 dark:text-emerald-400'
            : trend.delta_kg < 0
            ? 'text-red-600 dark:text-red-400'
            : 'text-muted-foreground';

          const arrow = trend.delta_kg > 0 ? '↗' : trend.delta_kg < 0 ? '↘' : '→';

          return (
            <div
              key={row.config.muscle}
              className="flex items-center gap-3"
              aria-label={`${titleForRow} estimated 1RM trend: ${trend.sessions[0].e1rm.toFixed(0)} to ${last.e1rm.toFixed(0)} kg over ${trend.sessions.length} sessions, ${trend.delta_pct > 0 ? '+' : ''}${trend.delta_pct.toFixed(1)} percent`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-xs font-medium text-foreground truncate">
                    {titleForRow}
                  </span>
                  <span className="text-xs tabular-nums text-foreground">
                    {last.e1rm.toFixed(0)}kg
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-1 mt-0.5">
                  <div className="h-5 w-20">
                    <TrendSparkline
                      values={sparkValues}
                      ariaLabel={`${row.config.display_name} sparkline`}
                      minSamples={2}
                    />
                  </div>
                  <span className={`text-[11px] tabular-nums ${deltaTone}`}>
                    {arrow} {trend.delta_kg > 0 ? '+' : ''}{trend.delta_kg.toFixed(1)}kg
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[10px] text-muted-foreground leading-snug">
        Strength holding or growing on HRT = winning.
      </p>
    </section>
  );
}
