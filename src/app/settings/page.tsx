'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useUnit } from '@/context/UnitContext';
import type { BodyweightLog } from '@/types';

const REST_TIMES = [30, 60, 90, 120, 150, 180, 210, 240, 300];

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (sec === 0) return `${m}:00`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function readLS(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function formatLogDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function SettingsPage() {
  const { unit, setUnit, toDisplay, fromInput, label } = useUnit();

  const [defaultRest, setDefaultRest] = useState(() =>
    parseInt(readLS('iron-rest-default', '90'), 10)
  );
  const [autoStart, setAutoStart] = useState(() =>
    readLS('iron-rest-auto-start', 'true') !== 'false'
  );
  const [keepRestRunning, setKeepRestRunning] = useState(() =>
    readLS('iron-rest-keep-running', 'false') === 'true'
  );

  // Bodyweight state
  const [bwInput, setBwInput] = useState('');
  const [bwNote, setBwNote] = useState('');
  const [bwLogs, setBwLogs] = useState<BodyweightLog[]>([]);
  const [bwLoading, setBwLoading] = useState(true);
  const [bwSaving, setBwSaving] = useState(false);

  useEffect(() => {
    fetch('/api/bodyweight?limit=30')
      .then(r => r.json())
      .then((data: BodyweightLog[]) => {
        setBwLogs(data);
        setBwLoading(false);
      })
      .catch(() => setBwLoading(false));
  }, []);

  const updateDefaultRest = (v: number) => {
    setDefaultRest(v);
    localStorage.setItem('iron-rest-default', String(v));
  };

  const updateAutoStart = (v: boolean) => {
    setAutoStart(v);
    localStorage.setItem('iron-rest-auto-start', String(v));
    if (v && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  const updateKeepRestRunning = (v: boolean) => {
    setKeepRestRunning(v);
    localStorage.setItem('iron-rest-keep-running', String(v));
  };

  const handleLogBodyweight = async () => {
    const val = parseFloat(bwInput);
    if (!val || val <= 0) return;
    setBwSaving(true);
    try {
      const weight_kg = fromInput(val);
      const res = await fetch('/api/bodyweight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight_kg, note: bwNote || undefined }),
      });
      if (res.ok) {
        const log: BodyweightLog = await res.json();
        setBwLogs(prev => [log, ...prev]);
        setBwInput('');
        setBwNote('');
      }
    } finally {
      setBwSaving(false);
    }
  };

  const handleDeleteBw = async (uuid: string) => {
    await fetch(`/api/bodyweight/${uuid}`, { method: 'DELETE' });
    setBwLogs(prev => prev.filter(l => l.uuid !== uuid));
  };

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-14 pb-4">
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      <div className="px-4 space-y-4 pb-4">

        {/* General */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">General</p>
          <div className="ios-section">
            <Link href="/body-spec" className="ios-row justify-between">
              <span className="text-sm font-medium">Body Spec</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            {/* Weight unit */}
            <div className="ios-row justify-between">
              <span className="text-sm font-medium">Weight Unit</span>
              <div className="flex rounded-lg overflow-hidden border border-border">
                {(['kg', 'lbs'] as const).map(u => (
                  <button
                    key={u}
                    onClick={() => setUnit(u)}
                    className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                      unit === u
                        ? 'bg-primary text-white'
                        : 'text-foreground'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bodyweight */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Bodyweight</p>
          <div className="ios-section">
            {/* Log entry row */}
            <div className="ios-row gap-2">
              <input
                type="number"
                inputMode="decimal"
                placeholder={`Weight (${label})`}
                value={bwInput}
                onChange={e => setBwInput(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
              />
              <input
                type="text"
                placeholder="Note (optional)"
                value={bwNote}
                onChange={e => setBwNote(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none min-h-[44px] text-muted-foreground"
              />
              <button
                onClick={handleLogBodyweight}
                disabled={bwSaving || !bwInput}
                className="px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
              >
                Log
              </button>
            </div>
          </div>

          {/* History */}
          {!bwLoading && bwLogs.length > 0 && (
            <div className="ios-section mt-2">
              {bwLogs.map((log, i) => (
                <div
                  key={log.uuid}
                  className={`ios-row justify-between ${i < bwLogs.length - 1 ? 'border-b border-border' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">
                      {toDisplay(log.weight_kg)} {label}
                    </span>
                    {log.note && (
                      <span className="text-xs text-muted-foreground ml-2">{log.note}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground mr-3">
                    {formatLogDate(log.logged_at)}
                  </span>
                  <button
                    onClick={() => handleDeleteBw(log.uuid)}
                    className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {!bwLoading && bwLogs.length === 0 && (
            <p className="text-xs text-muted-foreground px-1 mt-2">No bodyweight entries yet.</p>
          )}
        </div>

        {/* Rest Timer */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Rest Timer</p>
          <div className="ios-section">
            <div className="ios-row justify-between">
              <span className="text-sm font-medium">Default Rest Time</span>
              <select
                value={defaultRest}
                onChange={e => updateDefaultRest(Number(e.target.value))}
                className="text-sm text-muted-foreground bg-transparent outline-none text-right"
              >
                {REST_TIMES.map(t => (
                  <option key={t} value={t}>{formatTime(t)}</option>
                ))}
              </select>
            </div>
            <div className="ios-row justify-between">
              <div className="flex-1">
                <span className="text-sm font-medium">Auto-start after Set</span>
                <p className="text-xs text-muted-foreground mt-0.5 pr-4">
                  Automatically starts the rest timer when you complete a set.
                </p>
              </div>
              <button
                onClick={() => updateAutoStart(!autoStart)}
                className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${autoStart ? 'bg-primary' : 'bg-secondary'}`}
              >
                <span
                  className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${autoStart ? 'translate-x-5' : 'translate-x-0.5'}`}
                />
              </button>
            </div>
            <div className="ios-row justify-between">
              <div className="flex-1">
                <span className="text-sm font-medium">Keep Rest Timer Running</span>
                <p className="text-xs text-muted-foreground mt-0.5 pr-4">
                  Shows a red countdown when the rest period has elapsed.
                </p>
              </div>
              <button
                onClick={() => updateKeepRestRunning(!keepRestRunning)}
                className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${keepRestRunning ? 'bg-primary' : 'bg-secondary'}`}
              >
                <span
                  className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${keepRestRunning ? 'translate-x-5' : 'translate-x-0.5'}`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* About */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">About</p>
          <div className="ios-section">
            <div className="ios-row justify-between">
              <span className="text-sm font-medium">Iron</span>
              <span className="text-sm text-muted-foreground">v1.0</span>
            </div>
            <a
              href="https://github.com/lewcart/Iron"
              target="_blank"
              rel="noopener noreferrer"
              className="ios-row justify-between"
            >
              <span className="text-sm font-medium">Source Code</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </a>
          </div>
        </div>

      </div>
    </main>
  );
}
