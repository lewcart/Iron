'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/local';
import type {
  LocalHrtTimelinePeriod,
  LocalLabDraw,
  LocalLabResult,
} from '@/db/local';
import { LAB_DEFINITIONS, type LabDefinition } from '@/lib/lab-definitions';

// ─── HRT timeline periods ────────────────────────────────────────────────────

export function useHrtTimelinePeriods(): LocalHrtTimelinePeriod[] {
  return useLiveQuery(
    async () => {
      const all = await db.hrt_timeline_periods.filter(p => !p._deleted).toArray();
      return all.sort((a, b) => b.started_at.localeCompare(a.started_at));
    },
    [],
    [],
  );
}

export function useActiveHrtTimelinePeriod(): LocalHrtTimelinePeriod | null {
  return useLiveQuery(
    async () => {
      const all = await db.hrt_timeline_periods
        .filter(p => !p._deleted && !p.ended_at)
        .toArray();
      const sorted = all.sort((a, b) => b.started_at.localeCompare(a.started_at));
      return sorted[0] ?? null;
    },
    [],
    null,
  );
}

// ─── Lab definitions (compile-time constant) ─────────────────────────────────

export function useLabDefinitions(): LabDefinition[] {
  return LAB_DEFINITIONS;
}

// ─── Lab draws + results ─────────────────────────────────────────────────────

export function useLabDraws(): LocalLabDraw[] {
  return useLiveQuery(
    async () => {
      const all = await db.lab_draws.filter(d => !d._deleted).toArray();
      return all.sort((a, b) => b.drawn_at.localeCompare(a.drawn_at));
    },
    [],
    [],
  );
}

export function useLabResults(): LocalLabResult[] {
  return useLiveQuery(
    async () => db.lab_results.filter(r => !r._deleted).toArray(),
    [],
    [],
  );
}

/** Results indexed by lab_code → array of {drawn_at, value} sorted oldest → newest. */
export function useLabSeries(labCode: string): Array<{ drawn_at: string; value: number }> {
  return useLiveQuery(
    async () => {
      const draws = await db.lab_draws.filter(d => !d._deleted).toArray();
      const drawById = new Map(draws.map(d => [d.uuid, d]));
      const results = await db.lab_results
        .filter(r => !r._deleted && r.lab_code === labCode)
        .toArray();
      return results
        .map(r => {
          const d = drawById.get(r.draw_uuid);
          return d ? { drawn_at: d.drawn_at, value: r.value } : null;
        })
        .filter((x): x is { drawn_at: string; value: number } => x !== null)
        .sort((a, b) => a.drawn_at.localeCompare(b.drawn_at));
    },
    [labCode],
    [],
  );
}
