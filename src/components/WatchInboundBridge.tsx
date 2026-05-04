'use client';

import { useEffect } from 'react';
import { subscribeToWatchInbound } from '@/lib/watch';
import { updateSet } from '@/lib/mutations';

interface WatchSetRow {
  uuid?: string;
  weight?: number | null;
  repetitions?: number | null;
  duration_seconds?: number | null;
  rir?: number | null;
  is_completed?: boolean;
  is_pr?: boolean;
  excluded_from_pb?: boolean;
  rpe?: number | null;
  tag?: string | null;
  comment?: string | null;
  min_target_reps?: number | null;
  max_target_reps?: number | null;
  order_index?: number;
}

/** Mounted at the root layout. The watch sends every set-completion as a
 *  WC.transferUserInfo with kind="watchWroteSet" and a `row` payload. We
 *  apply the row to Dexie via `updateSet`, which automatically schedules
 *  a server push through the existing sync engine. The watch sees the new
 *  state on the next snapshot push that the workout-page useEffect fires
 *  in response to its Dexie live query updating. */
export function WatchInboundBridge() {
  useEffect(() => {
    const unsubscribe = subscribeToWatchInbound((event) => {
      if (event.kind !== 'watchWroteSet') return;
      const row = (event.payload as { row?: WatchSetRow } | undefined)?.row;
      if (!row || typeof row.uuid !== 'string') return;
      void updateSet(row.uuid, {
        weight: row.weight ?? null,
        repetitions: row.repetitions ?? null,
        duration_seconds: row.duration_seconds ?? null,
        rir: row.rir ?? null,
        is_completed: row.is_completed ?? false,
        is_pr: row.is_pr ?? false,
        excluded_from_pb: row.excluded_from_pb ?? false,
        rpe: row.rpe ?? null,
        tag: (row.tag === 'dropSet' || row.tag === 'failure') ? row.tag : null,
        comment: row.comment ?? null,
        min_target_reps: row.min_target_reps ?? null,
        max_target_reps: row.max_target_reps ?? null,
        ...(typeof row.order_index === 'number' ? { order_index: row.order_index } : {}),
      });
    });
    return () => unsubscribe();
  }, []);
  return null;
}
