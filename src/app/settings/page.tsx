'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

const REST_TIMES = [30, 60, 90, 120, 150, 180, 210, 240, 300];

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (sec === 0) return `${m}:00`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function SettingsPage() {
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [defaultRest, setDefaultRest] = useState(90);
  const [defaultRestDumbbell, setDefaultRestDumbbell] = useState(60);
  const [defaultRestBarbell, setDefaultRestBarbell] = useState(120);
  const [keepRestRunning, setKeepRestRunning] = useState(false);

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
            {/* Weight unit */}
            <div className="ios-row justify-between">
              <span className="text-sm font-medium">Weight Unit</span>
              <div className="flex rounded-lg overflow-hidden border border-border">
                {(['kg', 'lb'] as const).map(unit => (
                  <button
                    key={unit}
                    onClick={() => setWeightUnit(unit)}
                    className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                      weightUnit === unit
                        ? 'bg-primary text-white'
                        : 'text-foreground'
                    }`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Rest Timer */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Rest Timer</p>
          <div className="ios-section">
            <div className="ios-row justify-between">
              <span className="text-sm font-medium">Default Rest Time</span>
              <select
                value={defaultRest}
                onChange={e => setDefaultRest(Number(e.target.value))}
                className="text-sm text-muted-foreground bg-transparent outline-none text-right"
              >
                {REST_TIMES.map(t => (
                  <option key={t} value={t}>{formatTime(t)}</option>
                ))}
              </select>
            </div>
            <div className="ios-row justify-between">
              <span className="text-sm font-medium">Default (Dumbbell)</span>
              <select
                value={defaultRestDumbbell}
                onChange={e => setDefaultRestDumbbell(Number(e.target.value))}
                className="text-sm text-muted-foreground bg-transparent outline-none text-right"
              >
                {REST_TIMES.map(t => (
                  <option key={t} value={t}>{formatTime(t)}</option>
                ))}
              </select>
            </div>
            <div className="ios-row justify-between">
              <span className="text-sm font-medium">Default (Barbell)</span>
              <select
                value={defaultRestBarbell}
                onChange={e => setDefaultRestBarbell(Number(e.target.value))}
                className="text-sm text-muted-foreground bg-transparent outline-none text-right"
              >
                {REST_TIMES.map(t => (
                  <option key={t} value={t}>{formatTime(t)}</option>
                ))}
              </select>
            </div>
            <div className="ios-row justify-between">
              <div className="flex-1">
                <span className="text-sm font-medium">Keep Rest Timer Running</span>
                <p className="text-xs text-muted-foreground mt-0.5 pr-4">
                  Shows a red countdown when the rest period has elapsed.
                </p>
              </div>
              <button
                onClick={() => setKeepRestRunning(r => !r)}
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
