'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronLeft, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { WellbeingLog, DysphoriaLog, ClothesTestLog } from '@/types';
import { rebirthJsonHeaders } from '@/lib/api/headers';
import { apiBase } from '@/lib/api/client';

type Tab = 'daily' | 'journal' | 'clothes';

function formatDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

const MOOD_LABELS: Record<number, string> = {
  1: 'Low', 2: 'Meh', 3: 'OK', 4: 'Good', 5: 'Great',
};

const SCALE_LABELS: Record<number, string> = {
  1: '😔 High dysphoria',
  2: '😟',
  3: '😐',
  4: '🙂',
  5: '😊',
  6: '😄',
  7: '🌟 Mostly euphoric',
  8: '✨',
  9: '💫',
  10: '🌈 Full euphoria',
};

function ScalePicker({
  value, onChange, max,
}: { value: number | null; onChange: (v: number) => void; max: 5 | 10 }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {Array.from({ length: max }, (_, i) => i + 1).map(n => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`w-9 h-9 rounded-lg text-sm font-semibold transition-colors ${
            value === n
              ? 'bg-primary text-white'
              : 'bg-secondary text-foreground'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

// ===== Daily Tab =====

function DailyTab() {
  const [logs, setLogs] = useState<WellbeingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [sleep, setSleep] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [correlation, setCorrelation] = useState<{
    avg_mood: number | null;
    avg_energy: number | null;
    workout_count: number;
  } | null>(null);

  const deleteWellbeingMut = useMutation({
    mutationFn: (uuid: string) =>
      fetch(`${apiBase()}/api/wellbeing/${uuid}`, { method: 'DELETE', headers: rebirthJsonHeaders() }).then((r) => {
        if (!r.ok) throw new Error('Delete failed');
      }),
    onMutate: (uuid) => {
      const prev = logs;
      setLogs((l) => l.filter((x) => x.uuid !== uuid));
      return { prev };
    },
    onError: (_e, _u, ctx) => {
      if (ctx?.prev) setLogs(ctx.prev);
    },
  });

  useEffect(() => {
    fetch(`${apiBase()}/api/wellbeing?limit=30`, { headers: rebirthJsonHeaders() })
      .then(r => r.json())
      .then((data: WellbeingLog[]) => { setLogs(data); setLoading(false); })
      .catch(() => setLoading(false));

    fetch(`${apiBase()}/api/wellbeing/correlation`, { headers: rebirthJsonHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCorrelation(data); })
      .catch(() => null);
  }, []);

  const handleLog = async () => {
    if (!mood && !energy) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBase()}/api/wellbeing`, {
        method: 'POST',
        headers: rebirthJsonHeaders(),
        body: JSON.stringify({
          mood: mood ?? undefined,
          energy: energy ?? undefined,
          sleep_hours: sleep ? parseFloat(sleep) : undefined,
          notes: notes || undefined,
        }),
      });
      if (res.ok) {
        const log: WellbeingLog = await res.json();
        setLogs(prev => [log, ...prev]);
        setMood(null);
        setEnergy(null);
        setSleep('');
        setNotes('');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Motivation correlation */}
      {correlation && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Last 30 Days</p>
          <div className="ios-section">
            <div className="ios-row justify-between">
              <span className="text-sm font-medium">Avg Mood</span>
              <span className="text-sm text-muted-foreground">
                {correlation.avg_mood != null ? correlation.avg_mood.toFixed(1) : '—'} / 5
              </span>
            </div>
            <div className="ios-row justify-between">
              <span className="text-sm font-medium">Avg Energy</span>
              <span className="text-sm text-muted-foreground">
                {correlation.avg_energy != null ? correlation.avg_energy.toFixed(1) : '—'} / 5
              </span>
            </div>
            <div className="ios-row justify-between">
              <span className="text-sm font-medium">Workouts attended</span>
              <span className="text-sm text-muted-foreground">{correlation.workout_count}</span>
            </div>
          </div>
        </div>
      )}

      {/* Quick log */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Log Today</p>
        <div className="ios-section space-y-3 py-3">
          <div className="px-4">
            <p className="text-sm font-medium mb-2">Mood</p>
            <ScalePicker value={mood} onChange={setMood} max={5} />
            {mood && <p className="text-xs text-muted-foreground mt-1">{MOOD_LABELS[mood]}</p>}
          </div>
          <div className="border-t border-border" />
          <div className="px-4">
            <p className="text-sm font-medium mb-2">Energy</p>
            <ScalePicker value={energy} onChange={setEnergy} max={5} />
            {energy && <p className="text-xs text-muted-foreground mt-1">{MOOD_LABELS[energy]}</p>}
          </div>
          <div className="border-t border-border" />
          <div className="px-4 flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              placeholder="Sleep hours (optional)"
              value={sleep}
              onChange={e => setSleep(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
            />
          </div>
          <div className="border-t border-border" />
          <div className="px-4 pb-1">
            <input
              type="text"
              placeholder="Notes (optional)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-transparent text-sm outline-none min-h-[44px]"
            />
          </div>
        </div>
        <button
          onClick={handleLog}
          disabled={saving || (!mood && !energy)}
          className="w-full mt-2 py-3 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Log'}
        </button>
      </div>

      {/* History */}
      {!loading && logs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">History</p>
          <div className="ios-section">
            {logs.map((log, i) => (
              <div
                key={log.uuid}
                className={`ios-row justify-between ${i < logs.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex gap-3 text-sm">
                    {log.mood != null && <span>Mood <strong>{log.mood}</strong></span>}
                    {log.energy != null && <span>Energy <strong>{log.energy}</strong></span>}
                    {log.sleep_hours != null && <span>Sleep <strong>{log.sleep_hours}h</strong></span>}
                  </div>
                  {log.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.notes}</p>}
                </div>
                <span className="text-xs text-muted-foreground mr-3 shrink-0">{formatDate(log.logged_at)}</span>
                <button
                  onClick={() => deleteWellbeingMut.mutate(log.uuid)}
                  className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {!loading && logs.length === 0 && (
        <p className="text-xs text-muted-foreground px-1">No entries yet.</p>
      )}
    </div>
  );
}

// ===== Journal Tab (Dysphoria/Euphoria) =====

function JournalTab() {
  const [logs, setLogs] = useState<DysphoriaLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const deleteDysphoriaMut = useMutation({
    mutationFn: (uuid: string) =>
      fetch(`${apiBase()}/api/dysphoria/${uuid}`, { method: 'DELETE', headers: rebirthJsonHeaders() }).then((r) => {
        if (!r.ok) throw new Error('Delete failed');
      }),
    onMutate: (uuid) => {
      const prev = logs;
      setLogs((l) => l.filter((x) => x.uuid !== uuid));
      return { prev };
    },
    onError: (_e, _u, ctx) => {
      if (ctx?.prev) setLogs(ctx.prev);
    },
  });

  useEffect(() => {
    fetch(`${apiBase()}/api/dysphoria?limit=60`, { headers: rebirthJsonHeaders() })
      .then(r => r.json())
      .then((data: DysphoriaLog[]) => { setLogs(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleLog = async () => {
    if (!scale) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBase()}/api/dysphoria`, {
        method: 'POST',
        headers: rebirthJsonHeaders(),
        body: JSON.stringify({ scale, note: note || undefined }),
      });
      if (res.ok) {
        const log: DysphoriaLog = await res.json();
        setLogs(prev => [log, ...prev]);
        setScale(null);
        setNote('');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">New Entry</p>
        <div className="ios-section space-y-3 py-3">
          <div className="px-4">
            <p className="text-sm font-medium mb-1">How are you feeling? <span className="text-muted-foreground font-normal">(1 = dysphoria, 10 = euphoria)</span></p>
            <ScalePicker value={scale} onChange={setScale} max={10} />
            {scale && <p className="text-xs text-muted-foreground mt-1">{SCALE_LABELS[scale]}</p>}
          </div>
          <div className="border-t border-border" />
          <div className="px-4 pb-1">
            <textarea
              placeholder="Note (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              className="w-full bg-transparent text-sm outline-none resize-none py-2"
            />
          </div>
        </div>
        <button
          onClick={handleLog}
          disabled={saving || !scale}
          className="w-full mt-2 py-3 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Add Entry'}
        </button>
      </div>

      {!loading && logs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">History</p>
          <div className="ios-section">
            {logs.map((log, i) => (
              <div
                key={log.uuid}
                className={`ios-row justify-between ${i < logs.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-primary">{log.scale}</span>
                    <span className="text-xs text-muted-foreground">{SCALE_LABELS[log.scale]}</span>
                  </div>
                  {log.note && <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.note}</p>}
                </div>
                <span className="text-xs text-muted-foreground mr-3 shrink-0">{formatDate(log.logged_at)}</span>
                <button
                  onClick={() => deleteDysphoriaMut.mutate(log.uuid)}
                  className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {!loading && logs.length === 0 && (
        <p className="text-xs text-muted-foreground px-1">No journal entries yet.</p>
      )}
    </div>
  );
}

// ===== Clothes Test Tab =====

function ClothesTestTab() {
  const [logs, setLogs] = useState<ClothesTestLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [outfit, setOutfit] = useState('');
  const [comfort, setComfort] = useState<number | null>(null);
  const [euphoria, setEuphoria] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const deleteClothesMut = useMutation({
    mutationFn: (uuid: string) =>
      fetch(`${apiBase()}/api/clothes-test/${uuid}`, { method: 'DELETE', headers: rebirthJsonHeaders() }).then((r) => {
        if (!r.ok) throw new Error('Delete failed');
      }),
    onMutate: (uuid) => {
      const prev = logs;
      setLogs((l) => l.filter((x) => x.uuid !== uuid));
      return { prev };
    },
    onError: (_e, _u, ctx) => {
      if (ctx?.prev) setLogs(ctx.prev);
    },
  });

  useEffect(() => {
    fetch(`${apiBase()}/api/clothes-test?limit=50`, { headers: rebirthJsonHeaders() })
      .then(r => r.json())
      .then((data: ClothesTestLog[]) => { setLogs(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleLog = async () => {
    if (!outfit.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBase()}/api/clothes-test`, {
        method: 'POST',
        headers: rebirthJsonHeaders(),
        body: JSON.stringify({
          outfit_description: outfit.trim(),
          comfort_rating: comfort ?? undefined,
          euphoria_rating: euphoria ?? undefined,
          notes: notes || undefined,
        }),
      });
      if (res.ok) {
        const log: ClothesTestLog = await res.json();
        setLogs(prev => [log, ...prev]);
        setOutfit('');
        setComfort(null);
        setEuphoria(null);
        setNotes('');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">New Test</p>
        <div className="ios-section space-y-3 py-3">
          <div className="px-4">
            <input
              type="text"
              placeholder="Outfit description"
              value={outfit}
              onChange={e => setOutfit(e.target.value)}
              className="w-full bg-transparent text-sm outline-none min-h-[44px]"
            />
          </div>
          <div className="border-t border-border" />
          <div className="px-4">
            <p className="text-sm font-medium mb-2">Comfort <span className="text-muted-foreground font-normal">(1–10)</span></p>
            <ScalePicker value={comfort} onChange={setComfort} max={10} />
          </div>
          <div className="border-t border-border" />
          <div className="px-4">
            <p className="text-sm font-medium mb-2">Euphoria <span className="text-muted-foreground font-normal">(1–10)</span></p>
            <ScalePicker value={euphoria} onChange={setEuphoria} max={10} />
          </div>
          <div className="border-t border-border" />
          <div className="px-4 pb-1">
            <input
              type="text"
              placeholder="Notes (optional)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-transparent text-sm outline-none min-h-[44px]"
            />
          </div>
        </div>
        <button
          onClick={handleLog}
          disabled={saving || !outfit.trim()}
          className="w-full mt-2 py-3 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save Test'}
        </button>
      </div>

      {!loading && logs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">History</p>
          <div className="ios-section">
            {logs.map((log, i) => (
              <div
                key={log.uuid}
                className={`ios-row justify-between ${i < logs.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{log.outfit_description}</p>
                  <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                    {log.comfort_rating != null && <span>Comfort {log.comfort_rating}/10</span>}
                    {log.euphoria_rating != null && <span>Euphoria {log.euphoria_rating}/10</span>}
                  </div>
                  {log.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.notes}</p>}
                </div>
                <span className="text-xs text-muted-foreground mr-3 shrink-0">{formatDate(log.logged_at)}</span>
                <button
                  onClick={() => deleteClothesMut.mutate(log.uuid)}
                  className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {!loading && logs.length === 0 && (
        <p className="text-xs text-muted-foreground px-1">No clothes tests yet.</p>
      )}
    </div>
  );
}

// ===== Page =====

export default function WellbeingPage() {
  const [activeTab, setActiveTab] = useState<Tab>('daily');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'daily', label: 'Daily' },
    { id: 'journal', label: 'Journal' },
    { id: 'clothes', label: 'Clothes Test' },
  ];

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-safe pb-2 flex items-center gap-3">
        <Link href="/settings" className="text-muted-foreground">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Wellbeing</h1>
      </div>

      {/* Tab bar */}
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
        {activeTab === 'daily' && <DailyTab />}
        {activeTab === 'journal' && <JournalTab />}
        {activeTab === 'clothes' && <ClothesTestTab />}
      </div>
    </main>
  );
}
