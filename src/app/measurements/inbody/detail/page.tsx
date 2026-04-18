'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Trash2 } from 'lucide-react';
import type { InbodyScan, BodyGoal, BodyNormRange } from '@/types';
import { apiBase } from '@/lib/api/client';
import {
  METRICS, GROUP_LABELS, scanValue, formatValue, statusColorClasses,
  resolveStatus, type ReferenceSet, type MetricGroup,
} from '@/lib/inbody';

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
  return key
    ? { 'Content-Type': 'application/json', 'X-Api-Key': key }
    : { 'Content-Type': 'application/json' };
}

const GROUPS: MetricGroup[] = ['body_comp', 'derived', 'seg_lean', 'seg_fat', 'circumference', 'recommendation'];

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
        <div className="px-4 pt-safe pb-4 flex items-center gap-3">
          <Link href="/measurements" className="text-primary p-1 -ml-1">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold">InBody Scan</h1>
        </div>
        <p className="px-4 text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (!scan) {
    return (
      <main className="tab-content bg-background">
        <div className="px-4 pt-safe pb-4 flex items-center gap-3">
          <Link href="/measurements" className="text-primary p-1 -ml-1">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold">Not Found</h1>
        </div>
      </main>
    );
  }

  const dateStr = new Date(scan.scanned_at).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-safe pb-4 flex items-center gap-3">
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

      <div className="px-4 pb-20 space-y-4">
        {/* Header card */}
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">{scan.device}{scan.venue ? ` · ${scan.venue}` : ''}</div>
              <div className="text-sm font-medium">{dateStr}</div>
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

        {/* Metric groups */}
        {GROUPS.map(group => {
          const metrics = METRICS.filter(m => m.group === group);
          const rows = metrics.map(m => {
            const value = scanValue(scan, m.key as string);
            const status = resolveStatus(value, m, reference, norms, goals);
            return { m, value, status };
          }).filter(r => r.value != null || r.status.label !== 'NO REF');

          if (rows.length === 0) return null;

          return (
            <div key={group}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">
                {GROUP_LABELS[group]}
              </p>
              <div className="ios-section">
                {rows.map(({ m, value, status }) => {
                  const cls = statusColorClasses(status.color);
                  return (
                    <div key={m.key as string} className="ios-row flex-wrap gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{m.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {reference === 'ME' ? 'Goal' : 'Normal'}: {status.refText}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold">{formatValue(value, m)}</div>
                        <span
                          className={`inline-block mt-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded ring-1 ${cls.text} ${cls.bg} ${cls.ring}`}
                        >
                          {status.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Balance */}
        {(scan.balance_upper || scan.balance_lower || scan.balance_upper_lower) && (
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
        )}

        {scan.notes && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Notes</p>
            <div className="ios-section">
              <div className="ios-row">
                <p className="text-sm whitespace-pre-wrap">{scan.notes}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
