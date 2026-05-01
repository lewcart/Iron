'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/local';
import type { LocalBodyVision, LocalBodyPlan, LocalPlanCheckpoint } from '@/db/local';

// ─── Vision ──────────────────────────────────────────────────────────────────

export function useActiveVision(): LocalBodyVision | null | undefined {
  return useLiveQuery(
    async () => {
      const all = await db.body_vision
        .filter(v => !v._deleted && v.status === 'active')
        .toArray();
      return all[0] ?? null;
    },
    [],
    undefined,
  );
}

// ─── Plan ────────────────────────────────────────────────────────────────────

export function useActivePlan(): LocalBodyPlan | null | undefined {
  return useLiveQuery(
    async () => {
      const all = await db.body_plan
        .filter(p => !p._deleted && p.status === 'active')
        .toArray();
      return all[0] ?? null;
    },
    [],
    undefined,
  );
}

// ─── Checkpoints ─────────────────────────────────────────────────────────────

export function useCheckpointsForPlan(planId: string | undefined): LocalPlanCheckpoint[] {
  return useLiveQuery(
    async () => {
      if (!planId) return [];
      const all = await db.plan_checkpoint
        .filter(c => !c._deleted && c.plan_id === planId)
        .toArray();
      return all.sort((a, b) => a.target_date.localeCompare(b.target_date));
    },
    [planId],
    [],
  );
}
