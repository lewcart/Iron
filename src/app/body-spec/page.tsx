'use client';

import { useEffect, useState } from 'react';
import { Trash2, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useUnit } from '@/context/UnitContext';
import type { BodySpecLog } from '@/types';

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
  return key
    ? { 'Content-Type': 'application/json', 'X-Api-Key': key }
    : { 'Content-Type': 'application/json' };
}

function formatDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function toDateInputValue(isoStr?: string): string {
  const d = isoStr ? new Date(isoStr) : new Date();
  return d.toISOString().slice(0, 10);
}

export default function BodySpecPage() {
  const { toDisplay, fromInput, label } = useUnit();

  const [logs, setLogs] = useState<BodySpecLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [heightInput, setHeightInput] = useState('');
  const [weightInput, setWeightInput] = useState('');
  const [bodyFatInput, setBodyFatInput] = useState('');
  const [leanMassInput, setLeanMassInput] = useState('');
  const [notes, setNotes] = useState('');
  const [measuredAt, setMeasuredAt] = useState(() => toDateInputValue());

  useEffect(() => {
    const headers = apiHeaders();
    fetch('/api/body-spec?limit=30', { headers })
      .then(r => r.json())
      .then((data: BodySpecLog[]) => {
        setLogs(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    const hasAnyValue = heightInput || weightInput || bodyFatInput || leanMassInput || notes;
    if (!hasAnyValue) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        measured_at: measuredAt ? new Date(measuredAt).toISOString() : undefined,
        notes: notes || null,
      };
      if (heightInput) payload.height_cm = parseFloat(heightInput);
      if (weightInput) payload.weight_kg = fromInput(parseFloat(weightInput));
      if (bodyFatInput) payload.body_fat_pct = parseFloat(bodyFatInput);
      if (leanMassInput) payload.lean_mass_kg = fromInput(parseFloat(leanMassInput));

      const res = await fetch('/api/body-spec', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const log: BodySpecLog = await res.json();
        setLogs(prev => [log, ...prev]);
        setHeightInput('');
        setWeightInput('');
        setBodyFatInput('');
        setLeanMassInput('');
        setNotes('');
        setMeasuredAt(toDateInputValue());
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (uuid: string) => {
    await fetch(`/api/body-spec/${uuid}`, {
      method: 'DELETE',
      headers: apiHeaders(),
    });
    setLogs(prev => prev.filter(l => l.uuid !== uuid));
  };

  const hasInput = !!(heightInput || weightInput || bodyFatInput || leanMassInput || notes);

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-14 pb-4 flex items-center gap-3">
        <Link href="/settings" className="text-primary p-1 -ml-1">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Body Spec</h1>
      </div>

      <div className="px-4 space-y-4 pb-8">

        {/* Log form */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">New Entry</p>
          <div className="ios-section">
            <div className="ios-row gap-3 flex-wrap">
              <input
                type="number"
                inputMode="decimal"
                placeholder="Height (cm)"
                value={heightInput}
                onChange={e => setHeightInput(e.target.value)}
                className="flex-1 min-w-[100px] bg-transparent text-sm outline-none min-h-[44px]"
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder={`Weight (${label})`}
                value={weightInput}
                onChange={e => setWeightInput(e.target.value)}
                className="flex-1 min-w-[100px] bg-transparent text-sm outline-none min-h-[44px]"
              />
            </div>
            <div className="ios-row gap-3 flex-wrap">
              <input
                type="number"
                inputMode="decimal"
                placeholder="Body fat (%)"
                value={bodyFatInput}
                onChange={e => setBodyFatInput(e.target.value)}
                className="flex-1 min-w-[100px] bg-transparent text-sm outline-none min-h-[44px]"
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder={`Lean mass (${label})`}
                value={leanMassInput}
                onChange={e => setLeanMassInput(e.target.value)}
                className="flex-1 min-w-[100px] bg-transparent text-sm outline-none min-h-[44px]"
              />
            </div>
            <div className="ios-row gap-3">
              <input
                type="text"
                placeholder="Notes (optional)"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
              />
            </div>
            <div className="ios-row justify-between">
              <span className="text-sm text-muted-foreground">Date</span>
              <input
                type="date"
                value={measuredAt}
                onChange={e => setMeasuredAt(e.target.value)}
                className="bg-transparent text-sm text-right outline-none min-h-[44px] text-muted-foreground"
              />
            </div>
            <div className="ios-row justify-end">
              <button
                onClick={handleSave}
                disabled={saving || !hasInput}
                className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save Entry'}
              </button>
            </div>
          </div>
        </div>

        {/* History */}
        {!loading && logs.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">History</p>
            <div className="ios-section">
              {logs.map((log, i) => {
                const isCurrent = i === 0;
                return (
                  <div
                    key={log.uuid}
                    className={`ios-row flex-col items-start gap-1 ${i < logs.length - 1 ? 'border-b border-border' : ''}`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{formatDate(log.measured_at)}</span>
                        {isCurrent && (
                          <span className="text-xs font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">Current</span>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(log.uuid)}
                        className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 pb-1">
                      {log.height_cm != null && (
                        <span className="text-sm"><span className="text-muted-foreground text-xs">Height</span> {log.height_cm} cm</span>
                      )}
                      {log.weight_kg != null && (
                        <span className="text-sm"><span className="text-muted-foreground text-xs">Weight</span> {toDisplay(log.weight_kg)} {label}</span>
                      )}
                      {log.body_fat_pct != null && (
                        <span className="text-sm"><span className="text-muted-foreground text-xs">BF%</span> {log.body_fat_pct}%</span>
                      )}
                      {log.lean_mass_kg != null && (
                        <span className="text-sm"><span className="text-muted-foreground text-xs">Lean</span> {toDisplay(log.lean_mass_kg)} {label}</span>
                      )}
                    </div>
                    {log.notes && (
                      <p className="text-xs text-muted-foreground pb-1">{log.notes}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && logs.length === 0 && (
          <p className="text-xs text-muted-foreground px-1">No body spec entries yet.</p>
        )}

      </div>
    </main>
  );
}
