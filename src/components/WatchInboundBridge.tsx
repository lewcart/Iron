'use client';

import { useEffect } from 'react';
import { subscribeToWatchInbound } from '@/lib/watch';
import { updateSet } from '@/lib/mutations';
import { db } from '@/db/local';
import {
  startRestTimer,
  endRestTimer,
  extendRestTimer,
  resolveRestSec,
  isAutoRestEnabled,
} from '@/lib/rest-timer-state';

export interface WatchSetRow {
  uuid?: string;
  workout_exercise_uuid?: string | null;
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

interface WatchInboundEvent {
  kind: string;
  payload?: Record<string, unknown>;
}

export interface WatchInboundDeps {
  applySet: (uuid: string, fields: Record<string, unknown>) => Promise<unknown>;
  startRest: (args: { setUuid: string; restSec: number; exerciseName?: string; setNumber?: number; completedAtMs?: number }) => unknown;
  endRest: (opts?: { setUuid?: string }) => void;
  extendRest: (args: { setUuid?: string; seconds: number }) => void;
  /** Looks up the workout_exercise + exercise + set-position metadata that
   *  the bridge needs for a fresh set-completion auto-rest. */
  lookupExerciseContext: (workoutExerciseUuid: string, setUuid: string) => Promise<{
    exerciseUuid: string;
    exerciseName?: string;
    setNumber?: number;
  } | null>;
  resolveRestSec: (opts: { exerciseUuid?: string | null }) => number;
  autoRestEnabled: () => boolean;
  /** Used for the queued-stale guard. Defaults to Date.now in production. */
  now: () => number;
}

// Watch-stamp can drift 30-60s vs phone clock over BLE pairing — at 30s,
// every fresh completion looked stale and rest auto-start was silently
// suppressed. 90s tolerates typical drift while still rejecting genuinely
// queued-stale messages from a watch that was out of range for minutes.
const QUEUED_STALE_THRESHOLD_MS = 90_000;
/** If watch-stamp is missing or implausibly far in the future relative to
 *  phone receipt time (clock drift can also push it forward), treat the
 *  message as fresh by using the bridge's own receipt time as the anchor. */
const FUTURE_DRIFT_TOLERANCE_MS = 60_000;

interface WatchInboundPayload extends Record<string, unknown> {
  row?: WatchSetRow;
  /** Watch-stamped epoch ms. The bridge skips rest auto-start if the
   *  message is more than QUEUED_STALE_THRESHOLD_MS old (out-of-range
   *  scenario where startRest would otherwise begin minutes late). */
  completed_at_ms?: number;
  set_uuid?: string;
  seconds?: number;
}

/** Pure inbound-event handler. Exposed so it can be unit-tested against
 *  injected dependencies without React or Dexie. */
export async function handleWatchInboundEvent(event: WatchInboundEvent, deps: WatchInboundDeps): Promise<void> {
  const payload = (event.payload as WatchInboundPayload | undefined) ?? {};

  if (event.kind === 'watchWroteSet') {
    const row = payload.row;
    if (!row || typeof row.uuid !== 'string') return;

    await deps.applySet(row.uuid, {
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

    // Auto-rest derivation. Only when the set transitioned to completed
    // AND the watch event isn't a queued-stale (out-of-range) message —
    // starting a rest timer for a set Lou completed 5 minutes ago is
    // worse than not starting one at all.
    if (!row.is_completed) return;
    if (!deps.autoRestEnabled()) return;

    // Queued-stale guard with receipt-time fallback for clock skew. The watch
    // stamps `completed_at_ms` from its own clock, which can drift relative to
    // phone clock. If the stamp is missing or implausibly far in the future
    // (skew can push it either direction), use the bridge's receipt time.
    const watchCompletedAtMs = typeof payload.completed_at_ms === 'number' ? payload.completed_at_ms : null;
    const receivedAtMs = deps.now();
    const effectiveCompletedAtMs = watchCompletedAtMs == null || watchCompletedAtMs > receivedAtMs + FUTURE_DRIFT_TOLERANCE_MS
      ? receivedAtMs
      : watchCompletedAtMs;
    if (receivedAtMs - effectiveCompletedAtMs > QUEUED_STALE_THRESHOLD_MS) return;

    if (typeof row.workout_exercise_uuid !== 'string') return;
    const ctx = await deps.lookupExerciseContext(row.workout_exercise_uuid, row.uuid);
    if (!ctx) return;
    const restSec = deps.resolveRestSec({ exerciseUuid: ctx.exerciseUuid });
    deps.startRest({
      setUuid: row.uuid,
      restSec,
      exerciseName: ctx.exerciseName,
      setNumber: ctx.setNumber,
      completedAtMs: effectiveCompletedAtMs,
    });
    return;
  }

  if (event.kind === 'stopRest') {
    const setUuid = typeof payload.set_uuid === 'string' ? payload.set_uuid : undefined;
    deps.endRest({ setUuid });
    return;
  }

  if (event.kind === 'extendRest') {
    const setUuid = typeof payload.set_uuid === 'string' ? payload.set_uuid : undefined;
    const seconds = typeof payload.seconds === 'number' ? payload.seconds : 30;
    deps.extendRest({ setUuid, seconds });
    return;
  }
}

/** Mounted at the root layout. Phone is the single writer; the watch never
 *  makes its own network calls. The watch sends three kinds of inbound
 *  message via WC.transferUserInfo (`watchWroteSet`, `stopRest`,
 *  `extendRest`); this component subscribes and applies them.
 *
 *  See docs/watch-architecture.md and docs/watch-replan.md. */
export function WatchInboundBridge() {
  useEffect(() => {
    const deps: WatchInboundDeps = {
      applySet: (uuid, fields) => updateSet(uuid, fields as Parameters<typeof updateSet>[1]),
      startRest: (args) => startRestTimer(args),
      endRest: (opts) => endRestTimer(opts),
      extendRest: (args) => extendRestTimer(args),
      lookupExerciseContext: async (workoutExerciseUuid, setUuid) => {
        const we = await db.workout_exercises.get(workoutExerciseUuid);
        if (!we) return null;
        const ex = await db.exercises.get(we.exercise_uuid);
        const sets = await db.workout_sets.where({ workout_exercise_uuid: workoutExerciseUuid }).toArray();
        const live = sets.filter((s) => !s._deleted).sort((a, b) => a.order_index - b.order_index);
        const idx = live.findIndex((s) => s.uuid === setUuid);
        return {
          exerciseUuid: we.exercise_uuid,
          exerciseName: ex?.title ?? undefined,
          setNumber: idx >= 0 ? idx + 1 : undefined,
        };
      },
      resolveRestSec: (opts) => resolveRestSec(opts),
      autoRestEnabled: () => isAutoRestEnabled(),
      now: () => Date.now(),
    };
    const unsubscribe = subscribeToWatchInbound((event) => {
      void handleWatchInboundEvent(event, deps);
    });
    return () => unsubscribe();
  }, []);
  return null;
}
