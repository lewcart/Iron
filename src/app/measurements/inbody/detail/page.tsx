'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Trash2 } from 'lucide-react';
import type { InbodyScan, BodyGoal, BodyNormRange } from '@/types';
import { apiBase } from '@/lib/api/client';
import {
  METRICS, scanValue, statusColorClasses, resolveStatus,
  SHEET_SECTIONS, formatSheetNumber, impedanceRows, IMPEDANCE_SEGMENT_LABELS,
  type ReferenceSet, type MetricDef, type SheetSection,
} from '@/lib/inbody';

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
  return key
    ? { 'Content-Type': 'application/json', 'X-Api-Key': key }
    : { 'Content-Type': 'application/json' };
}

/** METRICS def lookup for status resolution; sheet rows fall back to a synthetic def. */
const METRIC_BY_KEY = new Map(METRICS.map(m => [m.key as string, m]));
function defFor(key: string, label: string, unit: string): MetricDef {
  return METRIC_BY_KEY.get(key) ?? { key, label, unit, group: 'body_comp' };
}

function SheetSectionCard({ section, scan, reference, norms, goals }: {
  section: SheetSection;
  scan: InbodyScan;
  reference: ReferenceSet;
  norms: Record<string, BodyNormRange[]> | null;
  goals: Record<string, BodyGoal> | null;
}) {
  const rows = section.rows
    .map(row => {
      const value = scanValue(scan, row.key);
      const pct = row.pctKey ? scanValue(scan, row.pctKey) : null;
      const status = resolveStatus(value, defFor(row.key, row.label, row.unit), reference, norms, goals);
      return { row, value, pct, status };
    })
    .filter(r => r.value != null);

  if (rows.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">
        {section.title}
      </p>
      <div className="ios-section">
        {rows.map(({ row, value, pct, status }) => {
          const cls = statusColorClasses(status.color);
          const hasRef = status.label !== 'NO REF';
          return (
            <div key={row.key} className="ios-row flex-wrap gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{row.label}</div>
                {hasRef && (
                  <div className="text-xs text-muted-foreground">
                    {reference === 'ME' ? 'Goal' : 'Normal'}: {status.refText}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">
                  {formatSheetNumber(value, row.dp ?? 1, row.signed)}
                  {row.unit ? <span className="font-normal text-muted-foreground"> {row.unit}</span> : null}
                  {pct != null && (
                    <span className="text-muted-foreground font-normal"> · {pct.toFixed(1)}%</span>
                  )}
                </div>
                {hasRef && (
                  <span
                    className={`inline-block mt-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded ring-1 ${cls.text} ${cls.bg} ${cls.ring}`}
                  >
                    {status.label}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ImpedanceBlock({ impedance }: { impedance: InbodyScan['impedance'] }) {
  const rows = impedanceRows(impedance);
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">
        Impedance <span className="normal-case font-normal">Z(Ω)</span>
      </p>
      <div className="ios-section">
        <div className="ios-row">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-medium pb-1" />
                {IMPEDANCE_SEGMENT_LABELS.map(seg => (
                  <th key={seg} className="text-right font-medium pb-1">{seg}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ freq, values }) => (
                <tr key={freq}>
                  <td className="text-left text-muted-foreground py-0.5">{freq}</td>
                  {values.map((v, i) => (
                    <td key={i} className="text-right py-0.5">{v == null ? '—' : v.toFixed(1)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function InbodyScanDetailPage() {
  return (
    <Suspense fallback={<main className="tab-content bg-background" />}>
      <InbodyScanDetailInner />
    </Suspense>
  );
}

function InbodyScanDetailInner() {
  const searchParams = useSearchParams();
  const uuid = searchParams.get('uuid') ?? '';
  const router = useRouter();
  const [scan, setScan] = useState<InbodyScan | null>(null);
  const [loading, setLoading] = useState(true);
  const [reference, setReference] = useState<ReferenceSet>('F'); // default Female per spec
  const [norms, setNorms] = useState<Record<string, BodyNormRange[]> | null>(null);
  const [goals, setGoals] = useState<Record<string, BodyGoal> | null>(null);

  useEffect(() => {
    fetch(`${apiBase()}/api/measurements/inbody/${uuid}`, { headers: apiHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then((s: InbodyScan | null) => { setScan(s); setLoading(false); })
      .catch(() => setLoading(false));
  }, [uuid]);

  useEffect(() => {
    if (reference === 'ME') {
      fetch(`${apiBase()}/api/body-goals`, { headers: apiHeaders() })
        .then(r => r.ok ? r.json() : {})
        .then((g: Record<string, BodyGoal>) => setGoals(g))
        .catch(() => setGoals({}));
    } else {
      fetch(`${apiBase()}/api/body-norm-ranges?sex=${reference}`, { headers: apiHeaders() })
        .then(r => r.ok ? r.json() : {})
        .then((n: Record<string, BodyNormRange[]>) => setNorms(n))
        .catch(() => setNorms({}));
    }
  }, [reference]);

  async function onDelete() {
    if (!confirm('Delete this InBody scan? This also removes any auto-logged circumferences.')) return;
    await fetch(`${apiBase()}/api/measurements/inbody/${uuid}`, { method: 'DELETE', headers: apiHeaders() });
    router.push('/measurements?tab=inbody');
  }

  if (loading) {
    return (
      <main className="tab-content bg-background">
        <div className="max-w-lg md:max-w-6xl mx-auto px-4 md:px-0">
          <div className="px-4 md:px-0 pt-safe pb-4 flex items-center gap-3">
            <Link href="/measurements" className="text-primary p-1 -ml-1">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold">InBody Scan</h1>
          </div>
          {/* Skeleton matching the eventual 2-col metric grid */}
          <div className="px-4 md:px-0 grid grid-cols-1 md:grid-cols-4 gap-6 auto-rows-min">
            <div className="md:col-span-1">
              <div className="rounded-2xl bg-card border border-border p-4 h-32 animate-pulse" aria-hidden />
            </div>
            <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-min">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="rounded-xl bg-card border border-border h-40 animate-pulse" aria-hidden />
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!scan) {
    return (
      <main className="tab-content bg-background">
        <div className="max-w-lg md:max-w-6xl mx-auto">
          <div className="px-4 pt-safe pb-4 flex items-center gap-3">
            <Link href="/measurements" className="text-primary p-1 -ml-1">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold">Not Found</h1>
          </div>
        </div>
      </main>
    );
  }

  const dateStr = new Date(scan.scanned_at).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const balanceBlock = (scan.balance_upper || scan.balance_lower || scan.balance_upper_lower) ? (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Body Balance</p>
      <div className="ios-section">
        {([
          ['Upper', scan.balance_upper],
          ['Lower', scan.balance_lower],
          ['Upper–Lower', scan.balance_upper_lower],
        ] as const).map(([label, val]) => val ? (
          <div key={label} className="ios-row justify-between">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="text-sm font-medium capitalize">{val.replace(/_/g, ' ')}</span>
          </div>
        ) : null)}
      </div>
    </div>
  ) : null;

  const notesBlock = scan.notes ? (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Notes</p>
      <div className="ios-section">
        <div className="ios-row">
          <p className="text-sm whitespace-pre-wrap">{scan.notes}</p>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <main className="tab-content bg-background">
      <div className="max-w-lg md:max-w-6xl mx-auto px-4 md:px-0">
        <div className="pt-safe pb-4 flex items-center gap-3 md:px-4">
          <Link href="/measurements" className="text-primary p-1 -ml-1">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold flex-1">InBody Scan</h1>
          <button
            onClick={onDelete}
            className="text-rose-500 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Delete scan"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="pb-20 grid grid-cols-1 md:grid-cols-4 gap-6 auto-rows-min">
          {/* Left column: sticky summary (scan header + reference toggle + headline metrics)
              NB: sticky lives on the OUTER wrapper — .ios-section has overflow-hidden which would clip it. */}
          <div className="md:col-span-1 md:sticky md:top-4 self-start space-y-4">
            {/* Header card */}
            <div className="rounded-2xl bg-card border border-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">{scan.device}{scan.venue ? ` · ${scan.venue}` : ''}</div>
                  <div className="text-sm font-medium">{dateStr}</div>
                  {(scan.height_cm != null || scan.age_at_scan != null) && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {[
                        scan.height_cm != null ? `${scan.height_cm} cm` : null,
                        scan.age_at_scan != null ? `${scan.age_at_scan} yrs` : null,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                {scan.inbody_score != null && (
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Score</div>
                    <div className="text-2xl font-bold">{scan.inbody_score}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Reference selector */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Compare against</p>
              <div className="flex rounded-xl bg-card border border-border p-1 gap-1">
                {(['M', 'F', 'ME'] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => setReference(r)}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                      reference === r
                        ? 'bg-primary text-white'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {r === 'M' ? 'Male' : r === 'F' ? 'Female' : 'Me'}
                  </button>
                ))}
              </div>
            </div>

            {/* Headline metrics at a glance */}
            <div className="ios-section">
              {[
                { label: 'Weight', val: scan.weight_kg, unit: 'kg' },
                { label: 'PBF', val: scan.pbf_pct, unit: '%' },
                { label: 'SMM', val: scan.smm_kg, unit: 'kg' },
              ].filter(h => h.val != null).map(h => (
                <div key={h.label} className="ios-row justify-between">
                  <span className="text-sm text-muted-foreground">{h.label}</span>
                  <span className="text-sm font-semibold">{h.val} {h.unit}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right area: two column stacks mirroring the printed InBody 570 sheet —
              left = analysis tables (top-to-bottom in printout order, segmental rows
              show kg · % combined), right = Weight Control / Balance / Circumference /
              Research Parameters / Impedance. Single column on mobile keeps the same
              top-to-bottom read order as the sheet's left page then right page. */}
          <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-min items-start">
            <div className="space-y-4">
              {SHEET_SECTIONS.filter(s => s.column === 'left').map(section => (
                <SheetSectionCard
                  key={section.id}
                  section={section}
                  scan={scan}
                  reference={reference}
                  norms={norms}
                  goals={goals}
                />
              ))}
            </div>

            <div className="space-y-4">
              {SHEET_SECTIONS.filter(s => s.column === 'right').map(section => (
                <SheetSectionCard
                  key={section.id}
                  section={section}
                  scan={scan}
                  reference={reference}
                  norms={norms}
                  goals={goals}
                />
              ))}
              {balanceBlock}
              <ImpedanceBlock impedance={scan.impedance} />
              {notesBlock}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
