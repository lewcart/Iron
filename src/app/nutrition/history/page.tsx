'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MacroBar } from '@/components/ui/macro-bar';
import { rebirthJsonHeaders } from '@/lib/api/headers';
import { useNutritionTargets } from '@/lib/useLocalDB-nutrition';
import { computeDayAdherence, DEFAULT_BANDS } from '@/lib/adherence';
import { formatDateLabel, todayLocal } from '@/lib/nutrition-time';
import type { HistoryDay } from '@/lib/nutrition-history-types';
import type { MacroBands } from '@/db/local';

const RANGES = ['7d', '30d', '90d', 'all'] as const;
type Range = (typeof RANGES)[number];

export default function NutritionHistoryPage() {
  const [range, setRange] = useState<Range>('30d');
  const [days, setDays] = useState<HistoryDay[]>([]);
  const [loading, setLoading] = useState(true);
  const targets = useNutritionTargets();
  const bands = (targets?.bands ?? DEFAULT_BANDS) as MacroBands;
  const today = todayLocal();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/nutrition/history?range=${range}`, { headers: rebirthJsonHeaders() })
      .then((r) => (r.ok ? r.json() : { days: [] }))
      .then((data: { days: HistoryDay[] }) => {
        if (!cancelled) setDays(data.days ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="tab-content max-w-3xl mx-auto px-4 pt-4 pb-24">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/nutrition" className="text-primary p-1 -ml-1">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-heading">History</h1>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={
                range === r
                  ? 'h-8 px-3 rounded-full bg-foreground text-background text-xs font-semibold'
                  : 'h-8 px-3 rounded-full bg-muted/40 text-xs hover:bg-muted'
              }
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      {loading && <div className="text-sm text-muted-foreground">Loading history…</div>}

      {!loading && days.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-12">
          No history yet — log a meal to start.
        </div>
      )}

      {!loading && days.length > 0 && (
        <ul className="ios-section divide-y divide-border/40">
          {days.map((d) => {
            const hasData = d.log_count > 0;
            const adh = computeDayAdherence(
              { calories: d.calories, protein_g: d.protein_g, carbs_g: d.carbs_g, fat_g: d.fat_g },
              targets ?? null,
              bands,
            );
            const isFuture = d.date > today;
            const status =
              d.approved_status === 'approved'
                ? { label: 'Reviewed', cls: 'text-emerald-500' }
                : isFuture
                  ? { label: '', cls: '' }
                  : !hasData
                    ? { label: 'No data', cls: 'text-muted-foreground' }
                    : { label: 'Logged', cls: 'text-muted-foreground' };

            return (
              <li key={d.date}>
                <Link
                  href={d.date === today ? '/nutrition/today' : `/nutrition/today?date=${d.date}`}
                  className="ios-row py-3 hover:bg-muted/30 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{formatDateLabel(d.date)}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {hasData ? (
                        <>
                          {d.calories != null && `${Math.round(d.calories)} cal · `}
                          {d.protein_g != null && `${Math.round(d.protein_g)}p `}
                          {d.carbs_g != null && `${Math.round(d.carbs_g)}c `}
                          {d.fat_g != null && `${Math.round(d.fat_g)}f`}
                        </>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                    {hasData && targets && (
                      <div className="grid grid-cols-4 gap-1 mt-1.5 max-w-[200px]">
                        <MacroBar
                          value={d.calories ?? 0}
                          goal={targets.calories ?? null}
                          band={bands.cal ?? null}
                          height={3}
                        />
                        <MacroBar
                          value={d.protein_g ?? 0}
                          goal={targets.protein_g ?? null}
                          band={bands.pro ?? null}
                          height={3}
                        />
                        <MacroBar
                          value={d.carbs_g ?? 0}
                          goal={targets.carbs_g ?? null}
                          band={bands.carb ?? null}
                          height={3}
                        />
                        <MacroBar
                          value={d.fat_g ?? 0}
                          goal={targets.fat_g ?? null}
                          band={bands.fat ?? null}
                          height={3}
                        />
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    {status.label && (
                      <div className={`text-[11px] font-medium ${status.cls}`}>{status.label}</div>
                    )}
                    {hasData && adh.target_count > 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        {adh.hit_count}/{adh.target_count} macros
                      </div>
                    )}
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground/50" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
