import { NextResponse } from 'next/server';
import { query } from '@/db/db';

interface SyncWorkout {
  uuid: string;
  start_time: string;
  end_time: string | null;
  title: string | null;
  comment: string | null;
  is_current: boolean;
  workout_routine_uuid: string | null;
  _deleted: boolean;
}

interface SyncWorkoutExercise {
  uuid: string;
  workout_uuid: string;
  exercise_uuid: string;
  comment: string | null;
  order_index: number;
  _deleted: boolean;
}

interface SyncWorkoutSet {
  uuid: string;
  workout_exercise_uuid: string;
  weight: number | null;
  repetitions: number | null;
  min_target_reps: number | null;
  max_target_reps: number | null;
  rpe: number | null;
  tag: string | null;
  comment: string | null;
  is_completed: boolean;
  is_pr: boolean;
  order_index: number;
  _deleted: boolean;
}

interface SyncBodyweightLog {
  uuid: string;
  weight_kg: number;
  logged_at: string;
  note: string | null;
  _deleted: boolean;
}

interface PushPayload {
  workouts?: SyncWorkout[];
  workout_exercises?: SyncWorkoutExercise[];
  workout_sets?: SyncWorkoutSet[];
  bodyweight_logs?: SyncBodyweightLog[];
}

export async function POST(req: Request) {
  try {
    const body: PushPayload = await req.json();

    // ── Workouts ────────────────────────────────────────────────────────────────
    for (const w of body.workouts ?? []) {
      if (w._deleted) {
        await query('DELETE FROM workouts WHERE uuid = $1', [w.uuid]);
      } else {
        await query(
          `INSERT INTO workouts (uuid, start_time, end_time, title, comment, is_current, workout_routine_uuid, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (uuid) DO UPDATE SET
             start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             title = EXCLUDED.title,
             comment = EXCLUDED.comment,
             is_current = EXCLUDED.is_current,
             workout_routine_uuid = EXCLUDED.workout_routine_uuid,
             updated_at = NOW()`,
          [w.uuid, w.start_time, w.end_time, w.title, w.comment, w.is_current, w.workout_routine_uuid],
        );
      }
    }

    // ── Workout exercises ───────────────────────────────────────────────────────
    for (const e of body.workout_exercises ?? []) {
      if (e._deleted) {
        await query('DELETE FROM workout_exercises WHERE uuid = $1', [e.uuid]);
      } else {
        await query(
          `INSERT INTO workout_exercises (uuid, workout_uuid, exercise_uuid, comment, order_index, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (uuid) DO UPDATE SET
             comment = EXCLUDED.comment,
             order_index = EXCLUDED.order_index,
             updated_at = NOW()`,
          [e.uuid, e.workout_uuid, e.exercise_uuid, e.comment, e.order_index],
        );
      }
    }

    // ── Workout sets ────────────────────────────────────────────────────────────
    for (const s of body.workout_sets ?? []) {
      if (s._deleted) {
        await query('DELETE FROM workout_sets WHERE uuid = $1', [s.uuid]);
      } else {
        await query(
          `INSERT INTO workout_sets (uuid, workout_exercise_uuid, weight, repetitions, min_target_reps, max_target_reps, rpe, tag, comment, is_completed, is_pr, order_index, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
           ON CONFLICT (uuid) DO UPDATE SET
             weight = EXCLUDED.weight,
             repetitions = EXCLUDED.repetitions,
             min_target_reps = EXCLUDED.min_target_reps,
             max_target_reps = EXCLUDED.max_target_reps,
             rpe = EXCLUDED.rpe,
             tag = EXCLUDED.tag,
             comment = EXCLUDED.comment,
             is_completed = EXCLUDED.is_completed,
             is_pr = EXCLUDED.is_pr,
             order_index = EXCLUDED.order_index,
             updated_at = NOW()`,
          [s.uuid, s.workout_exercise_uuid, s.weight, s.repetitions, s.min_target_reps, s.max_target_reps, s.rpe, s.tag, s.comment, s.is_completed, s.is_pr, s.order_index],
        );
      }
    }

    // ── Bodyweight logs ─────────────────────────────────────────────────────────
    for (const b of body.bodyweight_logs ?? []) {
      if (b._deleted) {
        await query('DELETE FROM bodyweight_logs WHERE uuid = $1', [b.uuid]);
      } else {
        await query(
          `INSERT INTO bodyweight_logs (uuid, weight_kg, logged_at, note, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (uuid) DO UPDATE SET
             weight_kg = EXCLUDED.weight_kg,
             logged_at = EXCLUDED.logged_at,
             note = EXCLUDED.note,
             updated_at = NOW()`,
          [b.uuid, b.weight_kg, b.logged_at, b.note],
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('sync/push error:', err);
    return NextResponse.json({ error: 'Push failed' }, { status: 500 });
  }
}
