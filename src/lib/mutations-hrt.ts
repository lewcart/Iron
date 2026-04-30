'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { uuid as genUUID } from '@/lib/uuid';
import type {
  LocalHrtLog,
  LocalHrtProtocol,
} from '@/db/local';

// Mutations for HRT tracking:
// - hrt_logs (individual dose-takings, optionally linked to a protocol)
// - hrt_protocols (active medication regimen schedules)

function now() { return Date.now(); }
function syncMeta() {
  return { _synced: false as const, _updated_at: now(), _deleted: false as const };
}

// ─── HRT dose logs ───────────────────────────────────────────────────────────

export async function logHrtDose(opts: {
  medication: string;
  dose_mg?: number | null;
  route?: 'injection' | 'topical' | 'oral' | 'patch' | 'other' | null;
  notes?: string | null;
  taken?: boolean;
  hrt_protocol_uuid?: string | null;
  logged_at?: string;
}): Promise<LocalHrtLog> {
  const log: LocalHrtLog = {
    uuid: genUUID(),
    logged_at: opts.logged_at ?? new Date().toISOString(),
    medication: opts.medication.trim(),
    dose_mg: opts.dose_mg ?? null,
    route: opts.route ?? null,
    notes: opts.notes?.trim() || null,
    taken: opts.taken ?? true,
    hrt_protocol_uuid: opts.hrt_protocol_uuid ?? null,
    ...syncMeta(),
  };
  await db.hrt_logs.add(log);
  syncEngine.schedulePush();
  return log;
}

export async function updateHrtTaken(uuid: string, taken: boolean): Promise<void> {
  await db.hrt_logs.update(uuid, { taken, ...syncMeta() });
  syncEngine.schedulePush();
}

export async function deleteHrtLog(uuid: string): Promise<void> {
  await db.hrt_logs.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── HRT protocols ───────────────────────────────────────────────────────────

export async function createHrtProtocol(opts: {
  medication: string;
  dose_description: string;
  form: 'gel' | 'patch' | 'injection' | 'oral' | 'other';
  started_at: string;
  ended_at?: string | null;
  includes_blocker?: boolean;
  blocker_name?: string | null;
  notes?: string | null;
}): Promise<LocalHrtProtocol> {
  const protocol: LocalHrtProtocol = {
    uuid: genUUID(),
    medication: opts.medication.trim(),
    dose_description: opts.dose_description.trim(),
    form: opts.form,
    started_at: opts.started_at,
    ended_at: opts.ended_at ?? null,
    includes_blocker: opts.includes_blocker ?? false,
    blocker_name: opts.blocker_name?.trim() || null,
    notes: opts.notes?.trim() || null,
    ...syncMeta(),
  };
  await db.hrt_protocols.add(protocol);
  syncEngine.schedulePush();
  return protocol;
}

export async function updateHrtProtocol(
  uuid: string,
  patch: Partial<Omit<LocalHrtProtocol, 'uuid' | '_synced' | '_updated_at' | '_deleted'>>,
): Promise<void> {
  await db.hrt_protocols.update(uuid, { ...patch, ...syncMeta() });
  syncEngine.schedulePush();
}

export async function endHrtProtocol(uuid: string, endedAt?: string): Promise<void> {
  await db.hrt_protocols.update(uuid, {
    ended_at: endedAt ?? new Date().toISOString().slice(0, 10),
    ...syncMeta(),
  });
  syncEngine.schedulePush();
}

export async function deleteHrtProtocol(uuid: string): Promise<void> {
  await db.hrt_protocols.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}
