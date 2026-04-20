'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Trash2 } from 'lucide-react';
import type { BodyGoal, BodyGoalDirection } from '@/types';
import { apiBase } from '@/lib/api/client';
import { METRICS, GROUP_LABELS, type MetricGroup } from '@/lib/inbody';

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
  return key
    ? { 'Content-Type': 'application/json', 'X-Api-Key': key }
    : { 'Content-Type': 'application/json' };
}

const GROUPS: MetricGroup[] = ['body_comp', 'derived', 'seg_lean', 'seg_fat', 'circumference', 'recommendation'];
const DIRECTIONS: BodyGoalDirection[] = ['higher', 'lower', 'match'];

type Draft = { target_value: string; unit: string; direction: BodyGoalDirection; notes: string };

export default function BodyGoalsPage() {
  const [goals, setGoals] = useState<Record<string, BodyGoal>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBase()}/api/body-goals`, { headers: apiHeaders() })
      .then(r => r.ok ? r.json() : {})
      .then((g: Record<string, BodyGoal>) => { setGoals(g); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const getDraft = (key: string): Draft => {
    if (drafts[key]) return drafts[key];
    const g = goals[key];
    if (g) return { target_value: String(g.target_value), unit: g.unit, direction: g.direction, notes: g.notes ?? '' };
    const m = METRICS.find(mm => mm.key === key);
    return { target_value: '', unit: m?.unit || '', direction: m?.preferredDirection === 'higher' ? 'higher' : m?.preferredDirection === 'lower' ? 'lower' : 'match', notes: '' };
  };

  const setDraft = (key: string, patch: Partial<Draft>) => {
    setDrafts(prev => ({ ...prev, [key]: { ...getDraft(key), ...patch } }));
  };

  async function saveGoal(key: string) {
    const d = getDraft(key);
    const tv = parseFloat(d.target_value);
    if (!Number.isFinite(tv) || !d.unit) return;
    setSavingKey(key);
    try {
      const res = await fetch(`${apiBase()}/api/body-goals/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: apiHeaders(),
        body: JSON.stringify({
          target_value: tv,
          unit: d.unit,
          direction: d.direction,
          notes: d.notes || null,
        }),
      });
      if (res.ok) {
        const g: BodyGoal = await res.json();
        setGoals(prev => ({ ...prev, [key]: g }));
        setDrafts(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    } finally {
      setSavingKey(null);
    }
  }

  async function deleteGoal(key: string) {
    if (!confirm(`Remove goal for ${key}?`)) return;
    await fetch(`${apiBase()}/api/body-goals/${encodeURIComponent(key)}`, { method: 'DELETE', headers: apiHeaders() });
    setGoals(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setDrafts(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const hasAnyGoal = Object.keys(goals).length > 0;

  return (
    <main className="tab-content bg-background">
      <div className="max-w-lg md:max-w-4xl mx-auto">
        <div className="px-4 pt-safe pb-4 flex items-center gap-3">
          <Link href="/measurements" className="text-primary p-1 -ml-1">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold">Body Goals</h1>
        </div>

        <div className="px-4 pb-20 md:grid md:grid-cols-2 md:gap-4 md:auto-rows-min space-y-4 md:space-y-0">
          {loading && <p className="text-xs text-muted-foreground px-1 md:col-span-2">Loading…</p>}

          {!loading && !hasAnyGoal && (
            <p className="text-sm text-muted-foreground px-1 md:col-span-2">
              No goals set yet — tap any metric below to set a target.
            </p>
          )}

          {!loading && GROUPS.map(group => {
            const metrics = METRICS.filter(m => m.group === group);
            return (
              <div key={group}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">
                  {GROUP_LABELS[group]}
                </p>
                <div className="ios-section">
                {metrics.map(m => {
                  const key = m.key as string;
                  const draft = getDraft(key);
                  const existing = goals[key];
                  const dirty = !!drafts[key];
                  return (
                    <div key={key} className="ios-row flex-wrap gap-2">
                      <div className="w-full flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{m.label}</div>
                          {existing && !dirty && (
                            <div className="text-xs text-muted-foreground">
                              Current: {existing.direction === 'higher' ? '≥' : existing.direction === 'lower' ? '≤' : '='} {existing.target_value}{existing.unit ? ' ' + existing.unit : ''}
                            </div>
                          )}
                        </div>
                        {existing && (
                          <button
                            onClick={() => deleteGoal(key)}
                            className="text-rose-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
                            aria-label={`Delete goal for ${m.label}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <div className="w-full flex items-center gap-2 flex-wrap">
                        <select
                          value={draft.direction}
                          onChange={e => setDraft(key, { direction: e.target.value as BodyGoalDirection })}
                          className="bg-transparent border border-border rounded-lg px-2 py-1 text-xs"
                        >
                          {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          placeholder="target"
                          value={draft.target_value}
                          onChange={e => setDraft(key, { target_value: e.target.value })}
                          className="flex-1 min-w-[80px] bg-transparent border border-border rounded-lg px-2 py-1 text-sm"
                        />
                        <input
                          type="text"
                          placeholder="unit"
                          value={draft.unit}
                          onChange={e => setDraft(key, { unit: e.target.value })}
                          className="w-16 bg-transparent border border-border rounded-lg px-2 py-1 text-sm text-center"
                        />
                        <button
                          onClick={() => saveGoal(key)}
                          disabled={savingKey === key || !draft.target_value || !draft.unit}
                          className="px-3 py-1 bg-primary text-white text-xs font-medium rounded-lg disabled:opacity-40"
                        >
                          {savingKey === key ? '…' : existing ? 'Update' : 'Save'}
                        </button>
                      </div>
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
