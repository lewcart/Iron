'use client';

import { db, getMeta, setMeta } from '@/db/local';
import { apiBase } from '@/lib/api/client';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

type SyncStatusListener = (status: SyncStatus) => void;

// ─── Sync Engine ───────────────────────────────────────────────────────────────

class SyncEngine {
  private _status: SyncStatus = 'idle';
  private _listeners = new Set<SyncStatusListener>();
  private _pushDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _periodicTimer: ReturnType<typeof setInterval> | null = null;

  get status(): SyncStatus {
    return this._status;
  }

  private setStatus(s: SyncStatus) {
    this._status = s;
    this._listeners.forEach(fn => fn(s));
  }

  subscribe(fn: SyncStatusListener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  // ─── Push: send unsynced local changes to server ──────────────────────────

  async push(): Promise<void> {
    if (!navigator.onLine) {
      this.setStatus('offline');
      return;
    }

    const [workouts, workout_exercises, workout_sets, bodyweight_logs] = await Promise.all([
      db.workouts.filter(r => !r._synced).toArray(),
      db.workout_exercises.filter(r => !r._synced).toArray(),
      db.workout_sets.filter(r => !r._synced).toArray(),
      db.bodyweight_logs.filter(r => !r._synced).toArray(),
    ]);

    const hasChanges =
      workouts.length + workout_exercises.length + workout_sets.length + bodyweight_logs.length > 0;
    if (!hasChanges) return;

    this.setStatus('syncing');
    try {
      const res = await fetch(`${apiBase()}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workouts, workout_exercises, workout_sets, bodyweight_logs }),
      });

      if (!res.ok) throw new Error(`Push failed: ${res.status}`);

      // Mark all as synced
      const now = Date.now();
      await Promise.all([
        db.workouts.bulkUpdate(workouts.map(r => ({ key: r.uuid, changes: { _synced: true, _updated_at: now } }))),
        db.workout_exercises.bulkUpdate(workout_exercises.map(r => ({ key: r.uuid, changes: { _synced: true, _updated_at: now } }))),
        db.workout_sets.bulkUpdate(workout_sets.map(r => ({ key: r.uuid, changes: { _synced: true, _updated_at: now } }))),
        db.bodyweight_logs.bulkUpdate(bodyweight_logs.map(r => ({ key: r.uuid, changes: { _synced: true, _updated_at: now } }))),
      ]);

      this.setStatus('idle');
    } catch {
      this.setStatus(navigator.onLine ? 'error' : 'offline');
    }
  }

  // ─── Pull: fetch server changes since last pull ───────────────────────────

  async pull(): Promise<void> {
    if (!navigator.onLine) {
      this.setStatus('offline');
      return;
    }

    const since = await getMeta('last_pull_at');
    const base = apiBase();
    const url = since ? `${base}/api/sync/pull?since=${encodeURIComponent(String(since))}` : `${base}/api/sync/pull`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Pull failed: ${res.status}`);

      const data = await res.json() as {
        workouts: import('@/db/local').LocalWorkout[];
        workout_exercises: import('@/db/local').LocalWorkoutExercise[];
        workout_sets: import('@/db/local').LocalWorkoutSet[];
        bodyweight_logs: import('@/db/local').LocalBodyweightLog[];
        deleted: { workouts: string[]; workout_exercises: string[]; workout_sets: string[]; bodyweight_logs: string[] };
        pulled_at: string;
      };

      // Upsert — server wins for conflicts (single-user, server is authoritative)
      // Use single Dexie transaction to avoid iOS WebKit IndexedDB limits
      await db.transaction('rw', db.workouts, db.workout_exercises, db.workout_sets, db.bodyweight_logs, async () => {
        if (data.workouts.length) await db.workouts.bulkPut(data.workouts.map(r => ({ ...r, _synced: true })));
        if (data.workout_exercises.length) await db.workout_exercises.bulkPut(data.workout_exercises.map(r => ({ ...r, _synced: true })));
        if (data.workout_sets.length) await db.workout_sets.bulkPut(data.workout_sets.map(r => ({ ...r, _synced: true })));
        if (data.bodyweight_logs.length) await db.bodyweight_logs.bulkPut(data.bodyweight_logs.map(r => ({ ...r, _synced: true })));
      });

      // Apply server-side deletes
      if (data.deleted) {
        await Promise.all([
          data.deleted.workouts?.length && db.workouts.bulkDelete(data.deleted.workouts),
          data.deleted.workout_exercises?.length && db.workout_exercises.bulkDelete(data.deleted.workout_exercises),
          data.deleted.workout_sets?.length && db.workout_sets.bulkDelete(data.deleted.workout_sets),
          data.deleted.bodyweight_logs?.length && db.bodyweight_logs.bulkDelete(data.deleted.bodyweight_logs),
        ]);
      }

      await setMeta('last_pull_at', data.pulled_at);
      this.setStatus('idle');
    } catch {
      this.setStatus(navigator.onLine ? 'error' : 'offline');
    }
  }

  // ─── Full sync: push then pull ────────────────────────────────────────────

  async sync(): Promise<void> {
    if (!navigator.onLine) {
      this.setStatus('offline');
      return;
    }
    this.setStatus('syncing');
    await this.push();
    await this.pull();
  }

  // ─── Debounced push (called after mutations) ──────────────────────────────

  schedulePush(delayMs = 500): void {
    if (this._pushDebounceTimer) clearTimeout(this._pushDebounceTimer);
    this._pushDebounceTimer = setTimeout(() => this.push(), delayMs);
  }

  // ─── Start periodic sync + network event listeners ────────────────────────

  start(): void {
    // Sync on app load
    this.sync();

    // Periodic pull (every 60s while app is open)
    this._periodicTimer = setInterval(() => {
      if (navigator.onLine) this.pull();
    }, 60_000);

    // Network recovery
    window.addEventListener('online', () => {
      this.setStatus('syncing');
      this.sync();
    });
    window.addEventListener('offline', () => this.setStatus('offline'));
  }

  stop(): void {
    if (this._periodicTimer) clearInterval(this._periodicTimer);
  }
}

export const syncEngine = new SyncEngine();
