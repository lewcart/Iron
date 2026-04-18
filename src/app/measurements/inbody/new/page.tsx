'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { apiBase } from '@/lib/api/client';
import { METRICS, GROUP_LABELS, type MetricGroup } from '@/lib/inbody';

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
  return key
    ? { 'Content-Type': 'application/json', 'X-Api-Key': key }
    : { 'Content-Type': 'application/json' };
}

type Values = Record<string, string>;

const GROUPS: MetricGroup[] = ['body_comp', 'derived', 'seg_lean', 'seg_fat', 'circumference', 'recommendation'];

export default function NewInbodyScanPage() {
  const router = useRouter();
  const [scannedAt, setScannedAt] = useState(new Date().toISOString().slice(0, 16));
  const [venue, setVenue] = useState('');
  const [ageAtScan, setAgeAtScan] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [notes, setNotes] = useState('');
  const [balUpper, setBalUpper] = useState('');
  const [balLower, setBalLower] = useState('');
  const [balUL, setBalUL] = useState('');
  const [values, setValues] = useState<Values>({});
  const [autoInsertCircs, setAutoInsertCircs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setValue = (k: string, v: string) => setValues(prev => ({ ...prev, [k]: v }));

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        scanned_at: new Date(scannedAt).toISOString(),
        auto_insert_circumferences: autoInsertCircs,
      };
      if (venue) payload.venue = venue;
      if (ageAtScan) payload.age_at_scan = parseInt(ageAtScan, 10);
      if (heightCm) payload.height_cm = parseFloat(heightCm);
      if (notes) payload.notes = notes;
      if (balUpper) payload.balance_upper = balUpper;
      if (balLower) payload.balance_lower = balLower;
      if (balUL) payload.balance_upper_lower = balUL;
      for (const m of METRICS) {
        const raw = values[m.key as string];
        if (raw && raw.trim() !== '') {
          const num = parseFloat(raw);
          if (Number.isFinite(num)) payload[m.key as string] = num;
        }
      }
      const res = await fetch(`${apiBase()}/api/measurements/inbody`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'failed' }));
        throw new Error(err.error ?? 'failed');
      }
      router.push('/measurements?tab=inbody');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-safe pb-4 flex items-center gap-3">
        <Link href="/measurements" className="text-primary p-1 -ml-1">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">New InBody Scan</h1>
      </div>

      <div className="px-4 pb-20 space-y-4">
        {/* Meta */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Meta</p>
          <div className="ios-section">
            <div className="ios-row justify-between">
              <span className="text-sm text-muted-foreground">Scanned at</span>
              <input
                type="datetime-local"
                value={scannedAt}
                onChange={e => setScannedAt(e.target.value)}
                className="bg-transparent text-sm text-right outline-none min-h-[44px]"
              />
            </div>
            <div className="ios-row">
              <input
                type="text"
                placeholder="Venue (optional)"
                value={venue}
                onChange={e => setVenue(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
              />
            </div>
            <div className="ios-row gap-3 flex-wrap">
              <input
                type="number"
                inputMode="numeric"
                placeholder="Age at scan"
                value={ageAtScan}
                onChange={e => setAgeAtScan(e.target.value)}
                className="flex-1 min-w-[140px] bg-transparent text-sm outline-none min-h-[44px]"
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder="Height (cm)"
                value={heightCm}
                onChange={e => setHeightCm(e.target.value)}
                className="flex-1 min-w-[140px] bg-transparent text-sm outline-none min-h-[44px]"
              />
            </div>
          </div>
        </div>

        {/* Metric groups */}
        {GROUPS.map(group => {
          const metrics = METRICS.filter(m => m.group === group);
          return (
            <div key={group}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">
                {GROUP_LABELS[group]}
              </p>
              <div className="ios-section">
                {metrics.map(m => (
                  <div key={m.key as string} className="ios-row justify-between gap-3">
                    <label className="text-sm text-muted-foreground flex-1" htmlFor={`f-${m.key as string}`}>
                      {m.label}{m.unit ? ` (${m.unit})` : ''}
                    </label>
                    <input
                      id={`f-${m.key as string}`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      value={values[m.key as string] ?? ''}
                      onChange={e => setValue(m.key as string, e.target.value)}
                      className="w-28 bg-transparent text-sm text-right outline-none min-h-[44px]"
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Balance */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Body Balance</p>
          <div className="ios-section">
            {([
              ['Upper', balUpper, setBalUpper] as const,
              ['Lower', balLower, setBalLower] as const,
              ['Upper–Lower', balUL, setBalUL] as const,
            ]).map(([label, val, setter]) => (
              <div key={label} className="ios-row justify-between gap-3">
                <span className="text-sm text-muted-foreground">{label}</span>
                <select
                  value={val}
                  onChange={e => setter(e.target.value)}
                  className="bg-transparent text-sm text-right outline-none min-h-[44px]"
                >
                  <option value="">—</option>
                  <option value="balanced">Balanced</option>
                  <option value="slightly_under">Slightly under</option>
                  <option value="slightly_over">Slightly over</option>
                  <option value="under">Under</option>
                  <option value="over">Over</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Notes + auto-insert toggle */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Notes</p>
          <div className="ios-section">
            <div className="ios-row">
              <textarea
                placeholder="Anything worth remembering about this scan"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="flex-1 bg-transparent text-sm outline-none resize-none"
              />
            </div>
            <label className="ios-row gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoInsertCircs}
                onChange={e => setAutoInsertCircs(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm flex-1">
                Auto-insert circumferences into weekly measurements
              </span>
            </label>
          </div>
          <p className="text-xs text-muted-foreground px-1 mt-1">
            Uncheck if you&apos;ve already logged circumferences separately this week.
          </p>
        </div>

        {error && <p className="text-sm text-rose-500 px-1">{error}</p>}

        {/* Submit */}
        <div className="flex justify-end">
          <button
            onClick={submit}
            disabled={saving}
            className="px-6 py-3 bg-primary text-white text-sm font-semibold rounded-lg disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save Scan'}
          </button>
        </div>
      </div>
    </main>
  );
}
