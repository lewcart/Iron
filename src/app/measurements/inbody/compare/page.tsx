'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { InbodyScan } from '@/types';
import { apiBase } from '@/lib/api/client';
import { METRICS, GROUP_LABELS, scanValue, formatValue, type MetricGroup } from '@/lib/inbody';

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
  return key
    ? { 'Content-Type': 'application/json', 'X-Api-Key': key }
    : { 'Content-Type': 'application/json' };
}

const GROUPS: MetricGroup[] = ['body_comp', 'derived', 'seg_lean', 'seg_fat', 'circumference', 'recommendation'];

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-safe pb-4 flex items-center gap-3">
        <Link href="/measurements" className="text-primary p-1 -ml-1">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Compare Scans</h1>
      </div>

      <div className="px-4 pb-20 space-y-4">
        {/* Scan pickers */}
        <div className="ios-section">
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

        {(!a || !b) && <p className="text-xs text-muted-foreground px-1">Pick two scans to compare.</p>}

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
                  const dColor = delta == null ? 'text-muted-foreground'
                    : delta === 0 ? 'text-muted-foreground'
                    : (m.preferredDirection === 'higher' && delta > 0) || (m.preferredDirection === 'lower' && delta < 0)
                      ? 'text-emerald-500'
                      : (m.preferredDirection === 'higher' && delta < 0) || (m.preferredDirection === 'lower' && delta > 0)
                        ? 'text-rose-500'
                        : 'text-muted-foreground';
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
    </main>
  );
}
