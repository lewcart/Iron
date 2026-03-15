'use client';

import { useEffect, useState } from 'react';

interface StatsData {
  activeDays: string[];
  weeklyData: { week: string; count: number }[];
}

function formatDayLabel(date: Date) {
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function FeedPage() {
  const [stats, setStats] = useState<StatsData | null>(null);

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(setStats);
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

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-14 pb-4">
        <h1 className="text-2xl font-bold">Feed</h1>
      </div>

      <div className="px-4 space-y-4 pb-4">

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
