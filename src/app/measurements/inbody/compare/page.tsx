'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { InbodyScan } from '@/types';
import { apiBase } from '@/lib/api/client';
import { METRICS, GROUP_LABELS, scanValue, formatValue, type MetricGroup, type MetricDef } from '@/lib/inbody';

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
  return key
    ? { 'Content-Type': 'application/json', 'X-Api-Key': key }
    : { 'Content-Type': 'application/json' };
}

const GROUPS: MetricGroup[] = ['body_comp', 'derived', 'seg_lean', 'seg_fat', 'circumference', 'recommendation'];

// Metrics summarised in the md:+ center Δ column
const DELTA_METRIC_KEYS: ReadonlyArray<string> = ['weight_kg', 'pbf_pct', 'smm_kg', 'bmr_kcal'];

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function deltaColorClass(m: MetricDef, delta: number | null): string {
  if (delta == null || delta === 0) return 'text-muted-foreground';
  if ((m.preferredDirection === 'higher' && delta > 0) || (m.preferredDirection === 'lower' && delta < 0)) {
    return 'text-emerald-500';
  }
  if ((m.preferredDirection === 'higher' && delta < 0) || (m.preferredDirection === 'lower' && delta > 0)) {
    return 'text-rose-500';
  }
  return 'text-muted-foreground';
}

export default function CompareInbodyScansPage() {
  const [scans, setScans] = useState<InbodyScan[]>([]);
  const [aUuid, setAUuid] = useState<string>('');
  const [bUuid, setBUuid] = useState<string>('');

  useEffect(() => {
    fetch(`${apiBase()}/api/measurements/inbody?limit=90`, { headers: apiHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then((s: InbodyScan[]) => {
        if (Array.isArray(s)) {
          setScans(s);
          // Default: compare most recent against the one before it.
          if (s.length >= 2) {
            setAUuid(s[1].uuid);
            setBUuid(s[0].uuid);
          } else if (s.length === 1) {
            setAUuid(s[0].uuid);
            setBUuid(s[0].uuid);
          }
        }
      })
      .catch(() => {});
  }, []);

  const a = useMemo(() => scans.find(s => s.uuid === aUuid) ?? null, [scans, aUuid]);
  const b = useMemo(() => scans.find(s => s.uuid === bUuid) ?? null, [scans, bUuid]);

  // Headline deltas for the md:+ center Δ column
  const headlineDeltas = (a && b) ? DELTA_METRIC_KEYS.map(k => {
    const metric = METRICS.find(m => m.key === k);
    if (!metric) return null;
    const av = scanValue(a, k);
    const bv = scanValue(b, k);
    const delta = av != null && bv != null ? bv - av : null;
    const pct = av != null && bv != null && av !== 0 ? (delta! / Math.abs(av)) * 100 : null;
    return { metric, av, bv, delta, pct };
  }).filter(Boolean) as Array<{ metric: MetricDef; av: number | null; bv: number | null; delta: number | null; pct: number | null }> : [];

  return (
    <main className="tab-content bg-background">
      <div className="max-w-lg md:max-w-6xl mx-auto">
        <div className="px-4 pt-safe pb-4 flex items-center gap-3">
          <Link href="/measurements" className="text-primary p-1 -ml-1">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold">Compare Scans</h1>
        </div>

        <div className="px-4 pb-20 space-y-4">
          {/* Scan pickers — on md:+ lay out as A | Δ | B row */}
          <div className="md:flex md:items-stretch md:gap-4">
            <div className="ios-section md:basis-5/12">
              <div className="ios-row justify-between gap-3">
                <span className="text-sm text-muted-foreground">A</span>
                <select
                  value={aUuid}
                  onChange={e => setAUuid(e.target.value)}
                  className="bg-transparent text-sm text-right outline-none min-h-[44px] flex-1"
                >
                  {scans.map(s => (
                    <option key={s.uuid} value={s.uuid}>{shortDate(s.scanned_at)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Δ column summary (md:+ only) — headline metric deltas */}
            <div className="hidden md:block md:basis-2/12">
              {a && b && headlineDeltas.length > 0 ? (
                <div className="ios-section h-full">
                  <div className="ios-row justify-center">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Δ</span>
                  </div>
                  {headlineDeltas.map(({ metric, delta, pct }) => (
                    <div key={metric.key as string} className="ios-row flex-col items-center gap-0 py-2">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{metric.label}</span>
                      <span className={`text-sm font-semibold ${deltaColorClass(metric, delta)}`}>
                        {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(metric.dp ?? 1)}`}
                      </span>
                      {pct != null && (
                        <span className="text-[10px] text-muted-foreground">
                          {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full" aria-hidden />
              )}
            </div>

            <div className="ios-section md:basis-5/12">
              <div className="ios-row justify-between gap-3">
                <span className="text-sm text-muted-foreground">B</span>
                <select
                  value={bUuid}
                  onChange={e => setBUuid(e.target.value)}
                  className="bg-transparent text-sm text-right outline-none min-h-[44px] flex-1"
                >
                  {scans.map(s => (
                    <option key={s.uuid} value={s.uuid}>{shortDate(s.scanned_at)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {(!a || !b) && (
            <div className="md:max-w-2xl mx-auto">
              <div className="ios-section">
                <div className="ios-row flex-col items-start gap-2 py-5">
                  <span className="text-sm font-semibold">Pick two scans to compare</span>
                  <span className="text-xs text-muted-foreground">
                    Use the dropdowns above to choose two InBody scans — we&apos;ll surface the delta across every tracked metric.
                  </span>
                </div>
              </div>
            </div>
          )}

          {a && b && GROUPS.map(group => {
            const metrics = METRICS.filter(m => m.group === group);
            const rows = metrics.map(m => {
              const av = scanValue(a, m.key as string);
              const bv = scanValue(b, m.key as string);
              if (av == null && bv == null) return null;
              const delta = av != null && bv != null ? bv - av : null;
              const pct = av != null && bv != null && av !== 0 ? (delta! / Math.abs(av)) * 100 : null;
              return { m, av, bv, delta, pct };
            }).filter(Boolean) as Array<{ m: (typeof METRICS)[number]; av: number | null; bv: number | null; delta: number | null; pct: number | null }>;

            if (rows.length === 0) return null;

            return (
              <div key={group}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">{GROUP_LABELS[group]}</p>
                <div className="ios-section">
                  <div className="ios-row text-xs text-muted-foreground font-medium">
                    <span className="flex-1">Metric</span>
                    <span className="w-20 text-right">A</span>
                    <span className="w-20 text-right">B</span>
                    <span className="w-20 text-right">Δ</span>
                  </div>
                  {rows.map(({ m, av, bv, delta, pct }) => {
                    const dColor = deltaColorClass(m, delta);
                    return (
                      <div key={m.key as string} className="ios-row">
                        <span className="text-sm flex-1 truncate">{m.label}</span>
                        <span className="w-20 text-right text-sm">{formatValue(av, m)}</span>
                        <span className="w-20 text-right text-sm">{formatValue(bv, m)}</span>
                        <span className={`w-20 text-right text-sm font-medium ${dColor}`}>
                          {delta == null ? '—' : (
                            <>
                              {delta > 0 ? '+' : ''}{delta.toFixed(m.dp ?? 1)}
                              {pct != null && <span className="block text-[10px] font-normal">{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</span>}
                            </>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
