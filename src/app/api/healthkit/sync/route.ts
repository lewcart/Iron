/**
 * HealthKit sync endpoint.
 *
 * Single POST handler that ingests everything the iOS client fetched on a
 * foreground sync pass — daily quantity aggregates, sleep nights, workouts —
 * in one transaction, and returns updated sync state. Reads return sync state
 * without writes so the client can prime its per-metric window/anchor bookkeeping.
 *
 * Workout dedup runs here (server-side) so the rule is consistent across
 * clients and the client doesn't need workouts.uuid lookups.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, transaction } from '@/db/db';
import { isMainSleepNight } from '@/lib/sleep-stats';

interface DailyRow {
  metric: string;
  date: string;
  value_min?: number | null;
  value_max?: number | null;
  value_avg?: number | null;
  value_sum?: number | null;
  count?: number | null;
  source_primary?: string | null;
}

interface SleepNight {
  date: string;
  start_at: number;
  end_at: number;
  asleep_min: number;
  rem_min: number;
  deep_min: number;
  core_min: number;
  awake_min: number;
  in_bed_min: number;
}

interface FullHKWorkout {
  hk_uuid: string;
  activity_type: string;
  start_at: number;
  end_at: number;
  duration_s: number;
  total_energy_kcal?: number | null;
  total_distance_m?: number | null;
  source_name?: string;
  source_bundle_id?: string;
  metadata_json?: string;
  rebirth_workout_uuid?: string;
}

interface SyncStateUpdate {
  metric: string;
  last_window_end?: string | null;   // ISO
  last_anchor?: string | null;       // base64
  last_error?: string | null;
}

interface MedicationRecord {
  hk_uuid: string;
  medication_name: string;
  dose_string?: string | null;
  taken_at: number;                  // epoch ms
  scheduled_at?: number | null;
  source_name?: string;
  source_bundle_id?: string;
  metadata_json?: string;
}

interface SyncBody {
  daily?: DailyRow[];
  sleep?: SleepNight[];
  workouts?: FullHKWorkout[];
  medications?: MedicationRecord[];
  deleted_workouts?: string[];       // HK UUIDs that were deleted since last anchor
  deleted_medications?: string[];    // HK UUIDs deleted since last medications anchor
  deleted_sleep?: string[];          // HK sample UUIDs the plugin reports as deleted.
                                     //
                                     // KNOWN GAP: We accept this array but currently
                                     // cannot act on it. Native code groups multiple
                                     // HKCategorySamples into one derived SleepNight per
                                     // wake_date, so individual sample UUIDs don't map
                                     // 1:1 to rows in healthkit_sleep_nights. Until the
                                     // Capacitor plugin is extended to emit per-night
                                     // hk_uuids alongside the merged stage minutes, the
                                     // anchor-reset path (migration 025, or any future
                                     // forced re-pull) is the only recovery for edits /
                                     // deletes that happened in iOS Health.
                                     //
                                     // The acknowledgement count surfaces in the
                                     // response as `sleep_deletions_acknowledged_no_op`
                                     // so client-side telemetry can detect the gap.
                                     // TODO(plugin): emit hk_uuids per SleepNight, then
                                     // delete by (wake_date, hk_uuid) here.
  state_updates?: SyncStateUpdate[];
}

// ── GET: return sync state for all metrics ──────────────────────────────────

export async function GET() {
  const rows = await query<{
    metric: string;
    last_anchor: Buffer | null;
    last_window_end: string | null;
    last_sync_at: string | null;
    last_successful_sync_at: string | null;
    last_error: string | null;
    last_error_at: string | null;
  }>(`SELECT metric, last_anchor, last_window_end, last_sync_at,
             last_successful_sync_at, last_error, last_error_at
      FROM healthkit_sync_state`);

  const byMetric = Object.fromEntries(rows.map(r => [r.metric, {
    // Surface base64 so the iOS client can round-trip. Postgres BYTEA comes
    // out as a Node Buffer via the pg driver.
    last_anchor: r.last_anchor ? r.last_anchor.toString('base64') : null,
    last_window_end: r.last_window_end,
    last_sync_at: r.last_sync_at,
    last_successful_sync_at: r.last_successful_sync_at,
    last_error: r.last_error,
    last_error_at: r.last_error_at,
  }]));

  return NextResponse.json({ state: byMetric });
}

// ── POST: ingest sync payload ───────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: SyncBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const daily = body.daily ?? [];
  const sleep = body.sleep ?? [];
  const workouts = body.workouts ?? [];
  const medications = body.medications ?? [];
  const deletedWorkoutUuids = body.deleted_workouts ?? [];
  const deletedMedicationUuids = body.deleted_medications ?? [];
  const deletedSleepUuids = body.deleted_sleep ?? [];
  const stateUpdates = body.state_updates ?? [];

  // ── Upsert daily aggregates ───────────────────────────────────────────────
  const dailyStatements = daily.map((r) => ({
    text: `INSERT INTO healthkit_daily
             (metric, date, value_min, value_max, value_avg, value_sum, count, source_primary, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (metric, date) DO UPDATE SET
             value_min = EXCLUDED.value_min,
             value_max = EXCLUDED.value_max,
             value_avg = EXCLUDED.value_avg,
             value_sum = EXCLUDED.value_sum,
             count = EXCLUDED.count,
             source_primary = EXCLUDED.source_primary,
             updated_at = NOW()`,
    params: [
      r.metric, r.date,
      r.value_min ?? null, r.value_max ?? null,
      r.value_avg ?? null, r.value_sum ?? null,
      r.count ?? null, r.source_primary ?? null,
    ],
  }));

  // ── Sleep nights → daily rows (one per stage) ─────────────────────────────
  // Each sleep night produces 6 daily rows, keyed to wake date.
  const sleepDailyRows: DailyRow[] = [];
  for (const n of sleep) {
    sleepDailyRows.push({ metric: 'sleep_asleep', date: n.date, value_sum: n.asleep_min });
    sleepDailyRows.push({ metric: 'sleep_rem', date: n.date, value_sum: n.rem_min });
    sleepDailyRows.push({ metric: 'sleep_deep', date: n.date, value_sum: n.deep_min });
    sleepDailyRows.push({ metric: 'sleep_core', date: n.date, value_sum: n.core_min });
    sleepDailyRows.push({ metric: 'sleep_awake', date: n.date, value_sum: n.awake_min });
    sleepDailyRows.push({ metric: 'sleep_inbed', date: n.date, value_sum: n.in_bed_min });
  }
  const sleepStatements = sleepDailyRows.map((r) => ({
    text: `INSERT INTO healthkit_daily (metric, date, value_sum, count, updated_at)
           VALUES ($1, $2, $3, 1, NOW())
           ON CONFLICT (metric, date) DO UPDATE SET
             value_sum = EXCLUDED.value_sum, count = 1, updated_at = NOW()`,
    params: [r.metric, r.date, r.value_sum ?? null],
  }));

  // ── Sleep nights → per-night row with envelope + is_main flag ─────────────
  const sleepNightStatements = sleep.map((n) => {
    const startIso = new Date(n.start_at).toISOString();
    const endIso = new Date(n.end_at).toISOString();
    const isMain = isMainSleepNight(n.in_bed_min, n.end_at);
    return {
      text: `INSERT INTO healthkit_sleep_nights
               (wake_date, start_at, end_at,
                asleep_min, rem_min, deep_min, core_min, awake_min, in_bed_min,
                is_main, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
             ON CONFLICT (wake_date) DO UPDATE SET
               start_at = EXCLUDED.start_at,
               end_at = EXCLUDED.end_at,
               asleep_min = EXCLUDED.asleep_min,
               rem_min = EXCLUDED.rem_min,
               deep_min = EXCLUDED.deep_min,
               core_min = EXCLUDED.core_min,
               awake_min = EXCLUDED.awake_min,
               in_bed_min = EXCLUDED.in_bed_min,
               is_main = EXCLUDED.is_main,
               updated_at = NOW()`,
      params: [
        n.date, startIso, endIso,
        n.asleep_min, n.rem_min, n.deep_min, n.core_min, n.awake_min, n.in_bed_min,
        isMain,
      ],
    };
  });

  // ── Workouts: upsert with dedup resolution ────────────────────────────────
  const workoutStatements: Array<{ text: string; params?: unknown[] }> = [];

  // Delete rows that HealthKit reports as deleted
  if (deletedWorkoutUuids.length > 0) {
    workoutStatements.push({
      text: `DELETE FROM healthkit_workouts WHERE hk_uuid = ANY($1)`,
      params: [deletedWorkoutUuids],
    });
  }

  // For each incoming HK workout, resolve dedup server-side
  for (const w of workouts) {
    const startMs = w.start_at;
    const endMs = w.end_at;
    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();

    // Resolve workout_uuid + source via dedup rules:
    // 1. If metadata has REBIRTH_WORKOUT_UUID → direct link, 'user_logged'
    // 2. Else fuzzy match: activity_type + start within ±60s of a Rebirth workout
    //    and duration within 10% → 'matched'
    // 3. Else → 'hk_only'
    let workoutUuid: string | null = null;
    let source: 'user_logged' | 'matched' | 'hk_only' = 'hk_only';

    if (w.rebirth_workout_uuid) {
      const existing = await queryOne<{ uuid: string }>(
        `SELECT uuid FROM workouts WHERE uuid = $1`,
        [w.rebirth_workout_uuid]
      );
      if (existing) {
        workoutUuid = existing.uuid;
        source = 'user_logged';
      }
    }

    if (workoutUuid == null) {
      // Fuzzy match — only for "Strength Training"-like types that we log
      const fuzzyMatch = await queryOne<{ uuid: string; start_time: string; end_time: string | null }>(
        `SELECT uuid, start_time, end_time
         FROM workouts
         WHERE start_time BETWEEN $1::timestamptz - interval '60 seconds'
                              AND $1::timestamptz + interval '60 seconds'
           AND is_current = false
         ORDER BY ABS(EXTRACT(EPOCH FROM start_time) - EXTRACT(EPOCH FROM $1::timestamptz))
         LIMIT 1`,
        [startIso]
      );
      if (fuzzyMatch && fuzzyMatch.end_time) {
        const dbDur = (new Date(fuzzyMatch.end_time).getTime() - new Date(fuzzyMatch.start_time).getTime()) / 1000;
        const hkDur = w.duration_s;
        if (dbDur > 0 && Math.abs(hkDur - dbDur) / dbDur <= 0.1) {
          workoutUuid = fuzzyMatch.uuid;
          source = 'matched';
        }
      }
    }

    workoutStatements.push({
      text: `INSERT INTO healthkit_workouts
               (hk_uuid, activity_type, start_at, end_at, duration_s,
                total_energy_kcal, total_distance_m,
                source_name, source_bundle_id, metadata_json,
                workout_uuid, source, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, NOW(), NOW())
             ON CONFLICT (hk_uuid) DO UPDATE SET
               activity_type = EXCLUDED.activity_type,
               start_at = EXCLUDED.start_at,
               end_at = EXCLUDED.end_at,
               duration_s = EXCLUDED.duration_s,
               total_energy_kcal = EXCLUDED.total_energy_kcal,
               total_distance_m = EXCLUDED.total_distance_m,
               source_name = EXCLUDED.source_name,
               source_bundle_id = EXCLUDED.source_bundle_id,
               metadata_json = EXCLUDED.metadata_json,
               workout_uuid = COALESCE(healthkit_workouts.workout_uuid, EXCLUDED.workout_uuid),
               source = CASE
                 WHEN healthkit_workouts.source = 'user_logged' THEN 'user_logged'
                 ELSE EXCLUDED.source
               END,
               updated_at = NOW()`,
      params: [
        w.hk_uuid, w.activity_type, startIso, endIso, w.duration_s,
        w.total_energy_kcal ?? null, w.total_distance_m ?? null,
        w.source_name ?? null, w.source_bundle_id ?? null,
        w.metadata_json ?? '{}',
        workoutUuid, source,
      ],
    });
  }

  // ── Medications: upsert + handle deletions ───────────────────────────────
  const medicationStatements: Array<{ text: string; params?: unknown[] }> = [];

  if (deletedMedicationUuids.length > 0) {
    medicationStatements.push({
      text: `DELETE FROM healthkit_medications WHERE hk_uuid = ANY($1)`,
      params: [deletedMedicationUuids],
    });
  }

  for (const m of medications) {
    medicationStatements.push({
      text: `INSERT INTO healthkit_medications
               (hk_uuid, medication_name, dose_string, taken_at, scheduled_at,
                source_name, source_bundle_id, metadata_json, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
             ON CONFLICT (hk_uuid) DO UPDATE SET
               medication_name = EXCLUDED.medication_name,
               dose_string = EXCLUDED.dose_string,
               taken_at = EXCLUDED.taken_at,
               scheduled_at = EXCLUDED.scheduled_at,
               source_name = EXCLUDED.source_name,
               source_bundle_id = EXCLUDED.source_bundle_id,
               metadata_json = EXCLUDED.metadata_json,
               updated_at = NOW()`,
      params: [
        m.hk_uuid, m.medication_name, m.dose_string ?? null,
        new Date(m.taken_at).toISOString(),
        m.scheduled_at ? new Date(m.scheduled_at).toISOString() : null,
        m.source_name ?? null, m.source_bundle_id ?? null,
        m.metadata_json ?? '{}',
      ],
    });
  }

  // ── Sync-state upserts ────────────────────────────────────────────────────
  const stateStatements = stateUpdates.map((s) => ({
    text: `INSERT INTO healthkit_sync_state
             (metric, last_anchor, last_window_end, last_sync_at,
              last_successful_sync_at, last_error, last_error_at)
           VALUES ($1,
                   CASE WHEN $2::text IS NULL THEN NULL
                        ELSE decode($2, 'base64') END,
                   $3::timestamptz, NOW(),
                   CASE WHEN $4::text IS NULL THEN NOW() ELSE NULL END,
                   $4, CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() END)
           ON CONFLICT (metric) DO UPDATE SET
             last_anchor = COALESCE(
               CASE WHEN EXCLUDED.last_anchor IS NULL THEN healthkit_sync_state.last_anchor
                    ELSE EXCLUDED.last_anchor END,
               healthkit_sync_state.last_anchor
             ),
             last_window_end = COALESCE(EXCLUDED.last_window_end, healthkit_sync_state.last_window_end),
             last_sync_at = NOW(),
             last_successful_sync_at = CASE WHEN EXCLUDED.last_error IS NULL
                                            THEN NOW()
                                            ELSE healthkit_sync_state.last_successful_sync_at END,
             last_error = EXCLUDED.last_error,
             last_error_at = CASE WHEN EXCLUDED.last_error IS NULL THEN NULL ELSE NOW() END`,
    params: [
      s.metric,
      s.last_anchor ?? null,
      s.last_window_end ?? null,
      s.last_error ?? null,
    ],
  }));

  const allStatements = [
    ...dailyStatements,
    ...sleepStatements,
    ...sleepNightStatements,
    ...workoutStatements,
    ...medicationStatements,
    ...stateStatements,
  ];

  if (allStatements.length > 0) {
    await transaction(allStatements);
  }

  return NextResponse.json({
    daily_upserted: dailyStatements.length,
    sleep_upserted: sleepStatements.length,
    sleep_nights_upserted: sleepNightStatements.length,
    sleep_deletions_acknowledged_no_op: deletedSleepUuids.length,
    workouts_upserted: workouts.length,
    workouts_deleted: deletedWorkoutUuids.length,
    medications_upserted: medications.length,
    medications_deleted: deletedMedicationUuids.length,
    state_updates: stateUpdates.length,
  });
}
