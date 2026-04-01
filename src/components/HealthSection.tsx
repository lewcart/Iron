'use client';

import { useEffect, useState, useCallback } from 'react';
import { App } from '@capacitor/app';
import { Activity, Flame, Footprints, ExternalLink } from 'lucide-react';
import { fetchHealthSummary, type HealthSummary } from '@/lib/healthkit';

type State =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'data'; summary: HealthSummary };

function formatDuration(minutes: number): string {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function formatWorkoutDate(epochMs: number): string {
  const d = new Date(epochMs);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function HealthSection() {
  const [state, setState] = useState<State>({ phase: 'loading' });

  const refresh = useCallback(async () => {
    const summary = await fetchHealthSummary();
    if (summary === null) {
      setState({ phase: 'denied' });
    } else {
      setState({ phase: 'data', summary });
    }
  }, []);

  useEffect(() => {
    refresh();

    const handle = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) refresh();
    });

    return () => {
      handle.then(h => h.remove());
    };
  }, [refresh]);

  if (state.phase === 'loading') {
    return (
      <div>
        <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Today's Health</p>
        <div className="ios-section">
          <div className="flex gap-3 p-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex-1 h-14 rounded-lg bg-secondary animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === 'denied') {
    return (
      <div>
        <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Today's Health</p>
        <div className="ios-section">
          <div className="flex items-center justify-between px-4 py-4 gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">HealthKit access needed</p>
              <p className="text-xs text-muted-foreground mt-0.5">Enable Health access in iOS Settings to see steps, calories, and workouts here.</p>
            </div>
            <button
              onClick={() => {
                // Deep-link to app settings — Capacitor doesn't expose this directly,
                // but the URL scheme works on iOS 8+
                window.open('app-settings:', '_system');
              }}
              className="flex items-center gap-1 text-xs text-primary font-medium whitespace-nowrap flex-shrink-0 min-h-[36px] px-1"
            >
              Open Settings
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { summary } = state;

  return (
    <div>
      <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Today's Health</p>

      {/* Steps + Calories stat cards */}
      <div className="ios-section mb-2">
        <div className="flex divide-x divide-border">
          <div className="flex-1 flex flex-col items-center gap-1 py-4 px-3">
            <Footprints className="h-4 w-4 text-blue-400" strokeWidth={1.75} />
            <span className="text-xl font-semibold tabular-nums">{summary.steps.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Steps</span>
          </div>
          <div className="flex-1 flex flex-col items-center gap-1 py-4 px-3">
            <Flame className="h-4 w-4 text-orange-400" strokeWidth={1.75} />
            <span className="text-xl font-semibold tabular-nums">{summary.activeCalories.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Active Cal</span>
          </div>
        </div>
      </div>

      {/* Recent workouts */}
      {summary.recentWorkouts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Recent Workouts</p>
          <div className="ios-section">
            {summary.recentWorkouts.slice(0, 5).map((w, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0"
              >
                <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                  <Activity className="h-4 w-4 text-blue-400" strokeWidth={1.75} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{w.activityType}</p>
                  <p className="text-xs text-muted-foreground">{formatWorkoutDate(w.startTime)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-medium tabular-nums">{formatDuration(w.durationMinutes)}</p>
                  {w.activeCalories > 0 && (
                    <p className="text-xs text-muted-foreground">{w.activeCalories} cal</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary.recentWorkouts.length === 0 && (
        <div className="ios-section">
          <p className="text-sm text-muted-foreground text-center py-4">No workouts in the last 7 days</p>
        </div>
      )}
    </div>
  );
}
