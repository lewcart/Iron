'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/local';
import type {
  LocalMeasurementLog,
  LocalBodySpecLog,
  LocalInbodyScan,
  LocalBodyGoal,
  LocalProgressPhoto,
} from '@/db/local';

// ─── Measurement logs (circumferences) ───────────────────────────────────────

export function useMeasurements(opts: {
  site?: string;
  limit?: number;
} = {}): LocalMeasurementLog[] {
  const { site, limit = 90 } = opts;
  return useLiveQuery(
    async () => {
      const query = site
        ? db.measurement_logs.where('site').equals(site)
        : db.measurement_logs.toCollection();
      const all = await query.filter(m => !m._deleted).toArray();
      return all
        .sort((a, b) => b.measured_at.localeCompare(a.measured_at))
        .slice(0, limit);
    },
    [site, limit],
    [],
  );
}

// ─── Body spec logs ──────────────────────────────────────────────────────────

export function useBodySpecLogs(limit = 30): LocalBodySpecLog[] {
  return useLiveQuery(
    async () => {
      const all = await db.body_spec_logs.filter(b => !b._deleted).toArray();
      return all
        .sort((a, b) => b.measured_at.localeCompare(a.measured_at))
        .slice(0, limit);
    },
    [limit],
    [],
  );
}

// ─── InBody scans ────────────────────────────────────────────────────────────

export function useInbodyScans(limit = 50): LocalInbodyScan[] {
  return useLiveQuery(
    async () => {
      const all = await db.inbody_scans.filter(s => !s._deleted).toArray();
      return all
        .sort((a, b) => b.scanned_at.localeCompare(a.scanned_at))
        .slice(0, limit);
    },
    [limit],
    [],
  );
}

export function useInbodyScan(uuid: string | null): LocalInbodyScan | undefined {
  return useLiveQuery(
    () => (uuid ? db.inbody_scans.get(uuid) : undefined),
    [uuid],
  );
}

// ─── Body goals (metric_key keyed) ───────────────────────────────────────────

export function useBodyGoals(): LocalBodyGoal[] {
  return useLiveQuery(
    () => db.body_goals.filter(g => !g._deleted).toArray(),
    [],
    [],
  );
}

export function useBodyGoal(metric_key: string | null): LocalBodyGoal | undefined {
  return useLiveQuery(
    () => (metric_key ? db.body_goals.get(metric_key) : undefined),
    [metric_key],
  );
}

// ─── Progress photos ─────────────────────────────────────────────────────────

export function useProgressPhotos(limit = 50): LocalProgressPhoto[] {
  return useLiveQuery(
    async () => {
      const all = await db.progress_photos.filter(p => !p._deleted).toArray();
      return all
        .sort((a, b) => b.taken_at.localeCompare(a.taken_at))
        .slice(0, limit);
    },
    [limit],
    [],
  );
}
