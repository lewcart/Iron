'use client';

import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Workout } from '@/types';
import WorkoutDetail from './WorkoutDetail';

function formatDuration(start: string, end: string | null) {
  if (!end) return 'In progress';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}`;
  return `${m}m`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export default function HistoryPage() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Workout | null>(null);

  useEffect(() => {
    fetch('/api/workouts?limit=50')
      .then(r => r.json())
      .then(data => { setWorkouts(data); setLoading(false); });
  }, []);

  if (selected) {
    return <WorkoutDetail workout={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-14 pb-4 flex justify-between items-baseline">
        <h1 className="text-2xl font-bold">History</h1>
      </div>

      {loading ? (
        <p className="text-center py-12 text-muted-foreground text-sm">Loading…</p>
      ) : workouts.length === 0 ? (
        <div className="px-4">
          <div className="ios-section">
            <p className="text-center py-12 text-muted-foreground text-sm">
              Your finished workouts will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="px-4">
          <div className="ios-section">
            {workouts.map((w, i) => (
              <button
                key={w.uuid}
                onClick={() => setSelected(w)}
                className={`ios-row w-full text-left ${i === workouts.length - 1 ? 'border-0' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {w.title || formatDate(w.start_time)}
                  </p>
                  {!w.title && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(w.start_time).toLocaleDateString('en-US', { weekday: 'long' })}
                      {', '}
                      {new Date(w.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                  {w.title && (
                    <p className="text-xs text-muted-foreground mt-0.5">{formatDate(w.start_time)}</p>
                  )}
                  {w.comment && (
                    <p className="text-xs text-muted-foreground italic mt-0.5 truncate">&ldquo;{w.comment}&rdquo;</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                  <span className="text-xs border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                    {formatDuration(w.start_time, w.end_time)}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
