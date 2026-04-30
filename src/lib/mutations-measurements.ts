'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { uuid as genUUID } from '@/lib/uuid';
import type {
  LocalMeasurementLog,
  LocalBodySpecLog,
  LocalInbodyScan,
  LocalBodyGoal,
  LocalProgressPhoto,
} from '@/db/local';

// Mutations for the measurements page surface:
// - measurement_logs (circumference measurements, indexed by site)
// - body_spec_logs (height/weight/body-fat/lean-mass snapshots)
// - inbody_scans (full scan with 50+ fields)
// - body_goals (target metrics, keyed by metric_key)
// - progress_photos (URL pointer + pose; upload itself stays through
//   the existing /api/progress-photos/upload route)

function now() { return Date.now(); }
function syncMeta() {
  return { _synced: false as const, _updated_at: now(), _deleted: false as const };
}

// ─── Measurement logs (circumferences) ───────────────────────────────────────

export async function logMeasurement(opts: {
  site: string;
  value_cm: number;
  notes?: string | null;
  measured_at?: string;
  source?: string | null;
  source_ref?: string | null;
}): Promise<LocalMeasurementLog> {
  const log: LocalMeasurementLog = {
    uuid: genUUID(),
    site: opts.site,
    value_cm: opts.value_cm,
    notes: opts.notes?.trim() || null,
    measured_at: opts.measured_at ?? new Date().toISOString(),
    source: opts.source ?? null,
    source_ref: opts.source_ref ?? null,
    ...syncMeta(),
  };
  await db.measurement_logs.add(log);
  syncEngine.schedulePush();
  return log;
}

export async function deleteMeasurement(uuid: string): Promise<void> {
  await db.measurement_logs.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── Body spec logs (height/weight/BF%/lean) ─────────────────────────────────

export async function logBodySpec(opts: {
  height_cm?: number | null;
  weight_kg?: number | null;
  body_fat_pct?: number | null;
  lean_mass_kg?: number | null;
  notes?: string | null;
  measured_at?: string;
}): Promise<LocalBodySpecLog> {
  const log: LocalBodySpecLog = {
    uuid: genUUID(),
    height_cm: opts.height_cm ?? null,
    weight_kg: opts.weight_kg ?? null,
    body_fat_pct: opts.body_fat_pct ?? null,
    lean_mass_kg: opts.lean_mass_kg ?? null,
    notes: opts.notes?.trim() || null,
    measured_at: opts.measured_at ?? new Date().toISOString(),
    ...syncMeta(),
  };
  await db.body_spec_logs.add(log);
  syncEngine.schedulePush();
  return log;
}

export async function deleteBodySpec(uuid: string): Promise<void> {
  await db.body_spec_logs.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── InBody scans ────────────────────────────────────────────────────────────

export async function upsertInbodyScan(scan: Omit<LocalInbodyScan, '_synced' | '_updated_at' | '_deleted'>): Promise<void> {
  await db.inbody_scans.put({ ...scan, ...syncMeta() });
  syncEngine.schedulePush();
}

export async function deleteInbodyScan(uuid: string): Promise<void> {
  await db.inbody_scans.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── Body goals (metric_key keyed) ───────────────────────────────────────────

export async function setBodyGoal(opts: {
  metric_key: string;
  target_value: number;
  unit: string;
  direction: 'higher' | 'lower' | 'match';
  notes?: string | null;
}): Promise<void> {
  const existing = await db.body_goals.get(opts.metric_key);
  const goal: LocalBodyGoal = {
    metric_key: opts.metric_key,
    target_value: opts.target_value,
    unit: opts.unit,
    direction: opts.direction,
    notes: opts.notes?.trim() || existing?.notes || null,
    ...syncMeta(),
  };
  await db.body_goals.put(goal);
  syncEngine.schedulePush();
}

export async function deleteBodyGoal(metric_key: string): Promise<void> {
  await db.body_goals.update(metric_key, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── Progress photos (metadata only — Blob upload via /api/progress-photos/upload) ──

export async function recordProgressPhoto(opts: {
  blob_url: string;
  pose: 'front' | 'side' | 'back';
  notes?: string | null;
  taken_at?: string;
}): Promise<LocalProgressPhoto> {
  const photo: LocalProgressPhoto = {
    uuid: genUUID(),
    blob_url: opts.blob_url,
    pose: opts.pose,
    notes: opts.notes?.trim() || null,
    taken_at: opts.taken_at ?? new Date().toISOString(),
    ...syncMeta(),
  };
  await db.progress_photos.add(photo);
  syncEngine.schedulePush();
  return photo;
}

export async function deleteProgressPhoto(uuid: string): Promise<void> {
  await db.progress_photos.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}
