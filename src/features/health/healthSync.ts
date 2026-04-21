/**
 * HealthKit → server sync orchestrator. Runs in the Capacitor app (device has
 * HealthKit; server doesn't). Called on app resume, Settings mount, or an
 * explicit "Sync now" tap.
 *
 * Flow:
 *   1. GET /api/healthkit/sync  → per-metric state (window_end / anchor)
 *   2. For each quantity metric: fetchDailyAggregates with 2-day overlap
 *   3. fetchSleepNights with anchor
 *   4. fetchWorkouts with anchor
 *   5. POST /api/healthkit/sync with all results + new state
 *   6. mirrorPendingWrites(): mirror new/edited meals + InBody scans → HK
 *
 * Failures per-metric are isolated — one broken metric doesn't stop the rest.
 */

import {
  HealthKit,
  QUANTITY_METRICS,
  type DailyAggregateRow,
  type SleepNight,
  type FullHKWorkout,
  type WrittenSample,
} from '@/lib/healthkit';
import { apiBase } from '@/lib/api/client';
import { markPermissionsRequested } from './healthService';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MetricSyncState {
  last_anchor: string | null;         // base64
  last_window_end: string | null;     // ISO
  last_sync_at: string | null;
  last_successful_sync_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

export type SyncStateByMetric = Record<string, MetricSyncState>;

export interface SyncResult {
  ok: boolean;
  reason?: 'unavailable' | 'not_requested' | 'revoked' | 'network' | 'unknown';
  metrics_synced: number;
  workouts_synced: number;
  nights_synced: number;
  samples_mirrored: number;
  duration_ms: number;
}

interface PendingNutrition {
  uuid: string;
  logged_at: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  hydration_ml: number | null;
}

interface PendingInbody {
  uuid: string;
  scanned_at: string;
  weight_kg: number | null;
  pbf_pct: number | null;
  smm_kg: number | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const BACKFILL_DAYS = 90;
const OVERLAP_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Public API ───────────────────────────────────────────────────────────────

/** Idempotent foreground sync. Safe to call on every app resume. */
export async function runForegroundSync(): Promise<SyncResult> {
  const started = performance.now();
  const metricsSyncedSet = new Set<string>();
  let workoutsSynced = 0;
  let nightsSynced = 0;

  try {
    const { available } = await HealthKit.isAvailable();
    if (!available) {
      return emptyResult('unavailable', started);
    }
  } catch {
    return emptyResult('unknown', started);
  }
  // Note: we don't gate on localStorage here. HealthKit reads are silent on
  // denied permissions (return empty), not sheet-triggering. If a metric comes
  // back with zero data, the server-state-based UI handles that gracefully.

  let state: SyncStateByMetric = {};
  try {
    const res = await fetch(`${apiBase()}/api/healthkit/sync`);
    if (res.ok) state = ((await res.json()) as { state: SyncStateByMetric }).state ?? {};
  } catch {
    // Treat as empty state — first sync.
  }

  const now = Date.now();
  const backfillStart = now - BACKFILL_DAYS * DAY_MS;

  // ── Quantity metrics ──────────────────────────────────────────────────────
  const dailyRows: DailyAggregateRow[] = [];
  const quantityStateUpdates: Array<{ metric: string; last_window_end: string; last_error: string | null }> = [];

  for (const metric of QUANTITY_METRICS) {
    try {
      const prev = state[metric];
      const startMs = prev?.last_window_end
        ? new Date(prev.last_window_end).getTime() - OVERLAP_DAYS * DAY_MS
        : backfillStart;
      const { results } = await HealthKit.fetchDailyAggregates({
        metrics: [metric],
        startTime: startMs,
        endTime: now,
      });
      dailyRows.push(...results);
      metricsSyncedSet.add(metric);
      quantityStateUpdates.push({
        metric,
        last_window_end: new Date(now).toISOString(),
        last_error: null,
      });
    } catch (e) {
      quantityStateUpdates.push({
        metric,
        last_window_end: state[metric]?.last_window_end ?? new Date(backfillStart).toISOString(),
        last_error: errorMessage(e),
      });
    }
  }

  // ── Sleep (anchored) ──────────────────────────────────────────────────────
  let sleep: SleepNight[] = [];
  let sleepAnchor: string | null = null;
  let sleepError: string | null = null;
  try {
    const prev = state['sleep'];
    const startMs = prev?.last_anchor ? backfillStart : backfillStart;
    const { nights, nextAnchor } = await HealthKit.fetchSleepNights({
      startTime: startMs,
      endTime: now,
      anchor: prev?.last_anchor ?? undefined,
    });
    sleep = nights;
    sleepAnchor = nextAnchor;
    nightsSynced = nights.length;
    metricsSyncedSet.add('sleep');
  } catch (e) {
    sleepError = errorMessage(e);
  }

  // ── Workouts (anchored) ───────────────────────────────────────────────────
  let workouts: FullHKWorkout[] = [];
  let deletedWorkoutUuids: string[] = [];
  let workoutAnchor: string | null = null;
  let workoutError: string | null = null;
  try {
    const prev = state['workouts'];
    const startMs = prev?.last_anchor ? backfillStart : backfillStart;
    const { workouts: fetched, deleted, nextAnchor } = await HealthKit.fetchWorkouts({
      startTime: startMs,
      endTime: now,
      anchor: prev?.last_anchor ?? undefined,
    });
    workouts = fetched;
    deletedWorkoutUuids = deleted;
    workoutAnchor = nextAnchor;
    workoutsSynced = fetched.length;
    metricsSyncedSet.add('workouts');
  } catch (e) {
    workoutError = errorMessage(e);
  }

  // ── POST everything in one sync call ──────────────────────────────────────
  const stateUpdates = [
    ...quantityStateUpdates,
    { metric: 'sleep', last_anchor: sleepAnchor, last_error: sleepError },
    { metric: 'workouts', last_anchor: workoutAnchor, last_error: workoutError },
  ];

  try {
    await fetch(`${apiBase()}/api/healthkit/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        daily: dailyRows,
        sleep,
        workouts,
        deleted_workouts: deletedWorkoutUuids,
        state_updates: stateUpdates,
      }),
    });
  } catch {
    return { ...emptyResult('network', started), metrics_synced: metricsSyncedSet.size };
  }

  // ── Mirror pending nutrition + InBody writes to HK ────────────────────────
  let samplesMirrored = 0;
  try {
    samplesMirrored = await mirrorPendingWrites();
  } catch {
    // Mirror failures shouldn't fail the whole sync.
  }

  return {
    ok: true,
    metrics_synced: metricsSyncedSet.size,
    workouts_synced: workoutsSynced,
    nights_synced: nightsSynced,
    samples_mirrored: samplesMirrored,
    duration_ms: Math.round(performance.now() - started),
  };
}

/**
 * Request HealthKit permissions, mark that we've asked, and kick off first sync.
 * Called from the Connect button in Settings.
 */
export async function connectHealthKit(): Promise<SyncResult> {
  const { granted } = await HealthKit.requestPermissions();
  markPermissionsRequested();
  if (!granted) {
    return emptyResult('revoked', performance.now());
  }
  return runForegroundSync();
}

// ── Mirror pending nutrition + InBody writes to HK ───────────────────────────

export async function mirrorPendingWrites(): Promise<number> {
  let pending: { nutrition: PendingNutrition[]; inbody: PendingInbody[] };
  try {
    const res = await fetch(`${apiBase()}/api/healthkit/pending-mirror`);
    if (!res.ok) return 0;
    pending = await res.json();
  } catch {
    return 0;
  }

  let samplesWritten = 0;

  // Nutrition
  for (const meal of pending.nutrition) {
    try {
      // Read existing writeback rows and delete stale HK samples first.
      const existingRes = await fetch(
        `${apiBase()}/api/healthkit/writeback?source_kind=meal&source_uuid=${encodeURIComponent(meal.uuid)}`
      );
      if (existingRes.ok) {
        const { samples: prior } = (await existingRes.json()) as {
          samples: Array<{ hk_type: string; hk_uuid: string; pending_delete: boolean }>;
        };
        if (prior.length > 0) {
          await HealthKit.deleteSamples({ uuids: prior.map(s => s.hk_uuid) }).catch(() => undefined);
        }
      }

      const { samples } = await HealthKit.saveNutrition({
        timestamp: new Date(meal.logged_at).getTime(),
        mealUuid: meal.uuid,
        kcal: meal.calories ?? undefined,
        proteinG: meal.protein_g ?? undefined,
        carbsG: meal.carbs_g ?? undefined,
        fatG: meal.fat_g ?? undefined,
        waterMl: meal.hydration_ml ?? undefined,
      });
      samplesWritten += samples.length;
      await postWriteback('meal', meal.uuid, samples);
    } catch {
      // Skip this meal; retry next sync.
    }
  }

  // InBody
  for (const scan of pending.inbody) {
    try {
      const existingRes = await fetch(
        `${apiBase()}/api/healthkit/writeback?source_kind=inbody&source_uuid=${encodeURIComponent(scan.uuid)}`
      );
      if (existingRes.ok) {
        const { samples: prior } = (await existingRes.json()) as {
          samples: Array<{ hk_type: string; hk_uuid: string }>;
        };
        if (prior.length > 0) {
          await HealthKit.deleteSamples({ uuids: prior.map(s => s.hk_uuid) }).catch(() => undefined);
        }
      }

      const { samples } = await HealthKit.saveBodyComposition({
        timestamp: new Date(scan.scanned_at).getTime(),
        inbodyUuid: scan.uuid,
        weightKg: scan.weight_kg ?? undefined,
        bodyFatPct: scan.pbf_pct ?? undefined,
        // Use SMM (skeletal muscle mass) as the lean-mass proxy — most apps that
        // consume "leanBodyMass" treat it as SMM-ish for fitness purposes.
        leanKg: scan.smm_kg ?? undefined,
      });
      samplesWritten += samples.length;
      await postWriteback('inbody', scan.uuid, samples);
    } catch {
      // Skip this scan; retry next sync.
    }
  }

  return samplesWritten;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function postWriteback(
  kind: 'meal' | 'inbody' | 'workout',
  uuid: string,
  samples: WrittenSample[],
): Promise<void> {
  if (samples.length === 0) return;
  await fetch(`${apiBase()}/api/healthkit/writeback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_kind: kind, source_uuid: uuid, samples }),
  }).catch(() => undefined);
}

function emptyResult(reason: SyncResult['reason'], started: number): SyncResult {
  return {
    ok: false,
    reason,
    metrics_synced: 0,
    workouts_synced: 0,
    nights_synced: 0,
    samples_mirrored: 0,
    duration_ms: Math.round(performance.now() - started),
  };
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
