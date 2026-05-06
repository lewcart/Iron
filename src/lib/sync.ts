'use client';

import { db, getMeta, setMeta } from '@/db/local';
import { apiBase } from '@/lib/api/client';
import type {
  LocalWorkout,
  LocalWorkoutExercise,
  LocalWorkoutSet,
  LocalBodyweightLog,
  LocalExercise,
  LocalWorkoutPlan,
  LocalWorkoutRoutine,
  LocalWorkoutRoutineExercise,
  LocalWorkoutRoutineSet,
  LocalBodySpecLog,
  LocalMeasurementLog,
  LocalInbodyScan,
  LocalBodyGoal,
  LocalNutritionLog,
  LocalNutritionWeekMeal,
  LocalNutritionDayNote,
  LocalNutritionTarget,
  LocalHrtTimelinePeriod,
  LocalLabDraw,
  LocalLabResult,
  LocalWellbeingLog,
  LocalDysphoriaLog,
  LocalClothesTestLog,
  LocalProgressPhoto,
  LocalBodyVision,
  LocalBodyPlan,
  LocalPlanCheckpoint,
  LocalVisionMuscleOverride,
} from '@/db/local';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';
type SyncStatusListener = (status: SyncStatus) => void;

/** Rich error context captured on the most recent push/pull failure. The pill
 * formats this into a clipboard-friendly blob so Lou can paste a complete bug
 * report back to the assistant without having to dig through devtools. */
export interface SyncErrorDetails {
  kind: 'push' | 'pull';
  message: string;
  /** HTTP status if the failure was a non-2xx response. */
  status?: number;
  /** Full request URL that failed (push or pull endpoint). */
  url?: string;
  method?: 'GET' | 'POST';
  /** Response body (truncated to 2000 chars) if HTTP error. */
  responseBody?: string;
  /** ISO-8601 timestamp (with offset) when the error was captured. */
  at: string;
  /** Push only: per-table dirty row counts + a few sample uuids. */
  payloadSummary?: { table: string; count: number; sampleUuids: string[] }[];
  /** Pull only: change_log cursor at time of failure. */
  cursor?: number;
  /** JS error stack if available (truncated). */
  stack?: string;
  /** UA + page URL — helpful to know which device/route hit it. */
  userAgent?: string;
  pageUrl?: string;
}

/** Names of every Dexie table that participates in change_log sync. Order is
 * load-bearing on push: parents before children so foreign keys never reference
 * a not-yet-pushed row. */
const SYNCED_TABLES = [
  // Catalogs (parent of references). Read-only on the client; server is
  // authoritative. They participate in pull but push() is a no-op (no client
  // code writes dirty rows).
  'exercises',
  'muscles',
  // Workouts hierarchy
  'workouts', 'workout_exercises', 'workout_sets',
  // Plans hierarchy
  'workout_plans', 'workout_routines', 'workout_routine_exercises', 'workout_routine_sets',
  // Body
  'bodyweight_logs', 'body_spec_logs', 'measurement_logs', 'inbody_scans', 'body_goals',
  // Strategic layer (vision before plan — plan FK references vision; plan before checkpoint — checkpoint FK references plan)
  'body_vision', 'body_plan', 'plan_checkpoint',
  // Nutrition
  'nutrition_logs', 'nutrition_week_meals', 'nutrition_day_notes', 'nutrition_targets',
  // HRT timeline periods
  'hrt_timeline_periods',
  // Labs (draws before results — results reference draw_uuid)
  'lab_draws', 'lab_results',
  // Other logs
  'wellbeing_logs', 'dysphoria_logs', 'clothes_test_logs',
  // Photos (inspo_photos is local-only — no server table, no sync)
  'progress_photos',
  // AI-generated exercise demo image candidates (read-only client side;
  // server is sole writer, so push() naturally finds nothing dirty).
  'exercise_image_candidates',
  // Vision-aware MAV / frequency overrides (per-vision per-muscle).
  // Pushed after body_vision (FK).
  'vision_muscle_overrides',
] as const;
type SyncedTable = typeof SYNCED_TABLES[number];

interface ChangeLogEntry {
  seq: number;
  table_name: SyncedTable;
  row_uuid: string;
  op: 'insert' | 'update' | 'delete';
}

interface ChangesResponse {
  changes: ChangeLogEntry[];
  rows: Partial<Record<SyncedTable, Array<Record<string, unknown>>>>;
  max_seq: number;
  has_more: boolean;
}

interface PushPayload {
  workouts?: LocalWorkout[];
  workout_exercises?: LocalWorkoutExercise[];
  workout_sets?: LocalWorkoutSet[];
  bodyweight_logs?: LocalBodyweightLog[];
  exercises?: LocalExercise[];
  workout_plans?: LocalWorkoutPlan[];
  workout_routines?: LocalWorkoutRoutine[];
  workout_routine_exercises?: LocalWorkoutRoutineExercise[];
  workout_routine_sets?: LocalWorkoutRoutineSet[];
  body_spec_logs?: LocalBodySpecLog[];
  measurement_logs?: LocalMeasurementLog[];
  inbody_scans?: LocalInbodyScan[];
  body_goals?: LocalBodyGoal[];
  body_vision?: LocalBodyVision[];
  body_plan?: LocalBodyPlan[];
  plan_checkpoint?: LocalPlanCheckpoint[];
  nutrition_logs?: LocalNutritionLog[];
  nutrition_week_meals?: LocalNutritionWeekMeal[];
  nutrition_day_notes?: LocalNutritionDayNote[];
  nutrition_targets?: LocalNutritionTarget[];
  hrt_timeline_periods?: LocalHrtTimelinePeriod[];
  lab_draws?: LocalLabDraw[];
  lab_results?: LocalLabResult[];
  wellbeing_logs?: LocalWellbeingLog[];
  dysphoria_logs?: LocalDysphoriaLog[];
  clothes_test_logs?: LocalClothesTestLog[];
  progress_photos?: LocalProgressPhoto[];
  vision_muscle_overrides?: LocalVisionMuscleOverride[];
}

const PAGE_SIZE = 1000;
const POLL_INTERVAL_MS = 15_000;

// iOS WKWebView (and Safari) tear down the IndexedDB worker process when the
// app is suspended in the background. On resume, every existing IDB connection
// throws "UnknownError: Connection to Indexed Database server lost. Refresh
// the page to try again" and stays broken until the page reloads — Dexie can't
// reconnect on its own. We catch the error in push()/pull() and trigger a
// reload so the user doesn't get parked behind a red sync-error pill.
//
// 30s session-storage cooldown guards against a reload loop: if a reload
// happens and the same error fires again immediately, surface it normally
// instead of hammering reload forever.
function reloadIfIdbConnectionLost(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/Connection to Indexed Database server lost/i.test(msg)) return false;
  if (typeof window === 'undefined') return false;
  try {
    const last = Number(window.sessionStorage.getItem('__rebirth_idb_reload_at') ?? 0);
    if (Date.now() - last < 30_000) return false;
    window.sessionStorage.setItem('__rebirth_idb_reload_at', String(Date.now()));
  } catch {
    // sessionStorage unavailable — still attempt the reload
  }
  console.warn('[sync] IDB connection lost — reloading to reconnect');
  window.location.reload();
  return true;
}

// ─── Sync Engine ───────────────────────────────────────────────────────────────
//
// Architecture:
//
//   Postgres                            Client (Capacitor / web)
//   ──────────────────                  ───────────────────────────
//   change_log (BIGSERIAL seq)  ◀────┐
//   per-table CDC triggers           │
//                                    │  pull(): GET /api/sync/changes?since=
//                                    │    → fetch change_log rows + joined row data
//                                    │    → bulkPut/bulkDelete in Dexie tx
//                                    │    → setMeta('last_seq', max_seq)
//                                    │
//                                    │  push(): POST /api/sync/push
//                                    │    → send rows where _synced=false
//                                    │    → server upserts (CDC triggers fire,
//                                    │      bumping change_log)
//                                    │    → mark _synced=true locally
//                                    │
//                                    └─ visibilitychange + Capacitor
//                                       appStateChange = trigger pull
//                                       (consolidated in providers.tsx with
//                                        HealthKitResumeSync)
//
// Idempotent start(): no-op if already running. This matters because React
// StrictMode and route remounts can re-invoke start() — without idempotency
// we'd accumulate duplicate intervals and listeners, multiplying network
// traffic for every remount.

class SyncEngine {
  private _status: SyncStatus = 'idle';
  private _lastError: string | null = null;
  private _lastErrorDetails: SyncErrorDetails | null = null;
  private _listeners = new Set<SyncStatusListener>();
  private _pushDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _periodicTimer: ReturnType<typeof setInterval> | null = null;
  private _started = false;
  private _pulling = false;
  private _pushing = false;

  private _onOnline = () => { if (!document.hidden) this.sync(); };
  private _onOffline = () => this.setStatus('offline');
  private _onVisibility = () => {
    if (!document.hidden && navigator.onLine) this.sync();
  };

  get status(): SyncStatus { return this._status; }
  get lastError(): string | null { return this._lastError; }
  get lastErrorDetails(): SyncErrorDetails | null { return this._lastErrorDetails; }

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
    if (this._pushing) return;
    if (!navigator.onLine) { this.setStatus('offline'); return; }

    this._pushing = true;
    // Hoisted so the catch block can summarise what we tried to push when
    // building lastErrorDetails.
    const payload: PushPayload = {};
    try {
      // Read every dirty row across all synced tables in parallel.
      // _synced filter is a full-table scan (Dexie doesn't index booleans
      // well) but rows-per-table is small enough that this is sub-ms.
      const dirty = await Promise.all(
        SYNCED_TABLES.map(async name => {
          const rows = await (db as unknown as Record<string, { filter: (fn: (r: { _synced: boolean }) => boolean) => { toArray: () => Promise<Array<{ uuid?: string; metric_key?: string; id?: number }>> } }>)[name]
            .filter((r) => !r._synced)
            .toArray();
          return [name, rows] as const;
        }),
      );

      let total = 0;
      for (const [name, rows] of dirty) {
        if (rows.length > 0) {
          (payload as unknown as Record<string, unknown[]>)[name] = rows;
          total += rows.length;
        }
      }

      if (total === 0) {
        // Nothing dirty — if a previous push errored and the dirty rows have
        // since been resolved elsewhere (e.g. soft-deleted, or pulled fresh
        // from server), clear the stale error so the UI doesn't show a red
        // pill forever.
        if (this._status === 'error') {
          this._lastError = null;
          this._lastErrorDetails = null;
          this.setStatus('idle');
        }
        return;
      }

      this.setStatus('syncing');

      const url = `${apiBase()}/api/sync/push`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const httpErr = new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`) as Error & { _syncCtx?: { status: number; url: string; method: 'POST'; responseBody: string } };
        httpErr._syncCtx = { status: res.status, url, method: 'POST', responseBody: body.slice(0, 2000) };
        throw httpErr;
      }

      // Mark all pushed rows as synced. Hard-purge soft-deleted ones now that
      // the server has accepted the delete.
      const now = Date.now();
      await db.transaction('rw', SYNCED_TABLES.map(t => (db as unknown as Record<string, unknown>)[t]) as never, async () => {
        for (const [name, rows] of dirty) {
          if (rows.length === 0) continue;
          const table = (db as unknown as Record<string, { bulkUpdate: (patches: Array<{ key: string | number; changes: unknown }>) => Promise<unknown>; bulkDelete: (keys: Array<string | number>) => Promise<unknown> }>)[name];
          const keyOf = (r: { uuid?: string; metric_key?: string; id?: number }) =>
            r.uuid ?? r.metric_key ?? r.id!;
          const tombstones = rows.filter(r => (r as unknown as { _deleted: boolean })._deleted);
          const survivors = rows.filter(r => !(r as unknown as { _deleted: boolean })._deleted);
          if (tombstones.length > 0) {
            await table.bulkDelete(tombstones.map(keyOf));
          }
          if (survivors.length > 0) {
            await table.bulkUpdate(
              survivors.map(r => ({ key: keyOf(r), changes: { _synced: true, _updated_at: now } })),
            );
          }
        }
      });

      // Only clear push-origin errors. A prior pull error is still active and
      // its details must survive — otherwise sync() (push→pull) wipes the
      // pull's report and the SyncStatus pill ends up in error state with no
      // details to copy.
      if (this._lastError?.startsWith('push:')) {
        this._lastError = null;
        this._lastErrorDetails = null;
      }
      this.setStatus('idle');
    } catch (err) {
      if (reloadIfIdbConnectionLost(err)) return;
      const msg = err instanceof Error ? err.message : String(err);
      this._lastError = `push: ${msg}`;
      const ctx = (err as Error & { _syncCtx?: { status: number; url: string; method: 'POST'; responseBody: string } })._syncCtx;
      const payloadSummary = Object.entries(payload).map(([table, rows]) => ({
        table,
        count: (rows as unknown[]).length,
        sampleUuids: ((rows as Array<{ uuid?: string; metric_key?: string; id?: number | string }>) ?? [])
          .slice(0, 3)
          .map(r => String(r.uuid ?? r.metric_key ?? r.id ?? '?')),
      })).filter(s => s.count > 0);
      this._lastErrorDetails = {
        kind: 'push',
        message: msg,
        status: ctx?.status,
        url: ctx?.url,
        method: ctx?.method ?? 'POST',
        responseBody: ctx?.responseBody,
        at: new Date().toISOString(),
        payloadSummary,
        stack: err instanceof Error ? err.stack?.slice(0, 1500) : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
      };
      console.error('[sync] push error:', err);
      this.setStatus(navigator.onLine ? 'error' : 'offline');
    } finally {
      this._pushing = false;
    }
  }

  // ─── Pull: fetch server changes since last seq ────────────────────────────

  async pull(): Promise<void> {
    if (this._pulling) return;
    if (!navigator.onLine) { this.setStatus('offline'); return; }

    this._pulling = true;
    let cursor = Number(await getMeta('last_seq') ?? 0);
    let lastUrl: string | undefined;
    try {
      let pages = 0;
      const MAX_PAGES = 100; // safety cap — 100 pages × 1000 rows = 100k changes per pull

      while (pages < MAX_PAGES) {
        this.setStatus('syncing');
        const url = `${apiBase()}/api/sync/changes?since=${cursor}&limit=${PAGE_SIZE}`;
        lastUrl = url;
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const httpErr = new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`) as Error & { _syncCtx?: { status: number; url: string; method: 'GET'; responseBody: string } };
          httpErr._syncCtx = { status: res.status, url, method: 'GET', responseBody: body.slice(0, 2000) };
          throw httpErr;
        }

        const data = await res.json() as ChangesResponse;

        if (data.changes.length === 0) break;

        await this.applyChanges(data);

        cursor = data.max_seq;
        await setMeta('last_seq', cursor);

        if (!data.has_more) break;
        pages++;
      }

      // Symmetric with push(): only clear pull-origin errors so a prior push
      // failure's details survive. sync() runs push then pull; without this
      // guard a successful pull would wipe the push report.
      if (this._lastError?.startsWith('pull:')) {
        this._lastError = null;
        this._lastErrorDetails = null;
      }
      this.setStatus('idle');
    } catch (err) {
      if (reloadIfIdbConnectionLost(err)) return;
      const msg = err instanceof Error ? err.message : String(err);
      this._lastError = `pull: ${msg}`;
      const ctx = (err as Error & { _syncCtx?: { status: number; url: string; method: 'GET'; responseBody: string } })._syncCtx;
      this._lastErrorDetails = {
        kind: 'pull',
        message: msg,
        status: ctx?.status,
        url: ctx?.url ?? lastUrl,
        method: ctx?.method ?? 'GET',
        responseBody: ctx?.responseBody,
        at: new Date().toISOString(),
        cursor,
        stack: err instanceof Error ? err.stack?.slice(0, 1500) : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
      };
      console.error('[sync] pull error:', err);
      this.setStatus(navigator.onLine ? 'error' : 'offline');
    } finally {
      this._pulling = false;
    }
  }

  /** Apply one page of change_log entries + joined row data atomically. */
  private async applyChanges(data: ChangesResponse): Promise<void> {
    // Group changes by table → set of UUIDs to delete vs upsert.
    const deletes: Partial<Record<SyncedTable, Set<string>>> = {};
    for (const c of data.changes) {
      if (c.op === 'delete') {
        if (!deletes[c.table_name]) deletes[c.table_name] = new Set();
        deletes[c.table_name]!.add(c.row_uuid);
      }
    }

    // Apply in one transaction per table group so a crash mid-apply doesn't
    // produce a half-applied page (cursor only advances after this returns).
    const tableHandles = SYNCED_TABLES.map(t => (db as unknown as Record<string, unknown>)[t]) as never;
    await db.transaction('rw', tableHandles, async () => {
      for (const tableName of SYNCED_TABLES) {
        const table = (db as unknown as Record<string, { bulkPut: (rows: unknown[]) => Promise<unknown>; bulkDelete: (keys: Array<string | number>) => Promise<unknown> }>)[tableName];

        // Server-supplied rows (insert/update). Server already filters
        // tombstoned rows out — we only see live data here.
        const rows = data.rows[tableName];
        if (rows && rows.length > 0) {
          const stamped = rows.map(r => ({
            ...r,
            // Lowercase exercise_uuid references for case-stable lookups.
            ...(tableName === 'workout_exercises' || tableName === 'workout_routine_exercises'
              ? { exercise_uuid: String((r as { exercise_uuid: string }).exercise_uuid).toLowerCase() }
              : {}),
            // Lowercase exercises.uuid itself.
            ...(tableName === 'exercises'
              ? { uuid: String((r as { uuid: string }).uuid).toLowerCase() }
              : {}),
            // progress_photos pulled from the server are already uploaded
            // (server only stores the Vercel URL); backfill the offline-
            // capture fields so downstream readers don't deal with
            // undefined.
            ...(tableName === 'progress_photos'
              ? { uploaded: '1' as const, blob: null }
              : {}),
            _synced: true,
            _updated_at: Date.now(),
            _deleted: false,
          }));
          await table.bulkPut(stamped);
        }

        // Apply hard deletes from change_log.
        const dels = deletes[tableName];
        if (dels && dels.size > 0) {
          await table.bulkDelete([...dels]);
        }
      }
    });
  }

  // ─── Full sync ────────────────────────────────────────────────────────────

  async sync(): Promise<void> {
    if (!navigator.onLine) { this.setStatus('offline'); return; }
    this.setStatus('syncing');
    await this.push();
    const statusAfterPush = this._status;
    await this.pull();
    if (statusAfterPush === 'error' && this._status === 'idle') {
      this.setStatus('error');
    }
  }

  // ─── Debounced push ──────────────────────────────────────────────────────

  schedulePush(delayMs = 500): void {
    if (this._pushDebounceTimer) clearTimeout(this._pushDebounceTimer);
    this._pushDebounceTimer = setTimeout(() => this.push(), delayMs);
  }

  // ─── Cursor reset for newly-tracked tables ───────────────────────────────
  //
  // When a new table is added to SYNCED_TABLES, devices that already advanced
  // last_seq past the table's CDC inserts will never see those rows — sync
  // only pulls forward, and the prior pull silently dropped any change_log
  // entries for tables it didn't recognise. Bump SYNC_RESET_VERSION on every
  // such addition: each device runs the reset exactly once and re-pulls from
  // seq 0. Existing rows survive (sync is idempotent bulkPut). Unsynced
  // dirty rows survive (last_seq doesn't gate push).
  //
  //   v1 (2026-05-03): backfill body_vision/body_plan/plan_checkpoint added
  //                    to SYNCED_TABLES on 2026-05-01 (commit 36a4f41).
  private static readonly SYNC_RESET_VERSION = 1;
  private async ensureSyncResetBaseline(): Promise<void> {
    const current = Number(await getMeta('sync_reset_version') ?? 0);
    if (current >= SyncEngine.SYNC_RESET_VERSION) return;
    await setMeta('last_seq', 0);
    await setMeta('sync_reset_version', SyncEngine.SYNC_RESET_VERSION);
  }

  // ─── Lifecycle (idempotent) ──────────────────────────────────────────────

  start(): void {
    if (this._started) return;
    this._started = true;

    void this.ensureSyncResetBaseline().then(() => this.sync());

    // Poll every 15s, but only when document is visible — backgrounded tabs
    // shouldn't burn cellular data. visibilitychange listener picks up the
    // catch-up sync when the user returns to the app.
    //
    // Calls full sync() (push + pull) rather than pull() alone so a stuck
    // 'error' state self-heals on the next poll once the underlying cause
    // (e.g. a missing migration column the server has since gained) is fixed.
    // push() early-returns when nothing is dirty, so the cost is one Dexie
    // dirty-row scan per tick when push is a no-op — sub-millisecond.
    this._periodicTimer = setInterval(() => {
      if (navigator.onLine && !document.hidden) this.sync();
    }, POLL_INTERVAL_MS);

    window.addEventListener('online', this._onOnline);
    window.addEventListener('offline', this._onOffline);
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  stop(): void {
    if (!this._started) return;
    this._started = false;
    if (this._periodicTimer) {
      clearInterval(this._periodicTimer);
      this._periodicTimer = null;
    }
    if (this._pushDebounceTimer) {
      clearTimeout(this._pushDebounceTimer);
      this._pushDebounceTimer = null;
    }
    window.removeEventListener('online', this._onOnline);
    window.removeEventListener('offline', this._onOffline);
    document.removeEventListener('visibilitychange', this._onVisibility);
  }
}

export const syncEngine = new SyncEngine();
