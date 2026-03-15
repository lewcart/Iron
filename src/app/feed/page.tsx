'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface StatsData {
  activeDays: string[];
  weeklyData: { week: string; count: number }[];
}

interface SummaryData {
  weekWorkouts: number;
  weekVolume: number;
  currentStreak: number;
  lastWorkouts: {
    uuid: string;
    start_time: string;
    end_time: string | null;
    title: string | null;
    exercises: string[];
    volume: number;
  }[];
  muscleFrequency: Record<string, number>;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatVolume(volume: number): string {
  if (volume >= 1000) {
    return `${(volume / 1000).toFixed(1)}k kg`;
  }
  return `${Math.round(volume)} kg`;
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const diff = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.round(diff / 60000);
  if (mins >= 60) {
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
  return `${mins}m`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const MUSCLE_GROUPS = [
  { key: 'chest', label: 'Chest' },
  { key: 'back', label: 'Back' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'biceps', label: 'Biceps' },
  { key: 'triceps', label: 'Triceps' },
  { key: 'legs', label: 'Legs' },
  { key: 'glutes', label: 'Glutes' },
  { key: 'abdominals', label: 'Abs' },
  { key: 'traps', label: 'Traps' },
];

function muscleHeatColor(count: number): string {
  if (count >= 3) return 'bg-blue-500';
  if (count === 2) return 'bg-blue-700';
  if (count === 1) return 'bg-blue-900';
  return 'bg-zinc-800';
}

function muscleTextColor(count: number): string {
  if (count >= 1) return 'text-zinc-100';
  return 'text-zinc-500';
}

export default function FeedPage() {
  const router = useRouter();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [startingWorkout, setStartingWorkout] = useState(false);

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(setStats);
    fetch('/api/stats/summary').then(r => r.json()).then(setSummary);
  }, []);

  // Build 28-day grid (4 weeks × 7 days), starting from 27 days ago
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: Date[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d);
  }

  const activeDaySet = new Set(stats?.activeDays ?? []);
  const totalWorkouts = stats?.activeDays.length ?? 0;

  // Weekly chart
  const weeklyData = stats?.weeklyData ?? [];
  const maxCount = Math.max(...weeklyData.map(w => w.count), 1);
  const avgCount = weeklyData.length > 0
    ? (weeklyData.reduce((s, w) => s + w.count, 0) / weeklyData.length).toFixed(1)
    : '0';

  // Day-of-week headers (Sun–Sat)
  const dayHeaders = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  async function handleQuickStart() {
    setStartingWorkout(true);
    try {
      const res = await fetch('/api/workouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (res.ok) {
        const workout = await res.json();
        router.push(`/workout/${workout.uuid}`);
      }
    } finally {
      setStartingWorkout(false);
    }
  }

  async function handleRepeatLast() {
    if (!summary?.lastWorkouts?.[0]) return;
    setStartingWorkout(true);
    try {
      const lastWorkout = summary.lastWorkouts[0];
      // Start a new workout
      const res = await fetch('/api/workouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (!res.ok) return;
      const newWorkout = await res.json();

      // Fetch exercises from the last workout to replicate
      const exRes = await fetch(`/api/workout-exercises?workout_uuid=${lastWorkout.uuid}`);
      if (exRes.ok) {
        const exercises = await exRes.json();
        for (const ex of exercises) {
          await fetch('/api/workout-exercises', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workout_uuid: newWorkout.uuid, exercise_uuid: ex.exercise_uuid }),
          });
        }
      }

      router.push(`/workout/${newWorkout.uuid}`);
    } finally {
      setStartingWorkout(false);
    }
  }

  const hasLastWorkout = (summary?.lastWorkouts?.length ?? 0) > 0;

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-14 pb-4">
        <h1 className="text-2xl font-bold">Feed</h1>
      </div>

      <div className="px-4 space-y-4 pb-4">

        {/* Weekly Summary Card */}
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
          <span className="text-xs font-semibold text-primary uppercase tracking-wide">This Week</span>
          <div className="grid grid-cols-3 gap-4 mt-3">
            <div className="flex flex-col gap-1">
              <span className="text-3xl font-bold text-zinc-100">{summary?.weekWorkouts ?? '—'}</span>
              <span className="text-sm text-zinc-400">Workouts</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-3xl font-bold text-zinc-100">
                {summary ? formatVolume(summary.weekVolume) : '—'}
              </span>
              <span className="text-sm text-zinc-400">Volume</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-3xl font-bold text-zinc-100">
                {summary?.currentStreak ?? '—'}
              </span>
              <span className="text-sm text-zinc-400">Wk Streak</span>
            </div>
          </div>
        </div>

        {/* Quick Start Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleQuickStart}
            disabled={startingWorkout}
            className="flex-1 bg-primary text-white font-semibold py-3 rounded-xl text-base disabled:opacity-50"
          >
            {startingWorkout ? 'Starting…' : 'Quick Start'}
          </button>
          {hasLastWorkout && (
            <button
              onClick={handleRepeatLast}
              disabled={startingWorkout}
              className="flex-1 bg-zinc-800 border border-zinc-700 text-zinc-100 font-semibold py-3 rounded-xl text-base disabled:opacity-50"
            >
              Repeat Last
            </button>
          )}
        </div>

        {/* Last 3 Workouts */}
        {(summary?.lastWorkouts?.length ?? 0) > 0 && (
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
            <span className="text-xs font-semibold text-primary uppercase tracking-wide">Recent Workouts</span>
            <div className="mt-3 space-y-3">
              {summary!.lastWorkouts.map((w) => (
                <button
                  key={w.uuid}
                  onClick={() => router.push('/history')}
                  className="w-full text-left rounded-lg bg-zinc-800 border border-zinc-700 p-3"
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-sm font-semibold text-zinc-100">
                      {w.title ?? formatDate(w.start_time)}
                    </span>
                    <span className="text-xs text-zinc-400">{formatDuration(w.start_time, w.end_time)}</span>
                  </div>
                  {!w.title && (
                    <div className="text-xs text-zinc-500 mb-1">{formatDate(w.start_time)}</div>
                  )}
                  <div className="text-xs text-zinc-400 truncate">
                    {w.exercises.length > 0 ? w.exercises.slice(0, 3).join(', ') + (w.exercises.length > 3 ? ` +${w.exercises.length - 3}` : '') : 'No exercises'}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">{formatVolume(w.volume)}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Muscle Group Heatmap */}
        {summary && (
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
            <span className="text-xs font-semibold text-primary uppercase tracking-wide">Muscles This Week</span>
            <div className="grid grid-cols-3 gap-2 mt-3">
              {MUSCLE_GROUPS.map(({ key, label }) => {
                const count = summary.muscleFrequency[key] ?? 0;
                return (
                  <div
                    key={key}
                    className={`rounded-lg p-2 flex flex-col items-center gap-1 ${muscleHeatColor(count)}`}
                  >
                    <span className={`text-xs font-medium ${muscleTextColor(count)}`}>{label}</span>
                    {count > 0 && (
                      <span className="text-[10px] text-zinc-300">{count}x</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Activity Calendar */}
        <div className="ios-section p-4">
          <div className="flex justify-between items-baseline mb-3">
            <span className="text-xs font-semibold text-primary uppercase tracking-wide">Activity</span>
          </div>
          <div className="flex justify-between items-baseline mb-2">
            <p className="font-semibold text-base">Workouts Last 28 Days</p>
            <span className="text-sm text-muted-foreground">{totalWorkouts} workouts</span>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {dayHeaders.map((d, i) => (
              <div key={i} className="text-center text-[11px] text-muted-foreground font-medium">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-y-1">
            {/* Offset for first day */}
            {Array.from({ length: days[0].getDay() }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {days.map((day) => {
              const iso = isoDate(day);
              const isToday = iso === isoDate(today);
              const hasWorkout = activeDaySet.has(iso);
              return (
                <div key={iso} className="flex items-center justify-center aspect-square">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-medium ${
                      hasWorkout
                        ? 'bg-primary text-white'
                        : isToday
                        ? 'border-2 border-primary text-primary'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {day.getDate()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Workouts Per Week */}
        <div className="ios-section p-4">
          <div className="flex justify-between items-baseline mb-3">
            <span className="text-xs font-semibold text-primary uppercase tracking-wide">Activity</span>
          </div>
          <div className="flex justify-between items-baseline mb-4">
            <p className="font-semibold text-base">Workouts Per Week</p>
            <span className="text-sm text-muted-foreground">Ø{avgCount}</span>
          </div>

          {weeklyData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No workout data yet
            </div>
          ) : (
            <div className="flex items-end gap-1.5 h-32">
              {weeklyData.map((w) => {
                const height = maxCount > 0 ? (w.count / maxCount) * 100 : 0;
                const weekDate = new Date(w.week);
                const label = weekDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                return (
                  <div key={w.week} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex items-end" style={{ height: '96px' }}>
                      <div
                        className="w-full bg-primary rounded-sm min-h-[4px]"
                        style={{ height: `${Math.max(height, 4)}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-muted-foreground leading-none">{label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
