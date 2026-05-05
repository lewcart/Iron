// Watch companion bridge — TS side.
//
// Builds an `ActiveWorkoutSnapshot` from in-memory phone state and pushes
// it to the iOS Capacitor `WatchConnectivityPlugin`, which encodes + persists
// it to the App Group container and forwards to the watch via WCSession.
//
// Snapshot keys + types must match RebirthShared/Sources/RebirthModels/
// ActiveWorkoutSnapshot.swift exactly. Drift = decode failures on watch.

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { LocalWorkoutWithExercises } from '@/lib/useLocalDB';
import { REP_WINDOWS, type RepWindow } from '@/lib/rep-windows';

// ─────────────────────────────────────────────────────────────────────────
// Snapshot types — mirror RebirthModels Swift structs.
// ─────────────────────────────────────────────────────────────────────────

export type WatchTrackingMode = 'reps' | 'time';

export interface WatchRepWindow {
  goal: string;
  min_reps: number;
  max_reps: number;
}

export interface WatchSet {
  uuid: string;
  workout_exercise_uuid: string;
  order_index: number;
  is_completed: boolean;
  target_weight: number | null;
  target_reps: number | null;
  target_duration_seconds: number | null;
  actual_weight: number | null;
  actual_reps: number | null;
  actual_duration_seconds: number | null;
  rir: number | null;
  /** Round-trip-only fields: watch echoes them in CDC payload so /api/sync/push
   *  doesn't NULL out server columns the watch didn't touch. */
  min_target_reps: number | null;
  max_target_reps: number | null;
  rpe: number | null;
  tag: 'dropSet' | 'failure' | null;
  comment: string | null;
  is_pr: boolean;
  excluded_from_pb: boolean;
}

export interface WatchExerciseHistory {
  last_session_date: string | null;
  sets: WatchSet[];
}

export interface WatchExercise {
  routine_exercise_uuid: string;
  workout_exercise_uuid: string;
  name: string;
  tracking_mode: WatchTrackingMode;
  rep_window: WatchRepWindow | null;
  sets: WatchSet[];
  history: WatchExerciseHistory | null;
}

export interface WatchSnapshot {
  workout_uuid: string;
  pushed_at: string;
  current_exercise_index: number;
  exercises: WatchExercise[];
  rest_timer_default_seconds: number;
}

export interface WatchSetMutation {
  set_uuid: string;
  workout_exercise_uuid: string;
  weight: number | null;
  repetitions: number | null;
  duration_seconds: number | null;
  rir: number | null;
  is_completed: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Capacitor plugin handle
// ─────────────────────────────────────────────────────────────────────────

interface WatchConnectivityPlugin {
  pushActiveWorkout(options: { snapshot: WatchSnapshot }): Promise<{ delivered: boolean }>;
  pushSetMutation(options: { mutation: WatchSetMutation }): Promise<{ queued: boolean }>;
  getWatchPaired(): Promise<{ isPaired: boolean; isReachable: boolean; isWatchAppInstalled: boolean }>;
}

const WatchConnectivity = registerPlugin<WatchConnectivityPlugin>('WatchConnectivity');

const isNativeIOS = () => Capacitor.getPlatform() === 'ios';

// ─────────────────────────────────────────────────────────────────────────
// Snapshot builder — pure function.
// ─────────────────────────────────────────────────────────────────────────

interface BuildSnapshotInput {
  workout: LocalWorkoutWithExercises;
  /** Map of routine_exercise_uuid OR exercise_uuid → goal_window key. The
   *  workout page already caches this in `goalWindowByExercise` state. */
  goalWindowByExercise: Map<string, RepWindow | null>;
  /** Optional history hint per exercise_uuid → last completed session sets.
   *  Caller fetches via getLastSessionSetsForExercise. */
  historyByExercise?: Map<string, { date: string | null; sets: import('@/db/local').LocalWorkoutSet[] }>;
  /** Default rest timer seconds; defaults to 90 if not provided. */
  restTimerDefaultSeconds?: number;
}

export function buildWatchSnapshot(input: BuildSnapshotInput): WatchSnapshot {
  const { workout, goalWindowByExercise, historyByExercise, restTimerDefaultSeconds = 90 } = input;

  // Sort exercises by order_index defensively (already sorted by useLocalDB
  // but watch decode is strict).
  const exercises = [...workout.exercises].sort((a, b) => a.order_index - b.order_index);

  const watchExercises: WatchExercise[] = exercises.map((ex) => {
    const sets = [...ex.sets].sort((a, b) => a.order_index - b.order_index);
    const trackingMode: WatchTrackingMode = ex.exercise.tracking_mode === 'time' ? 'time' : 'reps';

    const goal = goalWindowByExercise.get(ex.exercise.uuid)
      ?? goalWindowByExercise.get(ex.uuid)
      ?? null;
    const repWindow: WatchRepWindow | null = goal
      ? { goal, min_reps: REP_WINDOWS[goal].min, max_reps: REP_WINDOWS[goal].max }
      : null;

    const history = historyByExercise?.get(ex.exercise.uuid);
    const watchHistory: WatchExerciseHistory | null = history
      ? {
          last_session_date: history.date,
          sets: history.sets.slice(0, 10).map(toWatchSet),
        }
      : null;

    return {
      // The plan needs `routine_exercise_uuid` for set targets; if the workout
      // wasn't started from a routine, fall back to the workout_exercise UUID.
      // This keeps the schema stable; watch UI uses `workout_exercise_uuid` for
      // server writes and ignores routine_exercise when null/synthetic.
      routine_exercise_uuid: ex.uuid,
      workout_exercise_uuid: ex.uuid,
      name: ex.exercise.title,
      tracking_mode: trackingMode,
      rep_window: repWindow,
      sets: sets.map(toWatchSet),
      history: watchHistory,
    };
  });

  // Current exercise = first exercise with at least one incomplete set, or 0.
  let currentExerciseIndex = watchExercises.findIndex((e) => e.sets.some((s) => !s.is_completed));
  if (currentExerciseIndex < 0) currentExerciseIndex = 0;

  return {
    workout_uuid: workout.uuid,
    pushed_at: new Date().toISOString(),
    current_exercise_index: currentExerciseIndex,
    exercises: watchExercises,
    rest_timer_default_seconds: restTimerDefaultSeconds,
  };
}

/** Cap per-set comment payload so a long note can't blow the 50KB WC envelope.
 *  Watch UI doesn't render comments — but the watch echoes them on CDC writes
 *  to avoid NULLing the server column on round-trip, so we keep them present
 *  but truncate. Long comments persist on phone Dexie unaffected. */
const COMMENT_MAX_CHARS = 200;

function toWatchSet(s: import('@/db/local').LocalWorkoutSet): WatchSet {
  const isTime = s.duration_seconds !== null && s.duration_seconds !== undefined;
  const comment = s.comment != null && s.comment.length > COMMENT_MAX_CHARS
    ? s.comment.slice(0, COMMENT_MAX_CHARS)
    : s.comment;
  return {
    uuid: s.uuid,
    workout_exercise_uuid: s.workout_exercise_uuid,
    order_index: s.order_index,
    is_completed: s.is_completed,
    target_weight: s.weight,
    target_reps: isTime ? null : (s.max_target_reps ?? s.repetitions),
    target_duration_seconds: isTime ? s.duration_seconds : null,
    actual_weight: s.is_completed ? s.weight : null,
    actual_reps: s.is_completed && !isTime ? s.repetitions : null,
    actual_duration_seconds: s.is_completed && isTime ? s.duration_seconds : null,
    rir: s.rir,
    min_target_reps: s.min_target_reps,
    max_target_reps: s.max_target_reps,
    rpe: s.rpe,
    tag: s.tag,
    comment,
    is_pr: s.is_pr,
    excluded_from_pb: s.excluded_from_pb,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Plugin wrappers
// ─────────────────────────────────────────────────────────────────────────

export async function pushSnapshotToWatch(snapshot: WatchSnapshot): Promise<void> {
  if (!isNativeIOS()) return;
  try {
    await WatchConnectivity.pushActiveWorkout({ snapshot });
  } catch (err) {
    // Swallow — watch sync is best-effort. Don't surface to user UI.
    console.warn('[watch] pushActiveWorkout failed:', err);
  }
}

export async function pushSetMutationToWatch(mutation: WatchSetMutation): Promise<void> {
  if (!isNativeIOS()) return;
  try {
    await WatchConnectivity.pushSetMutation({ mutation });
  } catch (err) {
    console.warn('[watch] pushSetMutation failed:', err);
  }
}

export async function getWatchPaired(): Promise<{ isPaired: boolean; isReachable: boolean; isWatchAppInstalled: boolean }> {
  if (!isNativeIOS()) return { isPaired: false, isReachable: false, isWatchAppInstalled: false };
  try {
    return await WatchConnectivity.getWatchPaired();
  } catch {
    return { isPaired: false, isReachable: false, isWatchAppInstalled: false };
  }
}

interface WatchInboundEvent {
  kind: string;
  payload?: Record<string, unknown>;
}

interface WatchConnectivityListener {
  remove(): Promise<void>;
}

interface WatchConnectivityWithEvents extends WatchConnectivityPlugin {
  addListener(eventName: 'watchInbound', listenerFunc: (event: WatchInboundEvent) => void): Promise<WatchConnectivityListener>;
}

/** Subscribe to inbound watch → phone messages. Returns an unsubscribe fn.
 *  Today only `watchWroteSet` is fired — the watch sends it the moment the
 *  user confirms a set on the watch. Phone applies the row via Dexie
 *  (`WatchInboundBridge` → `mutations.updateSet()`) and the existing sync
 *  engine pushes it to the server. The phone is the single writer to
 *  Postgres — the watch never hits `/api/sync/push` directly. */
export function subscribeToWatchInbound(handler: (event: WatchInboundEvent) => void): () => void {
  if (!isNativeIOS()) return () => {};
  const wcWithEvents = WatchConnectivity as unknown as WatchConnectivityWithEvents;
  let listenerHandle: WatchConnectivityListener | null = null;
  void wcWithEvents.addListener('watchInbound', handler).then((h) => {
    listenerHandle = h;
  });
  return () => {
    void listenerHandle?.remove();
  };
}
