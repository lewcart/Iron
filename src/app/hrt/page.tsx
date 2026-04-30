'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { LocalHrtTimelinePeriod, LocalLabDraw, LocalLabResult } from '@/db/local';
import {
  useHrtTimelinePeriods,
  useLabDraws,
  useLabResults,
  useLabSeries,
} from '@/lib/useLocalDB-hrt';
import {
  createHrtTimelinePeriod,
  endHrtTimelinePeriod,
  deleteHrtTimelinePeriod,
  createLabDraw,
  deleteLabDraw,
  upsertLabResult,
} from '@/lib/mutations-hrt';
import {
  LAB_DEFINITIONS,
  LAB_DEFINITIONS_BY_CODE,
  LAB_CATEGORY_LABELS,
  evaluateLabRange,
  type LabCategory,
  type LabDefinition,
  type RangeStatus,
} from '@/lib/lab-definitions';
import { apiBase } from '@/lib/api/client';

type Tab = 'timeline' | 'labs' | 'meds';

// Canonical dose presets surfaced in the UI pickers. Free-text fallback
// available via the "Other" picker option, matching the Notion source's
// extensibility.
const DOSES_E = [
  'Sandrena Gel 1mg/day',
  'Sandrena Gel 2mg/day',
  'Estrogel 1.5mg estradiol',
];
const DOSES_T_BLOCKER = [
  'Cyproterone 12.5mg/day',
  'Finasteride Pill 1mg/day',
  'Finasteride Pill 5mg/Day',
  'None',
];
const DOSES_OTHER_PRESETS = ['1 Tablet Ralovista/day'];

function formatDate(ymd: string) {
  // ymd is YYYY-MM-DD; render in en-GB short form.
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function daysBetween(from: string, to: string): number {
  const fromDate = new Date(from + 'T00:00:00');
  const toDate = new Date(to + 'T00:00:00');
  return Math.max(0, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000));
}

// ────────────────────────────────────────────────────────────────────────────
// Timeline tab
// ────────────────────────────────────────────────────────────────────────────

function TimelineTab() {
  const periods = useHrtTimelinePeriods();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [endedAt, setEndedAt] = useState('');
  const [doseE, setDoseE] = useState<string>('');
  const [doseTBlocker, setDoseTBlocker] = useState<string>('');
  const [dosesOther, setDosesOther] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  const today = new Date().toISOString().slice(0, 10);

  const reset = () => {
    setName(''); setStartedAt(''); setEndedAt('');
    setDoseE(''); setDoseTBlocker(''); setDosesOther([]); setNotes('');
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!name.trim() || !startedAt) return;
    setSaving(true);
    try {
      await createHrtTimelinePeriod({
        name,
        started_at: startedAt,
        ended_at: endedAt || null,
        doses_e: doseE || null,
        doses_t_blocker: doseTBlocker || null,
        doses_other: dosesOther,
        notes: notes || null,
      });
      reset();
    } finally {
      setSaving(false);
    }
  };

  const current = periods.find(p => !p.ended_at) ?? null;

  return (
    <div className="space-y-4">
      {current && <CurrentProtocolCard period={current} />}

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 border border-dashed border-border rounded-xl text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          + Add Protocol Period
        </button>
      ) : (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">New Period</p>
          <div className="ios-section space-y-0">
            <div className="ios-row gap-2">
              <input
                type="text"
                placeholder="Name (e.g. Estrogel + Cypro)"
                value={name}
                onChange={e => setName(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
              />
            </div>
            <div className="ios-row border-t border-border justify-between">
              <span className="text-sm font-medium">Started</span>
              <input
                type="date"
                value={startedAt}
                onChange={e => setStartedAt(e.target.value)}
                max={today}
                className="text-sm text-muted-foreground bg-transparent outline-none text-right"
              />
            </div>
            <div className="ios-row border-t border-border justify-between">
              <span className="text-sm font-medium">Ended (blank = current)</span>
              <input
                type="date"
                value={endedAt}
                onChange={e => setEndedAt(e.target.value)}
                max={today}
                className="text-sm text-muted-foreground bg-transparent outline-none text-right"
              />
            </div>
            <div className="ios-row border-t border-border justify-between">
              <span className="text-sm font-medium">Estrogen</span>
              <select
                value={doseE}
                onChange={e => setDoseE(e.target.value)}
                className="text-sm text-muted-foreground bg-transparent outline-none text-right max-w-[60%]"
              >
                <option value="">—</option>
                {DOSES_E.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="ios-row border-t border-border justify-between">
              <span className="text-sm font-medium">T-Blocker</span>
              <select
                value={doseTBlocker}
                onChange={e => setDoseTBlocker(e.target.value)}
                className="text-sm text-muted-foreground bg-transparent outline-none text-right max-w-[60%]"
              >
                <option value="">—</option>
                {DOSES_T_BLOCKER.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="ios-row border-t border-border flex-col items-stretch gap-1">
              <span className="text-sm font-medium">Other meds</span>
              <div className="flex flex-wrap gap-1">
                {DOSES_OTHER_PRESETS.map(d => {
                  const on = dosesOther.includes(d);
                  return (
                    <button
                      key={d}
                      onClick={() => setDosesOther(prev => on ? prev.filter(x => x !== d) : [...prev, d])}
                      className={`px-2 py-1 rounded-md text-xs font-medium ${on ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground'}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="ios-row border-t border-border gap-2">
              <input
                type="text"
                placeholder="Notes (optional)"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
              />
            </div>
            <div className="ios-row border-t border-border justify-end gap-2">
              <button onClick={reset} className="px-4 py-2 text-sm font-medium text-muted-foreground">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={saving || !name.trim() || !startedAt}
                className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {periods.length === 0 ? (
        <p className="text-xs text-muted-foreground px-1">No timeline entries yet.</p>
      ) : (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">All Periods</p>
          <div className="space-y-2">
            {periods.map(p => <TimelineRow key={p.uuid} period={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function CurrentProtocolCard({ period }: { period: LocalHrtTimelinePeriod }) {
  const today = new Date().toISOString().slice(0, 10);
  const days = daysBetween(period.started_at, today);
  return (
    <div className="ios-section">
      <div className="ios-row flex-col items-start gap-1">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Current Protocol</p>
        <p className="text-sm font-semibold">{period.name}</p>
        {period.doses_e && <p className="text-xs text-muted-foreground">E: {period.doses_e}</p>}
        {period.doses_t_blocker && <p className="text-xs text-muted-foreground">T-Blocker: {period.doses_t_blocker}</p>}
        {period.doses_other.length > 0 && (
          <p className="text-xs text-muted-foreground">+ {period.doses_other.join(', ')}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Since {formatDate(period.started_at)} · {days} day{days === 1 ? '' : 's'}
        </p>
      </div>
    </div>
  );
}

function TimelineRow({ period }: { period: LocalHrtTimelinePeriod }) {
  const isCurrent = !period.ended_at;
  const today = new Date().toISOString().slice(0, 10);
  const days = daysBetween(period.started_at, period.ended_at || today);
  return (
    <div className="ios-section">
      <div className="ios-row justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold truncate">{period.name}</p>
            {isCurrent && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 shrink-0">
                Current
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDate(period.started_at)} – {period.ended_at ? formatDate(period.ended_at) : 'now'}
            {' · '}{days} day{days === 1 ? '' : 's'}
          </p>
          {period.doses_e && <p className="text-xs text-muted-foreground mt-0.5">E: {period.doses_e}</p>}
          {period.doses_t_blocker && <p className="text-xs text-muted-foreground">T-Blocker: {period.doses_t_blocker}</p>}
          {period.doses_other.length > 0 && (
            <p className="text-xs text-muted-foreground">+ {period.doses_other.join(', ')}</p>
          )}
          {period.notes && <p className="text-xs text-muted-foreground italic">{period.notes}</p>}
        </div>
        <div className="flex gap-1 shrink-0">
          {isCurrent && (
            <button
              onClick={() => endHrtTimelinePeriod(period.uuid)}
              className="px-2 py-1 text-xs font-medium rounded-lg bg-secondary text-foreground"
            >
              End
            </button>
          )}
          <button
            onClick={() => deleteHrtTimelinePeriod(period.uuid)}
            className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Labs tab
// ────────────────────────────────────────────────────────────────────────────

function LabsTab() {
  const draws = useLabDraws();
  const results = useLabResults();
  const [view, setView] = useState<'e_t' | 'all'>('e_t');
  const [showForm, setShowForm] = useState(false);

  const sortedDraws = useMemo(() => draws, [draws]);

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex bg-secondary rounded-lg p-0.5 gap-1 text-xs">
        <button
          onClick={() => setView('e_t')}
          className={`flex-1 py-1.5 rounded-md font-medium ${view === 'e_t' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
        >
          E &amp; T
        </button>
        <button
          onClick={() => setView('all')}
          className={`flex-1 py-1.5 rounded-md font-medium ${view === 'all' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
        >
          All Labs
        </button>
      </div>

      {view === 'e_t' && <ETView draws={sortedDraws} results={results} />}
      {view === 'all' && <AllLabsView draws={sortedDraws} results={results} />}

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 border border-dashed border-border rounded-xl text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          + Add Blood Draw
        </button>
      ) : (
        <NewDrawForm onDone={() => setShowForm(false)} />
      )}
    </div>
  );
}

function ETView({ draws, results }: { draws: LocalLabDraw[]; results: LocalLabResult[] }) {
  // Build a map: draw_uuid → { e2, testosterone }
  const byDraw = useMemo(() => {
    const m = new Map<string, { e2?: number; testosterone?: number }>();
    for (const r of results) {
      if (r.lab_code !== 'e2' && r.lab_code !== 'testosterone') continue;
      const entry = m.get(r.draw_uuid) ?? {};
      if (r.lab_code === 'e2') entry.e2 = r.value;
      if (r.lab_code === 'testosterone') entry.testosterone = r.value;
      m.set(r.draw_uuid, entry);
    }
    return m;
  }, [results]);

  const e2Def = LAB_DEFINITIONS_BY_CODE['e2'];
  const tDef = LAB_DEFINITIONS_BY_CODE['testosterone'];

  const drawsWithValues = draws.filter(d => byDraw.has(d.uuid));

  if (drawsWithValues.length === 0) {
    return (
      <p className="text-xs text-muted-foreground px-1">
        No E2 or Testosterone results yet. Add a draw with the form below.
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Estrogen & Testosterone</p>
      <div className="ios-section">
        {/* Header row */}
        <div className="ios-row text-xs text-muted-foreground border-b border-border">
          <div className="flex-1">Date</div>
          <div className="w-20 text-right">♀ E2</div>
          <div className="w-20 text-right">♀ T</div>
        </div>
        {drawsWithValues.map((d, i) => {
          const v = byDraw.get(d.uuid)!;
          return (
            <div
              key={d.uuid}
              className={`ios-row ${i < drawsWithValues.length - 1 ? 'border-b border-border' : ''}`}
            >
              <div className="flex-1 text-sm">{formatDate(d.drawn_at)}</div>
              <div className="w-20 text-right">
                {v.e2 != null ? <ValuePill value={v.e2} def={e2Def} /> : <span className="text-xs text-muted-foreground">—</span>}
              </div>
              <div className="w-20 text-right">
                {v.testosterone != null ? <ValuePill value={v.testosterone} def={tDef} /> : <span className="text-xs text-muted-foreground">—</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ValuePill({ value, def }: { value: number; def: LabDefinition }) {
  const status: RangeStatus = evaluateLabRange(def, value, 'female');
  const cls = pillClass(status);
  return (
    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {formatLabValue(value)}
    </span>
  );
}

function pillClass(status: RangeStatus): string {
  switch (status) {
    case 'in_range':
      return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    case 'low':
    case 'high':
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
    case 'unknown':
    default:
      return 'bg-secondary text-muted-foreground';
  }
}

function formatLabValue(value: number): string {
  // Trim trailing zeros, keep up to 3 decimal places.
  if (Number.isInteger(value)) return String(value);
  return Number(value.toFixed(3)).toString();
}

function AllLabsView({ draws, results }: { draws: LocalLabDraw[]; results: LocalLabResult[] }) {
  const byDraw = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of results) {
      const inner = m.get(r.draw_uuid) ?? new Map<string, number>();
      inner.set(r.lab_code, r.value);
      m.set(r.draw_uuid, inner);
    }
    return m;
  }, [results]);

  const grouped = useMemo(() => {
    const groups = new Map<LabCategory, LabDefinition[]>();
    for (const d of LAB_DEFINITIONS) {
      const arr = groups.get(d.category) ?? [];
      arr.push(d);
      groups.set(d.category, arr);
    }
    return [...groups.entries()];
  }, []);

  const drawsWithAny = draws.filter(d => (byDraw.get(d.uuid)?.size ?? 0) > 0);

  if (drawsWithAny.length === 0) {
    return <p className="text-xs text-muted-foreground px-1">No lab results yet.</p>;
  }

  return (
    <div className="space-y-4">
      {drawsWithAny.map(d => {
        const values = byDraw.get(d.uuid)!;
        return (
          <div key={d.uuid}>
            <div className="flex items-center justify-between px-1 mb-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {formatDate(d.drawn_at)}
              </p>
              <button
                onClick={() => {
                  if (confirm('Delete this draw and all its values?')) deleteLabDraw(d.uuid);
                }}
                className="text-red-500 text-xs px-2 py-1"
              >
                Delete
              </button>
            </div>
            <div className="ios-section">
              {grouped.map(([category, defs]) => {
                const present = defs.filter(def => values.has(def.lab_code));
                if (present.length === 0) return null;
                return (
                  <div key={category} className="border-b border-border last:border-b-0">
                    <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {LAB_CATEGORY_LABELS[category]}
                    </div>
                    {present.map((def, i) => (
                      <div
                        key={def.lab_code}
                        className={`ios-row justify-between ${i < present.length - 1 ? 'border-b border-border' : ''}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{def.label}</p>
                          {def.unit && <p className="text-xs text-muted-foreground">{def.unit}</p>}
                        </div>
                        <ValuePill value={values.get(def.lab_code)!} def={def} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            {d.notes && <p className="text-xs text-muted-foreground italic px-1 mt-1">{d.notes}</p>}
          </div>
        );
      })}
    </div>
  );
}

function NewDrawForm({ onDone }: { onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [drawnAt, setDrawnAt] = useState(today);
  const [notes, setNotes] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [drawUuid, setDrawUuid] = useState<string | null>(null);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const results = Object.entries(values)
        .filter(([, v]) => v.trim() !== '' && Number.isFinite(Number(v)))
        .map(([lab_code, v]) => ({ lab_code, value: Number(v) }));

      const draw = await createLabDraw({
        drawn_at: drawnAt,
        notes: notes || null,
        results,
      });
      setDrawUuid(draw.uuid);
      onDone();
    } finally {
      setSaving(false);
    }
  };

  // Update a single lab value live for an existing draw — used after save
  // for users who want to add more values without closing the form.
  const handleLiveSave = async (lab_code: string, raw: string) => {
    setValues(v => ({ ...v, [lab_code]: raw }));
    if (!drawUuid) return;
    if (raw.trim() === '' || !Number.isFinite(Number(raw))) return;
    await upsertLabResult({ draw_uuid: drawUuid, lab_code, value: Number(raw) });
  };

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">New Blood Draw</p>
      <div className="ios-section">
        <div className="ios-row justify-between">
          <span className="text-sm font-medium">Date</span>
          <input
            type="date"
            value={drawnAt}
            onChange={e => setDrawnAt(e.target.value)}
            max={today}
            className="text-sm text-muted-foreground bg-transparent outline-none text-right"
          />
        </div>
        <div className="ios-row border-t border-border gap-2">
          <input
            type="text"
            placeholder="Notes (optional)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
          />
        </div>
        {LAB_DEFINITIONS.map(def => (
          <div key={def.lab_code} className="ios-row border-t border-border justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{def.label}</p>
              {def.unit && <p className="text-xs text-muted-foreground">{def.unit}</p>}
            </div>
            <input
              type="number"
              step="any"
              inputMode="decimal"
              value={values[def.lab_code] ?? ''}
              onChange={e => drawUuid ? handleLiveSave(def.lab_code, e.target.value) : setValues(v => ({ ...v, [def.lab_code]: e.target.value }))}
              placeholder="—"
              className="w-24 bg-transparent text-sm outline-none text-right"
            />
          </div>
        ))}
        {!drawUuid && (
          <div className="ios-row border-t border-border justify-end gap-2">
            <button onClick={onDone} className="px-4 py-2 text-sm font-medium text-muted-foreground">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Meds tab — Apple Health medication records (read-only)
// ────────────────────────────────────────────────────────────────────────────

interface MedsSummary {
  window_days: number;
  medications: Array<{
    medication_name: string;
    doses_in_window: number;
    last_taken_at: string;
  }>;
}

interface MedsRecord {
  hk_uuid: string;
  medication_name: string;
  dose_string: string | null;
  taken_at: string;
  scheduled_at: string | null;
  source_name: string | null;
}

function MedsTab() {
  const [windowDays, setWindowDays] = useState(7);
  const [summary, setSummary] = useState<MedsSummary | null>(null);
  const [records, setRecords] = useState<MedsRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`${apiBase()}/api/healthkit/medications?days=${windowDays}&summary=true`),
      fetch(`${apiBase()}/api/healthkit/medications?days=${windowDays}`),
    ])
      .then(async ([sumRes, listRes]) => {
        if (!sumRes.ok || !listRes.ok) throw new Error('Failed to load medications');
        const [sum, list] = await Promise.all([sumRes.json(), listRes.json()]);
        if (cancelled) return;
        setSummary(sum);
        setRecords(list.medications);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [windowDays]);

  if (loading) return <p className="text-xs text-muted-foreground px-1">Loading…</p>;
  if (error) return <p className="text-xs text-red-500 px-1">{error}</p>;

  const hasData = (summary?.medications.length ?? 0) > 0 || (records?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* Window picker */}
      <div className="flex bg-secondary rounded-lg p-0.5 gap-1 text-xs">
        {[7, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => setWindowDays(d)}
            className={`flex-1 py-1.5 rounded-md font-medium ${windowDays === d ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
          >
            {d}d
          </button>
        ))}
      </div>

      {!hasData ? (
        <div className="ios-section">
          <div className="ios-row flex-col items-start gap-1">
            <p className="text-sm font-medium">No medication data from Apple Health yet.</p>
            <p className="text-xs text-muted-foreground">
              Enable the Medications feature in the iOS Health app and grant Rebirth read access from Settings → HealthKit. Records logged there will sync here.
            </p>
          </div>
        </div>
      ) : (
        <>
          {summary && summary.medications.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">
                Last {summary.window_days} days
              </p>
              <div className="ios-section">
                {summary.medications.map((m, i) => (
                  <div
                    key={m.medication_name}
                    className={`ios-row justify-between ${i < summary.medications.length - 1 ? 'border-b border-border' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.medication_name}</p>
                      <p className="text-xs text-muted-foreground">
                        Last: {new Date(m.last_taken_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-semibold bg-secondary">
                      {m.doses_in_window} dose{m.doses_in_window === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {records && records.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Recent doses</p>
              <div className="ios-section">
                {records.slice(0, 50).map((r, i) => (
                  <div
                    key={r.hk_uuid}
                    className={`ios-row justify-between ${i < records.slice(0, 50).length - 1 ? 'border-b border-border' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.medication_name}</p>
                      {r.dose_string && <p className="text-xs text-muted-foreground">{r.dose_string}</p>}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(r.taken_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Page shell
// ────────────────────────────────────────────────────────────────────────────

export default function HrtPage() {
  const [activeTab, setActiveTab] = useState<Tab>('timeline');

  // Suppresses unused-import warnings in builds that tree-shake the helpers.
  void useLabSeries;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'labs', label: 'Labs' },
    { id: 'meds', label: 'Meds' },
  ];

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-safe pb-2 flex items-center gap-3">
        <Link href="/settings" className="text-muted-foreground">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">HRT Tracking</h1>
      </div>

      <div className="px-4 pb-2">
        <div className="flex bg-secondary rounded-xl p-1 gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === t.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-8">
        {activeTab === 'timeline' && <TimelineTab />}
        {activeTab === 'labs' && <LabsTab />}
        {activeTab === 'meds' && <MedsTab />}
      </div>
    </main>
  );
}
