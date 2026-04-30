'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { uuid as genUUID } from '@/lib/uuid';
import type {
  LocalWellbeingLog,
  LocalDysphoriaLog,
  LocalClothesTestLog,
} from '@/db/local';

// Mutations for the three wellbeing tabs:
// - wellbeing_logs (mood / energy / sleep / stress)
// - dysphoria_logs (gender expression scale)
// - clothes_test_logs (outfit comfort + euphoria)
//
// All three follow the same single-table append-or-tombstone shape:
// no parent/child cascades, no exotic fields.

function now() {
  return Date.now();
}

function syncMeta() {
  return { _synced: false as const, _updated_at: now(), _deleted: false as const };
}

// ─── Wellbeing logs ──────────────────────────────────────────────────────────

export async function logWellbeing(opts: {
  mood?: number | null;
  energy?: number | null;
  sleep_hours?: number | null;
  sleep_quality?: number | null;
  stress?: number | null;
  notes?: string | null;
}): Promise<LocalWellbeingLog> {
  const log: LocalWellbeingLog = {
    uuid: genUUID(),
    logged_at: new Date().toISOString(),
    mood: opts.mood ?? null,
    energy: opts.energy ?? null,
    sleep_hours: opts.sleep_hours ?? null,
    sleep_quality: opts.sleep_quality ?? null,
    stress: opts.stress ?? null,
    notes: opts.notes?.trim() || null,
    ...syncMeta(),
  };
  await db.wellbeing_logs.add(log);
  syncEngine.schedulePush();
  return log;
}

export async function deleteWellbeingLog(uuid: string): Promise<void> {
  await db.wellbeing_logs.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── Dysphoria logs ──────────────────────────────────────────────────────────

export async function logDysphoria(opts: {
  scale: number;
  note?: string | null;
}): Promise<LocalDysphoriaLog> {
  const log: LocalDysphoriaLog = {
    uuid: genUUID(),
    logged_at: new Date().toISOString(),
    scale: opts.scale,
    note: opts.note?.trim() || null,
    ...syncMeta(),
  };
  await db.dysphoria_logs.add(log);
  syncEngine.schedulePush();
  return log;
}

export async function deleteDysphoriaLog(uuid: string): Promise<void> {
  await db.dysphoria_logs.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── Clothes test logs ───────────────────────────────────────────────────────

export async function logClothesTest(opts: {
  outfit_description: string;
  comfort_rating?: number | null;
  euphoria_rating?: number | null;
  notes?: string | null;
  photo_url?: string | null;
}): Promise<LocalClothesTestLog> {
  const log: LocalClothesTestLog = {
    uuid: genUUID(),
    logged_at: new Date().toISOString(),
    outfit_description: opts.outfit_description.trim(),
    photo_url: opts.photo_url ?? null,
    comfort_rating: opts.comfort_rating ?? null,
    euphoria_rating: opts.euphoria_rating ?? null,
    notes: opts.notes?.trim() || null,
    ...syncMeta(),
  };
  await db.clothes_test_logs.add(log);
  syncEngine.schedulePush();
  return log;
}

export async function deleteClothesTestLog(uuid: string): Promise<void> {
  await db.clothes_test_logs.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}
