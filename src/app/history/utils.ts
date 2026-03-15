import type { Workout } from '@/types';

export interface WorkoutSummary extends Workout {
  exercise_count: number;
  total_volume: number;
}

// ===== Formatting helpers =====

export function formatDuration(start: string, end: string | null): string {
  if (!end) return 'In progress';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ===== Grouping logic =====

export type GroupMode = 'week' | 'month';

export interface WorkoutGroup {
  label: string;
  workouts: WorkoutSummary[];
}

/**
 * Returns the Monday of the ISO week containing `date`, at local midnight.
 */
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Formats a Date as a local-date string "YYYY-MM-DD" without timezone conversion. */
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekKey(date: Date): string {
  const monday = startOfWeek(date);
  return localDateString(monday); // e.g. "2026-03-09"
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function weekLabel(mondayIso: string, today: Date): string {
  // Parse the key as a local date (same convention as weekKey)
  const [y, m, d] = mondayIso.split('-').map(Number);
  const monday = new Date(y, m - 1, d);
  monday.setHours(0, 0, 0, 0);

  const thisMonday = startOfWeek(today);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);

  if (monday.getTime() === thisMonday.getTime()) return 'This Week';
  if (monday.getTime() === lastMonday.getTime()) return 'Last Week';

  return `Week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function monthLabel(monthIso: string): string {
  const [year, month] = monthIso.split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function groupWorkouts(
  workouts: WorkoutSummary[],
  mode: GroupMode,
  today: Date = new Date(),
): WorkoutGroup[] {
  const buckets = new Map<string, WorkoutSummary[]>();

  for (const w of workouts) {
    const d = new Date(w.start_time);
    const key = mode === 'week' ? weekKey(d) : monthKey(d);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(w);
  }

  const groups: WorkoutGroup[] = [];
  for (const [key, ws] of buckets) {
    const label = mode === 'week' ? weekLabel(key, today) : monthLabel(key);
    groups.push({ label, workouts: ws });
  }

  return groups;
}
