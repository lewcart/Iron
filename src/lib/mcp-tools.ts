/**
 * Rebirth MCP tool registry.
 *
 * Each MCPTool bundles its JSON Schema (for tools/list) with its execute
 * function (called by tools/call). Route handlers import `tools` and
 * `executeTool` — they never touch DB logic directly.
 */

import { query, queryOne, transaction } from '@/db/db';
import { estimate1RM } from '@/lib/pr';
import { LAB_DEFINITIONS_BY_CODE, evaluateLabRange } from '@/lib/lab-definitions';

// ── Result helpers ────────────────────────────────────────────────────────────

export function toolResult(content: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(content, null, 2) }] };
}

export function toolError(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ── MCPTool interface ─────────────────────────────────────────────────────────

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: object;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

// ── Shared helpers ────────────────────────────────────────────────────────────
//
// Nutrition-only helpers (DOW_NAMES, DAY_NAME_MAP, parseDayOfWeek) moved to
// src/lib/mcp/nutrition-tools.ts alongside the tools that use them.

const MEASUREMENT_SITE_MAP: Record<string, string> = {
  chest: 'chest',
  waist: 'waist',
  hips: 'hips',
  neck: 'neck',
  shoulder_width: 'shoulder_width',
  // Legacy alias: external MCP callers that still send `shoulders` get
  // normalized to the canonical site key at write time. Once the alias has
  // a long-enough zero-hit window, drop this line and tighten the test in
  // measurements.test.ts.
  shoulders: 'shoulder_width',
  abdomen: 'abdomen',
  left_arm: 'left_bicep',
  right_arm: 'right_bicep',
  left_forearm: 'left_forearm',
  right_forearm: 'right_forearm',
  left_thigh: 'left_thigh',
  right_thigh: 'right_thigh',
  left_calf: 'left_calf',
  right_calf: 'right_calf',
};

// ── Tool implementations ──────────────────────────────────────────────────────

async function getRecentWorkouts(args: Record<string, unknown>) {
  const limit = Math.min(Number(args.limit ?? 10), 50);
  const daysBack = Number(args.days_back ?? 30);

  const workouts = await query<{
    uuid: string; title: string | null; start_time: string; end_time: string | null;
  }>(`
    SELECT w.uuid, w.title, w.start_time, w.end_time
    FROM workouts w
    WHERE w.is_current = false
      AND w.start_time >= NOW() - ($2 || ' days')::interval
    ORDER BY w.start_time DESC
    LIMIT $1
  `, [limit, daysBack]);

  if (workouts.length === 0) return toolResult([]);

  const uuids = workouts.map(w => w.uuid);
  const exercises = await query<{
    workout_uuid: string; exercise_uuid: string; exercise_title: string;
    we_uuid: string; order_index: number;
  }>(`
    SELECT we.workout_uuid, we.exercise_uuid, e.title AS exercise_title,
           we.uuid AS we_uuid, we.order_index
    FROM workout_exercises we
    JOIN exercises e ON e.uuid = we.exercise_uuid
    WHERE we.workout_uuid = ANY($1)
    ORDER BY we.workout_uuid, we.order_index
  `, [uuids]);

  const weUuids = exercises.map(e => e.we_uuid);
  const sets = weUuids.length > 0 ? await query<{
    workout_exercise_uuid: string; weight: number | null; repetitions: number | null;
    rpe: number | null; is_completed: boolean; order_index: number;
  }>(`
    SELECT workout_exercise_uuid, weight, repetitions, rpe, is_completed, order_index
    FROM workout_sets
    WHERE workout_exercise_uuid = ANY($1)
    ORDER BY workout_exercise_uuid, order_index
  `, [weUuids]) : [];

  const setsByWe = sets.reduce((acc, s) => {
    (acc[s.workout_exercise_uuid] ??= []).push(s);
    return acc;
  }, {} as Record<string, typeof sets>);

  const exByWorkout = exercises.reduce((acc, e) => {
    (acc[e.workout_uuid] ??= []).push({
      name: e.exercise_title,
      sets: (setsByWe[e.we_uuid] ?? []).map(s => ({
        weight: s.weight,
        reps: s.repetitions,
        rpe: s.rpe,
      })),
    });
    return acc;
  }, {} as Record<string, unknown[]>);

  return toolResult(workouts.map(w => {
    const exList = exByWorkout[w.uuid] ?? [];
    const startMs = new Date(w.start_time).getTime();
    const endMs = w.end_time ? new Date(w.end_time).getTime() : null;
    const totalVolume = sets
      .filter(s => {
        const ex = exercises.find(e => e.we_uuid === s.workout_exercise_uuid);
        return ex?.workout_uuid === w.uuid && s.weight != null && s.repetitions != null;
      })
      .reduce((sum, s) => sum + (s.weight ?? 0) * (s.repetitions ?? 0), 0);
    return {
      date: w.start_time,
      name: w.title,
      duration_min: endMs != null ? Math.round((endMs - startMs) / 60000) : null,
      exercises: exList,
      total_volume: Math.round(totalVolume),
    };
  }));
}

async function getExerciseHistory(args: Record<string, unknown>) {
  const { exercise_name, exercise_id, exercise_uuid: legacyUuid, limit = 20 } = args as {
    exercise_name?: string;
    exercise_id?: string;
    exercise_uuid?: string;
    limit?: number;
  };

  let resolvedUuid = exercise_id ?? legacyUuid ?? null;
  if (!resolvedUuid && exercise_name) {
    const match = await queryOne<{ uuid: string; title: string }>(`
      SELECT uuid, title FROM exercises
      WHERE title ILIKE $1
        AND is_hidden = false
      ORDER BY is_custom ASC, title ASC
      LIMIT 1
    `, [`%${exercise_name}%`]);
    if (!match) return toolError(`No exercise found matching "${exercise_name}"`);
    resolvedUuid = match.uuid;
  }
  if (!resolvedUuid) return toolError('Provide exercise_name or exercise_id');

  const sessionLimit = Math.min(Number(limit), 100);

  const sessions = await query<{
    workout_uuid: string; we_uuid: string; date: string; workout_name: string | null;
  }>(`
    SELECT w.uuid AS workout_uuid, we.uuid AS we_uuid,
           w.start_time AS date, w.title AS workout_name
    FROM workouts w
    JOIN workout_exercises we ON we.workout_uuid = w.uuid
    WHERE we.exercise_uuid = $1
      AND w.is_current = false
    ORDER BY w.start_time DESC
    LIMIT $2
  `, [resolvedUuid, sessionLimit]);

  if (sessions.length === 0) return toolResult([]);

  const weUuids = sessions.map(s => s.we_uuid);
  const sets = await query<{
    workout_exercise_uuid: string;
    weight: number | null;
    repetitions: number | null;
    duration_seconds: number | null;
  }>(`
    SELECT workout_exercise_uuid, weight, repetitions, duration_seconds
    FROM workout_sets
    WHERE workout_exercise_uuid = ANY($1)
      AND is_completed = true
    ORDER BY workout_exercise_uuid, order_index
  `, [weUuids]);

  const setsByWe = sets.reduce((acc, s) => {
    (acc[s.workout_exercise_uuid] ??= []).push(s);
    return acc;
  }, {} as Record<string, typeof sets>);

  // Surface tracking_mode so the consumer (an AI agent) knows which fields
  // are meaningful. Single read for the resolved exercise; tracking_mode
  // is exercise-level, so the same value applies to every session here.
  const exerciseRow = await queryOne<{ tracking_mode: string | null }>(
    'SELECT tracking_mode FROM exercises WHERE uuid = $1',
    [resolvedUuid]
  );
  const trackingMode: 'reps' | 'time' = exerciseRow?.tracking_mode === 'time' ? 'time' : 'reps';

  return toolResult(sessions.map(s => {
    const sessionSets = (setsByWe[s.we_uuid] ?? []).map(row => ({
      weight: row.weight,
      reps: row.repetitions,
      duration_seconds: row.duration_seconds,
    }));
    if (trackingMode === 'time') {
      // Time-mode: 1RM is meaningless. Surface longest single hold + total
      // seconds across the session instead, so the agent gets a comparable
      // PR-style metric for time-tracked exercises.
      const longestHold = sessionSets.reduce((max, row) => {
        const d = row.duration_seconds;
        return d != null && d > max ? d : max;
      }, 0);
      const totalSeconds = sessionSets.reduce(
        (sum, row) => sum + (row.duration_seconds ?? 0),
        0,
      );
      return {
        date: s.date,
        workout_name: s.workout_name,
        tracking_mode: 'time',
        sets: sessionSets,
        longest_hold_seconds: longestHold > 0 ? longestHold : null,
        total_seconds: totalSeconds > 0 ? totalSeconds : null,
      };
    }
    const best1rm = sessionSets.reduce((max, row) => {
      if (row.weight == null || row.reps == null || row.reps === 0) return max;
      // 1 decimal place rounding preserves the historic MCP output format.
      const rm = Math.round(estimate1RM(row.weight, row.reps) * 10) / 10;
      return rm > max ? rm : max;
    }, 0);
    return {
      date: s.date,
      workout_name: s.workout_name,
      tracking_mode: 'reps',
      sets: sessionSets,
      estimated_1rm: best1rm > 0 ? best1rm : null,
    };
  }));
}

async function getActiveRoutine() {
  const plan = await queryOne<{ uuid: string; title: string | null }>(`
    SELECT uuid, title FROM workout_plans WHERE is_active = true LIMIT 1
  `);

  if (!plan) return toolResult(null);

  const routines = await query<{
    uuid: string; title: string | null; comment: string | null; order_index: number;
  }>(`
    SELECT uuid, title, comment, order_index
    FROM workout_routines WHERE workout_plan_uuid = $1
    ORDER BY order_index
  `, [plan.uuid]);

  const rUuids = routines.map(r => r.uuid);
  const rExercises = rUuids.length > 0 ? await query<{
    routine_uuid: string; re_uuid: string; exercise_uuid: string;
    exercise_title: string; order_index: number;
  }>(`
    SELECT wre.workout_routine_uuid AS routine_uuid, wre.uuid AS re_uuid,
           wre.exercise_uuid, e.title AS exercise_title, wre.order_index
    FROM workout_routine_exercises wre
    JOIN exercises e ON e.uuid = wre.exercise_uuid
    WHERE wre.workout_routine_uuid = ANY($1)
    ORDER BY wre.workout_routine_uuid, wre.order_index
  `, [rUuids]) : [];

  const reUuids = rExercises.map(e => e.re_uuid);
  const rSets = reUuids.length > 0 ? await query<{
    workout_routine_exercise_uuid: string; min_repetitions: number | null;
    max_repetitions: number | null; order_index: number;
  }>(`
    SELECT workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index
    FROM workout_routine_sets
    WHERE workout_routine_exercise_uuid = ANY($1)
    ORDER BY workout_routine_exercise_uuid, order_index
  `, [reUuids]) : [];

  const setsByRe = rSets.reduce((acc, s) => {
    (acc[s.workout_routine_exercise_uuid] ??= []).push(s);
    return acc;
  }, {} as Record<string, typeof rSets>);

  const exByRoutine = rExercises.reduce((acc, e) => {
    (acc[e.routine_uuid] ??= []).push({ ...e, sets: setsByRe[e.re_uuid] ?? [] });
    return acc;
  }, {} as Record<string, unknown[]>);

  return toolResult({
    ...plan,
    routines: routines.map(r => ({ ...r, exercises: exByRoutine[r.uuid] ?? [] })),
  });
}

async function getBodyComp(args: Record<string, unknown>) {
  const daysBack = Number(args.days_back ?? 90);

  const [latestWeight, latestSpec, weight7dAgo, weight30dAgo, spec7dAgo, spec30dAgo, latestMeasurements, history] = await Promise.all([
    queryOne<{ weight_kg: string; logged_at: string }>(`
      SELECT weight_kg, logged_at FROM bodyweight_logs ORDER BY logged_at DESC LIMIT 1
    `),
    queryOne<{ body_fat_pct: string | null; lean_mass_kg: string | null; measured_at: string }>(`
      SELECT body_fat_pct, lean_mass_kg, measured_at FROM body_spec_logs ORDER BY measured_at DESC LIMIT 1
    `),
    queryOne<{ weight_kg: string }>(`
      SELECT weight_kg FROM bodyweight_logs
      WHERE logged_at <= NOW() - interval '7 days'
      ORDER BY logged_at DESC LIMIT 1
    `),
    queryOne<{ weight_kg: string }>(`
      SELECT weight_kg FROM bodyweight_logs
      WHERE logged_at <= NOW() - interval '30 days'
      ORDER BY logged_at DESC LIMIT 1
    `),
    queryOne<{ body_fat_pct: string | null }>(`
      SELECT body_fat_pct FROM body_spec_logs
      WHERE measured_at <= NOW() - interval '7 days'
      ORDER BY measured_at DESC LIMIT 1
    `),
    queryOne<{ body_fat_pct: string | null }>(`
      SELECT body_fat_pct FROM body_spec_logs
      WHERE measured_at <= NOW() - interval '30 days'
      ORDER BY measured_at DESC LIMIT 1
    `),
    query<{ site: string; value_cm: string }>(`
      SELECT DISTINCT ON (site) site, value_cm
      FROM measurement_logs
      ORDER BY site, measured_at DESC
    `),
    query<{ date: string; weight_kg: string; body_fat_pct: string | null; lean_mass_kg: string | null }>(`
      WITH bw AS (
        SELECT logged_at::date AS date, weight_kg
        FROM bodyweight_logs
        WHERE logged_at > NOW() - ($1 || ' days')::interval
      ),
      spec AS (
        SELECT DISTINCT ON (measured_at::date) measured_at::date AS date, body_fat_pct, lean_mass_kg
        FROM body_spec_logs
        WHERE measured_at > NOW() - ($1 || ' days')::interval
        ORDER BY measured_at::date, measured_at DESC
      )
      SELECT bw.date, bw.weight_kg, spec.body_fat_pct, spec.lean_mass_kg
      FROM bw LEFT JOIN spec ON bw.date = spec.date
      ORDER BY bw.date DESC
    `, [daysBack]),
  ]);

  const toNum = (v: string | null | undefined) => (v != null ? parseFloat(v) : null);
  const round2 = (n: number | null) => n != null ? Math.round(n * 100) / 100 : null;

  const currentWeight = toNum(latestWeight?.weight_kg);
  const currentBF = toNum(latestSpec?.body_fat_pct);
  const currentLM = toNum(latestSpec?.lean_mass_kg);

  const w7 = toNum(weight7dAgo?.weight_kg);
  const w30 = toNum(weight30dAgo?.weight_kg);
  const bf7 = toNum(spec7dAgo?.body_fat_pct);
  const bf30 = toNum(spec30dAgo?.body_fat_pct);

  const measurementsObj: Record<string, number> = {};
  for (const m of latestMeasurements) {
    measurementsObj[m.site] = parseFloat(m.value_cm);
  }

  return toolResult({
    current: {
      weight: currentWeight,
      body_fat_pct: currentBF,
      lean_mass: currentLM,
      date: latestWeight?.logged_at ?? null,
    },
    trend_7d: {
      weight_change: round2(currentWeight != null && w7 != null ? currentWeight - w7 : null),
      bf_change: round2(currentBF != null && bf7 != null ? currentBF - bf7 : null),
    },
    trend_30d: {
      weight_change: round2(currentWeight != null && w30 != null ? currentWeight - w30 : null),
      bf_change: round2(currentBF != null && bf30 != null ? currentBF - bf30 : null),
    },
    measurements: measurementsObj,
    history: history.map(r => ({
      date: r.date,
      weight: toNum(r.weight_kg),
      body_fat_pct: toNum(r.body_fat_pct),
      lean_mass: toNum(r.lean_mass_kg),
    })),
  });
}

async function updateBodyComp(args: Record<string, unknown>) {
  const {
    weight, body_fat_pct, lean_mass,
    measurements = {},
    notes,
    date,
  } = args as {
    weight?: number;
    body_fat_pct?: number;
    lean_mass?: number;
    measurements?: Record<string, number>;
    notes?: string;
    date?: string;
  };

  const hasAnyField =
    weight !== undefined ||
    body_fat_pct !== undefined ||
    lean_mass !== undefined ||
    Object.keys(measurements).length > 0;

  if (!hasAnyField) {
    return toolError('At least one field (weight, body_fat_pct, lean_mass, or a measurement) must be provided.');
  }

  const loggedAt = date ? new Date(date) : new Date();
  let entries_created = 0;

  if (weight !== undefined) {
    await query(
      `INSERT INTO bodyweight_logs (uuid, weight_kg, logged_at) VALUES ($1, $2, $3)`,
      [crypto.randomUUID(), weight, loggedAt]
    );
    entries_created++;
  }

  if (body_fat_pct !== undefined || lean_mass !== undefined) {
    await query(
      `INSERT INTO body_spec_logs (uuid, body_fat_pct, lean_mass_kg, notes, measured_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), body_fat_pct ?? null, lean_mass ?? null, notes ?? null, loggedAt]
    );
    entries_created++;
  }

  for (const [field, value] of Object.entries(measurements)) {
    const site = MEASUREMENT_SITE_MAP[field] ?? field;
    await query(
      `INSERT INTO measurement_logs (uuid, site, value_cm, measured_at) VALUES ($1, $2, $3, $4)`,
      [crypto.randomUUID(), site, value, loggedAt]
    );
    entries_created++;
  }

  return toolResult({ success: true, entries_created });
}

async function getBodyCompTrend(args: Record<string, unknown>) {
  const days = Number(args.days ?? 90);

  const [bodySpec, bodyweight, measurements] = await Promise.all([
    query(`
      SELECT measured_at, weight_kg, body_fat_pct, lean_mass_kg, height_cm, notes
      FROM body_spec_logs
      WHERE measured_at > NOW() - ($1 || ' days')::interval
      ORDER BY measured_at DESC
    `, [days]),
    query(`
      SELECT logged_at, weight_kg
      FROM bodyweight_logs
      WHERE logged_at > NOW() - ($1 || ' days')::interval
      ORDER BY logged_at DESC
    `, [days]),
    query(`
      SELECT site, value_cm, measured_at
      FROM measurement_logs
      WHERE measured_at > NOW() - ($1 || ' days')::interval
      ORDER BY site, measured_at DESC
    `, [days]),
  ]);

  return toolResult({ body_spec: bodySpec, bodyweight, measurements });
}

async function getWeeklySummary(args: Record<string, unknown> = {}) {
  const weekOffset = Number(args.week_offset ?? 0);

  const weekBoundsRow = await queryOne<{ week_start: string; week_end: string }>(`
    SELECT
      date_trunc('week', NOW() + ($1 || ' weeks')::interval)::date::text AS week_start,
      (date_trunc('week', NOW() + ($1 || ' weeks')::interval) + INTERVAL '7 days')::date::text AS week_end
  `, [weekOffset]);

  const weekStart = weekBoundsRow!.week_start;
  const weekEnd = weekBoundsRow!.week_end;

  const [workoutRows, volumeByMuscleRows, activePlan] = await Promise.all([
    query<{ uuid: string; title: string | null; start_time: string; total_volume: string }>(`
      SELECT w.uuid, w.title, w.start_time,
             COALESCE(SUM(CASE WHEN ws.is_completed AND ws.weight IS NOT NULL AND ws.repetitions IS NOT NULL
               THEN ws.weight * ws.repetitions ELSE 0 END), 0) AS total_volume
      FROM workouts w
      LEFT JOIN workout_exercises we ON we.workout_uuid = w.uuid
      LEFT JOIN workout_sets ws ON ws.workout_exercise_uuid = we.uuid
      WHERE w.start_time >= $1 AND w.start_time < $2
        AND w.is_current = false
      GROUP BY w.uuid, w.title, w.start_time
      ORDER BY w.start_time
    `, [weekStart, weekEnd]),
    query<{ muscle: string; volume: string }>(`
      SELECT jsonb_array_elements_text(e.primary_muscles) AS muscle,
             SUM(ws.weight * ws.repetitions) AS volume
      FROM workout_sets ws
      JOIN workout_exercises we ON we.uuid = ws.workout_exercise_uuid
      JOIN exercises e ON e.uuid = we.exercise_uuid
      JOIN workouts w ON w.uuid = we.workout_uuid
      WHERE w.start_time >= $1 AND w.start_time < $2
        AND w.is_current = false
        AND ws.is_completed = true
        AND ws.weight IS NOT NULL
        AND ws.repetitions IS NOT NULL
      GROUP BY muscle
      ORDER BY volume DESC
    `, [weekStart, weekEnd]),
    queryOne<{ routine_count: string }>(`
      SELECT COUNT(wr.uuid) AS routine_count
      FROM workout_routines wr
      JOIN workout_plans wp ON wp.uuid = wr.workout_plan_uuid
      WHERE wp.is_active = true
    `),
  ]);

  const trainingDays = workoutRows.length;
  const totalVolume = Math.round(workoutRows.reduce((sum, w) => sum + Number(w.total_volume), 0));
  const volumeByMuscle: Record<string, number> = {};
  for (const row of volumeByMuscleRows) {
    volumeByMuscle[row.muscle] = Math.round(Number(row.volume));
  }

  const plannedDays = Number(activePlan?.routine_count ?? 0);
  const compliancePct = plannedDays > 0
    ? Math.round(Math.min(1, trainingDays / plannedDays) * 100)
    : null;

  return toolResult({
    week_start: weekStart,
    week_end: weekEnd,
    training_days: trainingDays,
    total_volume: totalVolume,
    volume_by_muscle: volumeByMuscle,
    compliance_pct: compliancePct,
  });
}

async function findExercises(args: Record<string, unknown>) {
  const { query: q, muscle_group } = args as { query: string; muscle_group?: string };
  const pattern = `%${q}%`;
  let rows;

  if (muscle_group) {
    rows = await query(`
      SELECT uuid, title, primary_muscles, secondary_muscles, equipment
      FROM exercises
      WHERE is_hidden = false
        AND (title ILIKE $1 OR alias::text ILIKE $1)
        AND (primary_muscles::text ILIKE $2 OR secondary_muscles::text ILIKE $2)
      ORDER BY title
      LIMIT 15
    `, [pattern, `%${muscle_group}%`]);
  } else {
    rows = await query(`
      SELECT uuid, title, primary_muscles, secondary_muscles, equipment
      FROM exercises
      WHERE is_hidden = false
        AND (title ILIKE $1 OR alias::text ILIKE $1)
      ORDER BY title
      LIMIT 15
    `, [pattern]);
  }

  return toolResult(rows);
}

async function createExercise(args: Record<string, unknown>) {
  const {
    title,
    primary_muscles,
    secondary_muscles,
    equipment,
    description,
    alias,
    steps,
    tips,
    movement_pattern,
    tracking_mode,
    youtube_url,
  } = args as {
    title: string;
    primary_muscles: string[];
    secondary_muscles?: string[];
    equipment?: string[];
    description?: string;
    alias?: string[];
    steps?: string[];
    tips?: string[];
    movement_pattern?: string;
    tracking_mode?: 'reps' | 'time';
    youtube_url?: string;
  };

  if (!title?.trim()) return toolError('title is required');
  if (!Array.isArray(primary_muscles) || primary_muscles.length === 0) {
    return toolError('primary_muscles must be a non-empty array');
  }

  // Server-side YouTube validation. MCP/import paths can't bypass this
  // because we never trust the raw input.
  let ytClean: string | null = null;
  if (typeof youtube_url === 'string' && youtube_url.trim().length > 0) {
    if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(youtube_url.trim())) {
      ytClean = youtube_url.trim();
    } else {
      return toolError('youtube_url must be a youtube.com or youtu.be URL');
    }
  }

  const uuid = crypto.randomUUID();
  const row = await queryOne(
    `INSERT INTO exercises
       (uuid, everkinetic_id, title, alias, description, primary_muscles, secondary_muscles, equipment,
        steps, tips, is_custom, movement_pattern, tracking_mode, youtube_url, image_count)
     VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, $12, 0)
     RETURNING uuid, title, primary_muscles, secondary_muscles, equipment, description,
               steps, tips, tracking_mode, youtube_url, image_count`,
    [
      uuid,
      title.trim(),
      JSON.stringify(alias ?? []),
      description ?? null,
      JSON.stringify(primary_muscles),
      JSON.stringify(secondary_muscles ?? []),
      JSON.stringify(equipment ?? []),
      JSON.stringify(steps ?? []),
      JSON.stringify(tips ?? []),
      movement_pattern ?? null,
      tracking_mode === 'time' ? 'time' : 'reps',
      ytClean,
    ]
  );

  return toolResult(row);
}

/** Update any exercise row (catalog or custom) — text fields, equipment,
 *  movement pattern, tracking mode, YouTube URL. Server validates youtube_url
 *  and rejects garbage. */
async function updateExercise(args: Record<string, unknown>) {
  const { uuid, ...patch } = args as {
    uuid: string;
    title?: string;
    description?: string | null;
    steps?: string[];
    tips?: string[];
    equipment?: string[];
    primary_muscles?: string[];
    secondary_muscles?: string[];
    movement_pattern?: string | null;
    tracking_mode?: 'reps' | 'time';
    youtube_url?: string | null;
  };

  if (!uuid) return toolError('uuid is required');
  const existing = await queryOne<{ uuid: string }>(
    'SELECT uuid FROM exercises WHERE uuid = $1',
    [uuid.toLowerCase()],
  );
  if (!existing) return toolError(`Exercise ${uuid} not found`);

  // Build SET clause dynamically — only update fields the caller passed.
  const updates: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const push = (col: string, val: unknown) => {
    updates.push(`${col} = $${i++}`);
    values.push(val);
  };

  if (patch.title !== undefined) push('title', patch.title);
  if (patch.description !== undefined) push('description', patch.description);
  if (patch.steps !== undefined) push('steps', JSON.stringify(patch.steps));
  if (patch.tips !== undefined) push('tips', JSON.stringify(patch.tips));
  if (patch.equipment !== undefined) push('equipment', JSON.stringify(patch.equipment));
  if (patch.primary_muscles !== undefined) push('primary_muscles', JSON.stringify(patch.primary_muscles));
  if (patch.secondary_muscles !== undefined) push('secondary_muscles', JSON.stringify(patch.secondary_muscles));
  if (patch.movement_pattern !== undefined) push('movement_pattern', patch.movement_pattern);
  if (patch.tracking_mode !== undefined) {
    push('tracking_mode', patch.tracking_mode === 'time' ? 'time' : 'reps');
  }
  if (patch.youtube_url !== undefined) {
    if (patch.youtube_url === null || patch.youtube_url === '') {
      push('youtube_url', null);
    } else if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(patch.youtube_url)) {
      push('youtube_url', patch.youtube_url);
    } else {
      return toolError('youtube_url must be a youtube.com or youtu.be URL');
    }
  }

  if (updates.length === 0) return toolError('No fields to update');

  updates.push(`updated_at = NOW()`);
  values.push(uuid.toLowerCase());
  const row = await queryOne(
    `UPDATE exercises SET ${updates.join(', ')} WHERE uuid = $${i} RETURNING *`,
    values,
  );
  return toolResult(row);
}

// ── Shared exercise resolver ──────────────────────────────────────────────────

type ResolvedExercise = { uuid: string; title: string };
type ExerciseError = { error: string; candidates?: Array<{ uuid: string; title: string }> };

async function resolveExercise(args: { exercise_id?: string; exercise_name?: string }): Promise<ResolvedExercise | ExerciseError> {
  const { exercise_id, exercise_name } = args;

  if (exercise_id) {
    const ex = await queryOne<{ uuid: string; title: string }>(
      'SELECT uuid, title FROM exercises WHERE uuid = $1 AND is_hidden = false',
      [exercise_id]
    );
    if (!ex) return { error: `Exercise not found: ${exercise_id}` };
    return ex;
  }

  if (exercise_name) {
    const matches = await query<{ uuid: string; title: string }>(
      `SELECT uuid, title FROM exercises
       WHERE is_hidden = false
         AND (title ILIKE $1 OR alias::text ILIKE $1)
       ORDER BY is_custom ASC, title ASC
       LIMIT 5`,
      [`%${exercise_name}%`]
    );
    if (matches.length === 0) return { error: `No exercise found matching "${exercise_name}"` };
    if (matches.length === 1) return matches[0];
    return {
      error: `Ambiguous exercise name "${exercise_name}" — be more specific`,
      candidates: matches.map(m => ({ uuid: m.uuid, title: m.title })),
    };
  }

  return { error: 'Provide exercise_id or exercise_name' };
}

function exerciseErrorMessage(err: ExerciseError): string {
  if (err.candidates) {
    return `${err.error} (candidates: ${err.candidates.map(c => `${c.title} (${c.uuid})`).join(', ')})`;
  }
  return err.error;
}

// ── Write tool implementations ────────────────────────────────────────────────

async function createRoutine(args: Record<string, unknown>) {
  type SetInput = {
    target_weight?: number;
    target_reps?: number;
    min_repetitions?: number;
    max_repetitions?: number;
    rpe_target?: number;
    order_index?: number;
  };
  type ExerciseInput = {
    exercise_id?: string;
    exercise_uuid?: string;
    exercise_name?: string;
    order?: number;
    order_index?: number;
    sets?: SetInput[];
  };
  type RoutineInput = {
    day_label?: string;
    title?: string;
    order?: number;
    order_index?: number;
    exercises?: ExerciseInput[];
  };

  const name = (args.name ?? args.title) as string | undefined;
  const description = args.description as string | undefined;
  const routinesInput = (args.routines ?? []) as RoutineInput[];

  if (!name) return toolError('name is required');
  if (!routinesInput.length) return toolError('routines array is required');

  // Batch-resolve all exercises before any writes to fail fast
  const resolvedMap: Record<string, Record<string, ResolvedExercise>> = {};
  const errors: string[] = [];

  for (let ri = 0; ri < routinesInput.length; ri++) {
    resolvedMap[ri] = {};
    for (let ei = 0; ei < (routinesInput[ri].exercises ?? []).length; ei++) {
      const ex = routinesInput[ri].exercises![ei];
      const resolved = await resolveExercise({
        exercise_id: ex.exercise_id ?? ex.exercise_uuid,
        exercise_name: ex.exercise_name,
      });
      if ('error' in resolved) {
        errors.push(`Day ${ri + 1}, exercise ${ei + 1}: ${exerciseErrorMessage(resolved)}`);
      } else {
        resolvedMap[ri][ei] = resolved;
      }
    }
  }

  if (errors.length > 0) return toolError(`Exercise resolution failed:\n${errors.join('\n')}`);

  const planUuid = crypto.randomUUID();
  await query(
    'INSERT INTO workout_plans (uuid, title, description) VALUES ($1, $2, $3)',
    [planUuid, name, description ?? null]
  );

  const routineIds: string[] = [];

  for (let ri = 0; ri < routinesInput.length; ri++) {
    const routine = routinesInput[ri];
    const rUuid = crypto.randomUUID();
    routineIds.push(rUuid);
    const routineTitle = routine.day_label ?? routine.title ?? `Day ${ri + 1}`;
    const routineOrder = routine.order ?? routine.order_index ?? ri;

    await query(
      'INSERT INTO workout_routines (uuid, workout_plan_uuid, title, order_index) VALUES ($1, $2, $3, $4)',
      [rUuid, planUuid, routineTitle, routineOrder]
    );

    for (let ei = 0; ei < (routine.exercises ?? []).length; ei++) {
      const ex = routine.exercises![ei];
      const resolved = resolvedMap[ri][ei];
      const reUuid = crypto.randomUUID();
      const exOrder = ex.order ?? ex.order_index ?? ei;

      await query(
        'INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index) VALUES ($1, $2, $3, $4)',
        [reUuid, rUuid, resolved.uuid, exOrder]
      );

      for (let si = 0; si < (ex.sets ?? []).length; si++) {
        const s = ex.sets![si];
        await query(
          `INSERT INTO workout_routine_sets
             (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, target_weight, rpe_target, order_index)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            crypto.randomUUID(), reUuid,
            s.min_repetitions ?? null,
            s.max_repetitions ?? s.target_reps ?? null,
            s.target_weight ?? null,
            s.rpe_target ?? null,
            s.order_index ?? si,
          ]
        );
      }
    }
  }

  return toolResult({ plan_id: planUuid, routine_ids: routineIds, message: `Created routine "${name}" with ${routinesInput.length} day(s).` });
}

async function updateRoutine(args: Record<string, unknown>) {
  const { plan_id } = args as { plan_id: string };
  if (!plan_id) return toolError('plan_id is required');

  const plan = await queryOne('SELECT uuid FROM workout_plans WHERE uuid = $1', [plan_id]);
  if (!plan) return toolError(`Plan ${plan_id} not found`);

  const fields: string[] = [];
  const params: unknown[] = [];
  let p = 0;

  if (typeof args.name === 'string') { fields.push(`title = $${++p}`); params.push(args.name); }
  if (args.description !== undefined) { fields.push(`description = $${++p}`); params.push(args.description ?? null); }
  if (args.is_active === true) {
    await query('UPDATE workout_plans SET is_active = false WHERE is_active = true');
    fields.push(`is_active = $${++p}`); params.push(true);
  } else if (args.is_active === false) {
    fields.push(`is_active = $${++p}`); params.push(false);
  }

  if (fields.length === 0) return toolError('No fields to update');

  params.push(plan_id);
  const updated = await queryOne(
    `UPDATE workout_plans SET ${fields.join(', ')} WHERE uuid = $${++p} RETURNING *`,
    params
  );
  return toolResult(updated);
}

async function deleteRoutine(args: Record<string, unknown>) {
  const { plan_id } = args as { plan_id: string };
  if (!plan_id) return toolError('plan_id is required');

  const plan = await queryOne<{ title: string }>('SELECT title FROM workout_plans WHERE uuid = $1', [plan_id]);
  if (!plan) return toolError(`Plan ${plan_id} not found`);

  await query('DELETE FROM workout_plans WHERE uuid = $1', [plan_id]);
  return toolResult({ success: true, message: `Deleted plan "${plan.title}" and all its routines.` });
}

async function addExercise(args: Record<string, unknown>) {
  const { routine_id, exercise_id, exercise_name, order, sets = [] } = args as {
    routine_id: string;
    exercise_id?: string;
    exercise_name?: string;
    order?: number;
    sets?: Array<{
      target_weight?: number;
      target_reps?: number;
      max_repetitions?: number;
      min_repetitions?: number;
      rpe_target?: number;
      target_duration_seconds?: number;
    }>;
  };

  if (!routine_id) return toolError('routine_id is required');

  const routine = await queryOne('SELECT uuid FROM workout_routines WHERE uuid = $1', [routine_id]);
  if (!routine) return toolError(`Routine ${routine_id} not found`);

  const resolved = await resolveExercise({ exercise_id, exercise_name });
  if ('error' in resolved) return toolError(exerciseErrorMessage(resolved));

  const currentCount = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::int AS count FROM workout_routine_exercises WHERE workout_routine_uuid = $1',
    [routine_id]
  );
  const exerciseOrder = order ?? Number(currentCount?.count ?? 0);

  const reUuid = crypto.randomUUID();
  await query(
    'INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index) VALUES ($1, $2, $3, $4)',
    [reUuid, routine_id, resolved.uuid, exerciseOrder]
  );

  for (let si = 0; si < sets.length; si++) {
    const s = sets[si];
    await query(
      `INSERT INTO workout_routine_sets
         (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, target_weight, rpe_target, target_duration_seconds, order_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        crypto.randomUUID(), reUuid,
        s.min_repetitions ?? null,
        s.max_repetitions ?? s.target_reps ?? null,
        s.target_weight ?? null,
        s.rpe_target ?? null,
        s.target_duration_seconds ?? null,
        si,
      ]
    );
  }

  return toolResult({ routine_exercise_id: reUuid, exercise: resolved.title, sets_created: sets.length });
}

async function activateRoutine(args: Record<string, unknown>) {
  const { plan_uuid } = args as { plan_uuid: string };
  const plan = await queryOne('SELECT uuid, title FROM workout_plans WHERE uuid = $1', [plan_uuid]);
  if (!plan) return toolError(`Plan ${plan_uuid} not found`);

  await query('UPDATE workout_plans SET is_active = false WHERE is_active = true');
  await query('UPDATE workout_plans SET is_active = true WHERE uuid = $1', [plan_uuid]);

  return toolResult({ activated: plan_uuid, message: `Plan is now active.` });
}

async function updateSetTargets(args: Record<string, unknown>) {
  const { routine_uuid, exercise_uuid, sets } = args as {
    routine_uuid: string;
    exercise_uuid: string;
    sets: Array<{
      order_index: number;
      min_repetitions?: number;
      max_repetitions?: number;
      target_duration_seconds?: number;
    }>;
  };

  const re = await queryOne<{ uuid: string }>(
    'SELECT uuid FROM workout_routine_exercises WHERE workout_routine_uuid = $1 AND exercise_uuid = $2 LIMIT 1',
    [routine_uuid, exercise_uuid]
  );
  if (!re) return toolError(`Exercise ${exercise_uuid} not found in routine ${routine_uuid}`);

  let updated = 0;
  for (const s of sets) {
    // COALESCE pattern: undefined fields don't overwrite. Mode-aware
    // callers (time-mode) pass target_duration_seconds and leave reps
    // null; rep-mode callers do the inverse.
    const result = await query(
      `UPDATE workout_routine_sets
       SET min_repetitions = COALESCE($1, min_repetitions),
           max_repetitions = COALESCE($2, max_repetitions),
           target_duration_seconds = COALESCE($3, target_duration_seconds)
       WHERE workout_routine_exercise_uuid = $4 AND order_index = $5`,
      [
        s.min_repetitions ?? null,
        s.max_repetitions ?? null,
        s.target_duration_seconds ?? null,
        re.uuid,
        s.order_index,
      ]
    );
    if (result.length >= 0) updated++;
  }

  return toolResult({ updated_sets: updated });
}

async function swapExercise(args: Record<string, unknown>) {
  const { routine_id, old_exercise_id, old_exercise_name, new_exercise_id, new_exercise_name } = args as {
    routine_id: string;
    old_exercise_id?: string;
    old_exercise_name?: string;
    new_exercise_id?: string;
    new_exercise_name?: string;
  };

  if (!routine_id) return toolError('routine_id is required');

  const routine = await queryOne('SELECT uuid FROM workout_routines WHERE uuid = $1', [routine_id]);
  if (!routine) return toolError(`Routine ${routine_id} not found`);

  const oldResolved = await resolveExercise({ exercise_id: old_exercise_id, exercise_name: old_exercise_name });
  if ('error' in oldResolved) return toolError(`Old exercise — ${exerciseErrorMessage(oldResolved)}`);

  const newResolved = await resolveExercise({ exercise_id: new_exercise_id, exercise_name: new_exercise_name });
  if ('error' in newResolved) return toolError(`New exercise — ${exerciseErrorMessage(newResolved)}`);

  const re = await queryOne<{ uuid: string }>(
    'SELECT uuid FROM workout_routine_exercises WHERE workout_routine_uuid = $1 AND exercise_uuid = $2 LIMIT 1',
    [routine_id, oldResolved.uuid]
  );
  if (!re) return toolError(`Exercise "${oldResolved.title}" not found in this routine`);

  const setCount = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::int AS count FROM workout_routine_sets WHERE workout_routine_exercise_uuid = $1',
    [re.uuid]
  );

  await query(
    'UPDATE workout_routine_exercises SET exercise_uuid = $1 WHERE uuid = $2',
    [newResolved.uuid, re.uuid]
  );

  return toolResult({
    success: true,
    swapped_from: oldResolved.title,
    swapped_to: newResolved.title,
    sets_preserved: Number(setCount?.count ?? 0),
  });
}

async function removeExercise(args: Record<string, unknown>) {
  const { routine_id, exercise_id, exercise_name } = args as {
    routine_id: string;
    exercise_id?: string;
    exercise_name?: string;
  };

  if (!routine_id) return toolError('routine_id is required');

  const resolved = await resolveExercise({ exercise_id, exercise_name });
  if ('error' in resolved) return toolError(exerciseErrorMessage(resolved));

  const re = await queryOne<{ uuid: string }>(
    'SELECT uuid FROM workout_routine_exercises WHERE workout_routine_uuid = $1 AND exercise_uuid = $2 LIMIT 1',
    [routine_id, resolved.uuid]
  );
  if (!re) return toolError(`Exercise "${resolved.title}" not found in this routine`);

  await query('DELETE FROM workout_routine_exercises WHERE uuid = $1', [re.uuid]);
  return toolResult({ success: true, removed: resolved.title });
}

async function updateSets(args: Record<string, unknown>) {
  const { routine_exercise_id, sets } = args as {
    routine_exercise_id: string;
    sets: Array<{
      target_weight?: number;
      target_reps?: number;
      min_repetitions?: number;
      max_repetitions?: number;
      rpe_target?: number;
      target_duration_seconds?: number;
    }>;
  };

  if (!routine_exercise_id) return toolError('routine_exercise_id is required');
  if (!Array.isArray(sets)) return toolError('sets is required');

  const re = await queryOne('SELECT uuid FROM workout_routine_exercises WHERE uuid = $1', [routine_exercise_id]);
  if (!re) return toolError(`Routine exercise ${routine_exercise_id} not found`);

  await query('DELETE FROM workout_routine_sets WHERE workout_routine_exercise_uuid = $1', [routine_exercise_id]);

  for (let i = 0; i < sets.length; i++) {
    const s = sets[i];
    await query(
      `INSERT INTO workout_routine_sets
         (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, target_weight, rpe_target, target_duration_seconds, order_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        crypto.randomUUID(), routine_exercise_id,
        s.min_repetitions ?? null,
        s.max_repetitions ?? s.target_reps ?? null,
        s.target_weight ?? null,
        s.rpe_target ?? null,
        s.target_duration_seconds ?? null,
        i,
      ]
    );
  }

  return toolResult({ sets_updated: sets.length });
}

async function logBodyComp(args: Record<string, unknown>) {
  const { weight_kg, body_fat_pct, lean_mass_kg, height_cm, measurements = [], notes } = args as {
    weight_kg?: number; body_fat_pct?: number; lean_mass_kg?: number;
    height_cm?: number; measurements?: Array<{ site: string; value_cm: number }>;
    notes?: string;
  };

  const logged: string[] = [];

  if (weight_kg !== undefined) {
    await query(
      'INSERT INTO bodyweight_logs (uuid, weight_kg, logged_at) VALUES ($1, $2, NOW())',
      [crypto.randomUUID(), weight_kg]
    );
    logged.push('bodyweight');
  }

  if (body_fat_pct !== undefined || lean_mass_kg !== undefined || height_cm !== undefined) {
    await query(
      `INSERT INTO body_spec_logs (uuid, weight_kg, body_fat_pct, lean_mass_kg, height_cm, notes, measured_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [crypto.randomUUID(), weight_kg ?? null, body_fat_pct ?? null, lean_mass_kg ?? null, height_cm ?? null, notes ?? null]
    );
    logged.push('body_spec');
  }

  for (const m of measurements as Array<{ site: string; value_cm: number }>) {
    await query(
      'INSERT INTO measurement_logs (uuid, site, value_cm, measured_at) VALUES ($1, $2, $3, NOW())',
      [crypto.randomUUID(), m.site, m.value_cm]
    );
  }
  if ((measurements as unknown[]).length > 0) logged.push(`${(measurements as unknown[]).length} measurements`);

  return toolResult({ logged, message: `Logged: ${logged.join(', ') || 'nothing'}.` });
}

async function listCoachingNotes(args: Record<string, unknown>) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let p = 0;

  if (args.pinned_only === true) conditions.push('pinned = true');
  if (typeof args.context === 'string') { conditions.push(`context = $${++p}`); params.push(args.context); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Number(args.limit ?? 50), 200);
  params.push(limit);

  const rows = await query(
    `SELECT * FROM coaching_notes ${where} ORDER BY pinned DESC, created_at DESC LIMIT $${++p}`,
    params
  );
  return toolResult(rows);
}

async function createCoachingNote(args: Record<string, unknown>) {
  const { note, context = null, pinned = false } = args;
  if (typeof note !== 'string') return toolError('note is required');

  const row = await queryOne(
    `INSERT INTO coaching_notes (uuid, note, context, pinned) VALUES ($1, $2, $3, $4) RETURNING *`,
    [crypto.randomUUID(), note, context ?? null, Boolean(pinned)]
  );
  return toolResult(row);
}

async function updateCoachingNote(args: Record<string, unknown>) {
  const { uuid } = args;
  if (typeof uuid !== 'string') return toolError('uuid is required');

  const fields: string[] = [];
  const params: unknown[] = [];
  let p = 0;

  if (typeof args.note === 'string') { fields.push(`note = $${++p}`); params.push(args.note); }
  if (args.context !== undefined) { fields.push(`context = $${++p}`); params.push(args.context ?? null); }
  if (typeof args.pinned === 'boolean') { fields.push(`pinned = $${++p}`); params.push(args.pinned); }

  if (fields.length === 0) return toolError('No fields to update');

  params.push(uuid);
  const row = await queryOne(
    `UPDATE coaching_notes SET ${fields.join(', ')} WHERE uuid = $${++p} RETURNING *`,
    params
  );
  return row ? toolResult(row) : toolError('Note not found');
}

async function deleteCoachingNote(args: Record<string, unknown>) {
  const { uuid } = args;
  if (typeof uuid !== 'string') return toolError('uuid is required');
  await query(`DELETE FROM coaching_notes WHERE uuid = $1`, [uuid]);
  return toolResult({ deleted: uuid });
}

async function listTrainingBlocks() {
  const rows = await query(`SELECT * FROM training_blocks ORDER BY started_at DESC`);
  return toolResult(rows);
}

async function createTrainingBlock(args: Record<string, unknown>) {
  const { name, goal, started_at, ended_at = null, workout_plan_uuid = null, notes = null } = args;
  if (typeof name !== 'string') return toolError('name is required');
  if (typeof goal !== 'string') return toolError('goal is required');
  if (typeof started_at !== 'string') return toolError('started_at is required');

  const row = await queryOne(
    `INSERT INTO training_blocks (uuid, name, goal, started_at, ended_at, workout_plan_uuid, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [crypto.randomUUID(), name, goal, started_at, ended_at ?? null, workout_plan_uuid ?? null, notes ?? null]
  );
  return toolResult(row);
}

async function updateTrainingBlock(args: Record<string, unknown>) {
  const { uuid } = args;
  if (typeof uuid !== 'string') return toolError('uuid is required');

  const fields: string[] = [];
  const params: unknown[] = [];
  let p = 0;

  if (typeof args.name === 'string') { fields.push(`name = $${++p}`); params.push(args.name); }
  if (typeof args.goal === 'string') { fields.push(`goal = $${++p}`); params.push(args.goal); }
  if (typeof args.started_at === 'string') { fields.push(`started_at = $${++p}`); params.push(args.started_at); }
  if (args.ended_at !== undefined) { fields.push(`ended_at = $${++p}`); params.push(args.ended_at ?? null); }
  if (args.notes !== undefined) { fields.push(`notes = $${++p}`); params.push(args.notes ?? null); }
  if (args.workout_plan_uuid !== undefined) { fields.push(`workout_plan_uuid = $${++p}`); params.push(args.workout_plan_uuid ?? null); }

  if (fields.length === 0) return toolError('No fields to update');

  params.push(uuid);
  const row = await queryOne(
    `UPDATE training_blocks SET ${fields.join(', ')} WHERE uuid = $${++p} RETURNING *`,
    params
  );
  return row ? toolResult(row) : toolError('Training block not found');
}

async function deleteTrainingBlock(args: Record<string, unknown>) {
  const { uuid } = args;
  if (typeof uuid !== 'string') return toolError('uuid is required');
  await query(`DELETE FROM training_blocks WHERE uuid = $1`, [uuid]);
  return toolResult({ deleted: uuid });
}

// ── InBody scan catalog tools ─────────────────────────────────────────────────

import {
  listInbodyScans as dbListInbodyScans,
  getInbodyScan as dbGetInbodyScan,
  getLatestInbodyScan as dbGetLatestInbodyScan,
  createInbodyScan as dbCreateInbodyScan,
  updateInbodyScan as dbUpdateInbodyScan,
  deleteInbodyScan as dbDeleteInbodyScan,
  getBodyGoals as dbGetBodyGoals,
  upsertBodyGoal as dbUpsertBodyGoal,
  deleteBodyGoal as dbDeleteBodyGoal,
  getBodyNormRanges as dbGetBodyNormRanges,
  INBODY_NUMERIC_COLUMNS,
  type InbodyScanInput,
} from '@/db/queries';

async function logInbodyScan(args: Record<string, unknown>) {
  if (typeof args.scanned_at !== 'string') return toolError('scanned_at (ISO string) is required');
  const scan = await dbCreateInbodyScan(args as unknown as InbodyScanInput);
  return toolResult(scan);
}

async function updateInbodyScanTool(args: Record<string, unknown>) {
  const { uuid, ...rest } = args;
  if (typeof uuid !== 'string') return toolError('uuid is required');
  const scan = await dbUpdateInbodyScan(uuid, rest as Partial<InbodyScanInput>);
  if (!scan) return toolError(`InBody scan not found: ${uuid}`);
  return toolResult(scan);
}

async function getInbodyScanTool(args: Record<string, unknown>) {
  if (args.latest === true) {
    const scan = await dbGetLatestInbodyScan();
    return toolResult(scan);
  }
  if (typeof args.uuid !== 'string') return toolError('Provide uuid or { latest: true }');
  const scan = await dbGetInbodyScan(args.uuid);
  if (!scan) return toolError(`InBody scan not found: ${args.uuid}`);
  return toolResult(scan);
}

async function listInbodyScansTool(args: Record<string, unknown>) {
  const limit = typeof args.limit === 'number' ? args.limit : 90;
  const from = typeof args.from === 'string' ? args.from : undefined;
  const to = typeof args.to === 'string' ? args.to : undefined;
  const scans = await dbListInbodyScans({ limit, from, to });
  return toolResult(scans);
}

async function deleteInbodyScanTool(args: Record<string, unknown>) {
  if (typeof args.uuid !== 'string') return toolError('uuid is required');
  await dbDeleteInbodyScan(args.uuid);
  return toolResult({ deleted: args.uuid });
}

async function compareInbodyScans(args: Record<string, unknown>) {
  const { a_uuid, b_uuid } = args;
  if (typeof a_uuid !== 'string' || typeof b_uuid !== 'string') {
    return toolError('Both a_uuid and b_uuid are required');
  }
  const [a, b] = await Promise.all([dbGetInbodyScan(a_uuid), dbGetInbodyScan(b_uuid)]);
  if (!a) return toolError(`Scan not found: ${a_uuid}`);
  if (!b) return toolError(`Scan not found: ${b_uuid}`);

  const deltas: Record<string, { a: number | null; b: number | null; delta: number | null; pct_change: number | null }> = {};
  for (const col of INBODY_NUMERIC_COLUMNS) {
    const aRec = a as unknown as Record<string, number | null>;
    const bRec = b as unknown as Record<string, number | null>;
    const av = aRec[col] ?? null;
    const bv = bRec[col] ?? null;
    let delta: number | null = null;
    let pct: number | null = null;
    if (av != null && bv != null) {
      delta = bv - av;
      pct = av !== 0 ? (delta / Math.abs(av)) * 100 : null;
    }
    deltas[col] = { a: av, b: bv, delta, pct_change: pct };
  }
  return toolResult({
    a: { uuid: a.uuid, scanned_at: a.scanned_at },
    b: { uuid: b.uuid, scanned_at: b.scanned_at },
    deltas,
  });
}

async function getBodyGoalsTool() {
  const goals = await dbGetBodyGoals();
  return toolResult(goals);
}

async function setBodyGoal(args: Record<string, unknown>) {
  const { metric_key, target_value, unit, direction, notes } = args;
  if (typeof metric_key !== 'string') return toolError('metric_key is required');
  const tv = Number(target_value);
  if (!Number.isFinite(tv)) return toolError('target_value must be numeric');
  if (typeof unit !== 'string') return toolError('unit is required');
  if (direction !== 'higher' && direction !== 'lower' && direction !== 'match') {
    return toolError('direction must be one of higher|lower|match');
  }
  const goal = await dbUpsertBodyGoal(metric_key, {
    target_value: tv,
    unit,
    direction,
    notes: typeof notes === 'string' ? notes : null,
  });
  return toolResult(goal);
}

async function deleteBodyGoalTool(args: Record<string, unknown>) {
  if (typeof args.metric_key !== 'string') return toolError('metric_key is required');
  await dbDeleteBodyGoal(args.metric_key);
  return toolResult({ deleted: args.metric_key });
}

async function getBodyNormRangesTool(args: Record<string, unknown>) {
  const sex = args.sex;
  if (sex !== 'M' && sex !== 'F') return toolError('sex must be "M" or "F"');
  const ranges = await dbGetBodyNormRanges(sex);
  return toolResult(ranges);
}

// ── Photo tracking tools ──────────────────────────────────────────────────────

import { put } from '@vercel/blob';
import {
  createProgressPhoto as dbCreateProgressPhoto,
  listProgressPhotos as dbListProgressPhotos,
  createInspoPhoto as dbCreateInspoPhoto,
  listInspoPhotos as dbListInspoPhotos,
} from '@/db/queries';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
};

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
};

async function resolveImageBuffer(
  args: Record<string, unknown>,
): Promise<{ buffer: Buffer; contentType: string; ext: string } | { error: string }> {
  const explicitMime =
    typeof args.mime_type === 'string' ? args.mime_type.toLowerCase() : undefined;
  let contentType = explicitMime ?? 'image/jpeg';
  let buffer: Buffer;

  if (typeof args.image_base64 === 'string' && args.image_base64.length > 0) {
    let b64 = args.image_base64;
    const dataMatch = b64.match(/^data:([^;]+);base64,(.+)$/);
    if (dataMatch) {
      if (!explicitMime) contentType = dataMatch[1].toLowerCase();
      b64 = dataMatch[2];
    }
    buffer = Buffer.from(b64, 'base64');
    if (buffer.length === 0) return { error: 'image_base64 decoded to empty buffer' };
  } else if (typeof args.image_url === 'string' && args.image_url.length > 0) {
    let res: Response;
    try {
      res = await fetch(args.image_url);
    } catch (e) {
      return { error: `Failed to fetch image_url: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!res.ok) return { error: `image_url fetch failed: ${res.status} ${res.statusText}` };
    if (!explicitMime) {
      const headerType = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (headerType && headerType.startsWith('image/')) {
        contentType = headerType;
      } else {
        const m = args.image_url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
        const urlExt = m?.[1]?.toLowerCase();
        if (urlExt && EXT_TO_MIME[urlExt]) contentType = EXT_TO_MIME[urlExt];
      }
    }
    buffer = Buffer.from(await res.arrayBuffer());
  } else {
    return { error: 'Provide either image_base64 or image_url' };
  }

  const ext = MIME_TO_EXT[contentType] ?? 'jpg';
  return { buffer, contentType, ext };
}

async function uploadProgressPhotoTool(args: Record<string, unknown>) {
  const pose = args.pose;
  if (pose !== 'front' && pose !== 'side' && pose !== 'back') {
    return toolError('pose must be one of: front, side, back');
  }
  const resolved = await resolveImageBuffer(args);
  if ('error' in resolved) return toolError(resolved.error);

  const pathname = `progress-photos/${crypto.randomUUID()}-${pose}.${resolved.ext}`;
  const blob = await put(pathname, resolved.buffer, {
    access: 'public',
    contentType: resolved.contentType,
  });

  const photo = await dbCreateProgressPhoto({
    blob_url: blob.url,
    pose,
    notes: typeof args.notes === 'string' ? args.notes : null,
    taken_at: typeof args.taken_at === 'string' ? args.taken_at : undefined,
  });
  return toolResult(photo);
}

async function uploadInspoPhotoTool(args: Record<string, unknown>) {
  const resolved = await resolveImageBuffer(args);
  if ('error' in resolved) return toolError(resolved.error);

  const pathname = `inspo-photos/${crypto.randomUUID()}.${resolved.ext}`;
  const blob = await put(pathname, resolved.buffer, {
    access: 'public',
    contentType: resolved.contentType,
  });

  const photo = await dbCreateInspoPhoto({
    blob_url: blob.url,
    notes: typeof args.notes === 'string' ? args.notes : null,
    taken_at: typeof args.taken_at === 'string' ? args.taken_at : undefined,
    burst_group_id: typeof args.burst_group_id === 'string' ? args.burst_group_id : null,
  });
  return toolResult(photo);
}

async function listProgressPhotosTool(args: Record<string, unknown>) {
  const limit = typeof args.limit === 'number' ? args.limit : 50;
  const photos = await dbListProgressPhotos(limit);
  return toolResult(photos);
}

async function listInspoPhotosTool(args: Record<string, unknown>) {
  const limit = typeof args.limit === 'number' ? args.limit : 50;
  const photos = await dbListInspoPhotos(limit);
  return toolResult(photos);
}

// ── HealthKit tools ───────────────────────────────────────────────────────────

type HealthKitStatus = 'connected' | 'not_requested' | 'revoked' | 'unavailable';

type SnapshotField =
  | 'sleep_last_night' | 'hrv' | 'resting_hr' | 'vo2_max'
  | 'activity_today' | 'unlogged_workouts_24h' | 'data_quality';

const VALID_SERIES_METRICS = [
  'steps', 'active_energy', 'basal_energy', 'exercise_minutes',
  'heart_rate', 'hrv', 'resting_hr', 'vo2_max',
  'sleep_asleep', 'sleep_rem', 'sleep_deep', 'sleep_core', 'sleep_awake', 'sleep_inbed',
] as const;

const VALID_WORKOUT_SOURCES = ['user_logged', 'matched', 'hk_only', 'all'] as const;

async function getHealthKitStatus(): Promise<{ status: HealthKitStatus; last_sync_at: string | null; last_successful_sync_at: string | null }> {
  const states = await query<{
    last_sync_at: string | null;
    last_successful_sync_at: string | null;
    last_error: string | null;
  }>(`SELECT last_sync_at, last_successful_sync_at, last_error
      FROM healthkit_sync_state`);

  if (states.length === 0) {
    return { status: 'not_requested', last_sync_at: null, last_successful_sync_at: null };
  }

  const anySuccess = states.some(s => s.last_successful_sync_at != null);
  const allRevoked = states.length > 0 && states.every(s => s.last_error === 'permission_revoked');

  const lastSync = states.reduce<string | null>((acc, s) => {
    if (!s.last_sync_at) return acc;
    return !acc || s.last_sync_at > acc ? s.last_sync_at : acc;
  }, null);

  const lastSuccess = states.reduce<string | null>((acc, s) => {
    if (!s.last_successful_sync_at) return acc;
    return !acc || s.last_successful_sync_at > acc ? s.last_successful_sync_at : acc;
  }, null);

  if (allRevoked) return { status: 'revoked', last_sync_at: lastSync, last_successful_sync_at: lastSuccess };
  if (!anySuccess) return { status: 'not_requested', last_sync_at: lastSync, last_successful_sync_at: null };
  return { status: 'connected', last_sync_at: lastSync, last_successful_sync_at: lastSuccess };
}

function notConnectedResponse(status: HealthKitStatus) {
  const reason = status === 'unavailable' ? 'unavailable'
    : status === 'revoked' ? 'revoked'
    : 'not_requested';
  return {
    status: 'not_connected' as const,
    reason,
    message: 'Ask the user to open Rebirth → Settings → Apple Health to connect their HealthKit data.',
  };
}

async function getHealthSnapshot(args: Record<string, unknown>) {
  const status = await getHealthKitStatus();
  if (status.status !== 'connected') return toolResult(notConnectedResponse(status.status));

  const asOf = typeof args.as_of === 'string' ? args.as_of.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const windowDays = typeof args.window_days === 'number' ? Math.min(Math.max(args.window_days, 1), 90) : 7;
  const fields = Array.isArray(args.fields) ? (args.fields as string[]) : null;

  const includes = (f: SnapshotField) => fields == null || fields.includes(f);

  // Dates
  const asOfDate = new Date(asOf);
  const yesterday = new Date(asOfDate);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);

  const windowStart = new Date(asOfDate);
  windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);
  const windowStartIso = windowStart.toISOString().slice(0, 10);

  const baselineStart = new Date(asOfDate);
  baselineStart.setUTCDate(baselineStart.getUTCDate() - 30);
  const baselineStartIso = baselineStart.toISOString().slice(0, 10);

  const out: Record<string, unknown> = { as_of: asOf };

  if (includes('sleep_last_night')) {
    const rows = await query<{ metric: string; value_sum: number | null }>(
      `SELECT metric, value_sum FROM healthkit_daily
       WHERE date = $1 AND metric LIKE 'sleep_%'`,
      [yesterdayIso]
    );
    if (rows.length > 0) {
      const byMetric = Object.fromEntries(rows.map(r => [r.metric, r.value_sum]));
      out.sleep_last_night = {
        date: yesterdayIso,
        total_asleep_min: byMetric['sleep_asleep'] ?? null,
        rem_min: byMetric['sleep_rem'] ?? null,
        deep_min: byMetric['sleep_deep'] ?? null,
        core_min: byMetric['sleep_core'] ?? null,
        awake_min: byMetric['sleep_awake'] ?? null,
        in_bed_min: byMetric['sleep_inbed'] ?? null,
      };
    }
  }

  if (includes('hrv')) {
    const last = await queryOne<{ value_avg: number | null }>(
      `SELECT value_avg FROM healthkit_daily
       WHERE metric = 'hrv' AND date <= $1 ORDER BY date DESC LIMIT 1`,
      [asOf]
    );
    const window = await queryOne<{ avg: number | null }>(
      `SELECT AVG(value_avg) AS avg FROM healthkit_daily
       WHERE metric = 'hrv' AND date > $1 AND date <= $2`,
      [windowStartIso, asOf]
    );
    const baseline = await queryOne<{ avg: number | null }>(
      `SELECT AVG(value_avg) AS avg FROM healthkit_daily
       WHERE metric = 'hrv' AND date > $1 AND date <= $2`,
      [baselineStartIso, asOf]
    );
    if (last || window?.avg || baseline?.avg) {
      const deltaPct = (last?.value_avg != null && baseline?.avg != null && baseline.avg > 0)
        ? Math.round(((last.value_avg - baseline.avg) / baseline.avg) * 1000) / 10
        : null;
      out.hrv = {
        last: last?.value_avg ?? null,
        window_avg: window?.avg ?? null,
        baseline_30d_avg: baseline?.avg ?? null,
        delta_pct: deltaPct,
      };
    }
  }

  if (includes('resting_hr')) {
    const last = await queryOne<{ value_avg: number | null }>(
      `SELECT value_avg FROM healthkit_daily
       WHERE metric = 'resting_hr' AND date <= $1 ORDER BY date DESC LIMIT 1`,
      [asOf]
    );
    const window = await queryOne<{ avg: number | null }>(
      `SELECT AVG(value_avg) AS avg FROM healthkit_daily
       WHERE metric = 'resting_hr' AND date > $1 AND date <= $2`,
      [windowStartIso, asOf]
    );
    const baseline = await queryOne<{ avg: number | null }>(
      `SELECT AVG(value_avg) AS avg FROM healthkit_daily
       WHERE metric = 'resting_hr' AND date > $1 AND date <= $2`,
      [baselineStartIso, asOf]
    );
    if (last || window?.avg || baseline?.avg) {
      const deltaBpm = (last?.value_avg != null && baseline?.avg != null)
        ? Math.round((last.value_avg - baseline.avg) * 10) / 10
        : null;
      out.resting_hr = {
        last: last?.value_avg ?? null,
        window_avg: window?.avg ?? null,
        baseline_30d_avg: baseline?.avg ?? null,
        delta_bpm: deltaBpm,
      };
    }
  }

  if (includes('vo2_max')) {
    const latest = await queryOne<{ value_avg: number | null; date: string }>(
      `SELECT value_avg, date::text AS date FROM healthkit_daily
       WHERE metric = 'vo2_max' AND date <= $1 ORDER BY date DESC LIMIT 1`,
      [asOf]
    );
    const baseline = await queryOne<{ avg: number | null }>(
      `SELECT AVG(value_avg) AS avg FROM healthkit_daily
       WHERE metric = 'vo2_max' AND date > $1 AND date <= $2`,
      [baselineStartIso, asOf]
    );
    if (latest?.value_avg || baseline?.avg) {
      const trend = (latest?.value_avg != null && baseline?.avg != null)
        ? Math.round((latest.value_avg - baseline.avg) * 10) / 10
        : null;
      out.vo2_max = {
        current: latest?.value_avg ?? null,
        trend_30d: trend,
      };
    }
  }

  if (includes('activity_today')) {
    const rows = await query<{ metric: string; value_sum: number | null }>(
      `SELECT metric, value_sum FROM healthkit_daily
       WHERE date = $1 AND metric IN ('steps','active_energy','basal_energy','exercise_minutes')`,
      [asOf]
    );
    const byMetric = Object.fromEntries(rows.map(r => [r.metric, r.value_sum]));
    out.activity_today = {
      steps: byMetric['steps'] ?? null,
      active_kcal: byMetric['active_energy'] ?? null,
      basal_kcal: byMetric['basal_energy'] ?? null,
      exercise_min: byMetric['exercise_minutes'] ?? null,
    };
  }

  if (includes('unlogged_workouts_24h')) {
    const unlogged = await query<{
      hk_uuid: string; activity_type: string; start_at: string;
      duration_s: number; total_energy_kcal: number | null;
    }>(
      `SELECT hk_uuid, activity_type, start_at, duration_s, total_energy_kcal
       FROM healthkit_workouts
       WHERE source = 'hk_only' AND start_at >= NOW() - interval '24 hours'
       ORDER BY start_at DESC`
    );
    out.unlogged_workouts_24h = unlogged.map(u => ({
      hk_uuid: u.hk_uuid,
      activity_type: u.activity_type,
      start: u.start_at,
      duration_s: u.duration_s,
      energy_kcal: u.total_energy_kcal,
    }));
  }

  if (includes('data_quality')) {
    const windowCounts = await query<{ metric: string; count: number }>(
      `SELECT metric, COUNT(*)::int AS count FROM healthkit_daily
       WHERE date > $1 AND date <= $2 AND metric IN ('hrv','sleep_asleep','resting_hr','steps')
       GROUP BY metric`,
      [windowStartIso, asOf]
    );
    const byMetric = Object.fromEntries(windowCounts.map(r => [r.metric, r.count]));

    // Missing metrics: zero rows in the last window_days for a coaching-relevant metric
    const missing: string[] = [];
    for (const m of ['hrv', 'sleep_asleep', 'resting_hr', 'steps']) {
      if (!byMetric[m]) missing.push(m);
    }

    out.data_quality = {
      hrv_samples_window: byMetric['hrv'] ?? 0,
      sleep_nights_window: byMetric['sleep_asleep'] ?? 0,
      missing_metrics: missing,
      last_sync_at: status.last_sync_at,
      last_successful_sync_at: status.last_successful_sync_at,
    };
  }

  return toolResult(out);
}

async function getHealthSeries(args: Record<string, unknown>) {
  const status = await getHealthKitStatus();
  if (status.status !== 'connected') return toolResult(notConnectedResponse(status.status));

  const metric = typeof args.metric === 'string' ? args.metric : null;
  if (!metric || !VALID_SERIES_METRICS.includes(metric as typeof VALID_SERIES_METRICS[number])) {
    return toolError(`metric must be one of: ${VALID_SERIES_METRICS.join(', ')}`);
  }
  const from = typeof args.from === 'string' ? args.from.slice(0, 10) : null;
  const to = typeof args.to === 'string' ? args.to.slice(0, 10) : new Date().toISOString().slice(0, 10);
  if (!from) return toolError('from (YYYY-MM-DD) is required');
  const bucket = args.bucket === 'week' ? 'week' : 'day';

  if (bucket === 'day') {
    const rows = await query<{
      date: string; value_min: number | null; value_max: number | null;
      value_avg: number | null; value_sum: number | null; count: number | null;
    }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date,
              value_min, value_max, value_avg, value_sum, count
       FROM healthkit_daily
       WHERE metric = $1 AND date >= $2 AND date <= $3
       ORDER BY date`,
      [metric, from, to]
    );
    return toolResult(rows);
  }

  // Weekly bucketing (ISO week, Mon-Sun)
  const rows = await query<{
    week_start: string; value_min: number | null; value_max: number | null;
    value_avg: number | null; value_sum: number | null; count: number | null;
  }>(
    `SELECT to_char(date_trunc('week', date)::date, 'YYYY-MM-DD') AS week_start,
            MIN(value_min) AS value_min,
            MAX(value_max) AS value_max,
            AVG(value_avg) AS value_avg,
            SUM(value_sum) AS value_sum,
            SUM(count) AS count
     FROM healthkit_daily
     WHERE metric = $1 AND date >= $2 AND date <= $3
     GROUP BY date_trunc('week', date)
     ORDER BY week_start`,
    [metric, from, to]
  );
  return toolResult(rows);
}

async function getHealthWorkoutsTool(args: Record<string, unknown>) {
  const status = await getHealthKitStatus();
  if (status.status !== 'connected') return toolResult(notConnectedResponse(status.status));

  const from = typeof args.from === 'string' ? args.from : null;
  const to = typeof args.to === 'string' ? args.to : new Date().toISOString();
  if (!from) return toolError('from (ISO) is required');
  const sourceArg = (typeof args.source === 'string' ? args.source : 'all') as typeof VALID_WORKOUT_SOURCES[number];
  if (!VALID_WORKOUT_SOURCES.includes(sourceArg)) {
    return toolError(`source must be one of: ${VALID_WORKOUT_SOURCES.join(', ')}`);
  }

  let sql = `SELECT hk_uuid, activity_type,
                    to_char(start_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_at,
                    to_char(end_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_at,
                    duration_s, total_energy_kcal, total_distance_m,
                    avg_heart_rate, max_heart_rate,
                    source_name, source, workout_uuid
             FROM healthkit_workouts
             WHERE start_at >= $1::timestamptz AND start_at <= $2::timestamptz`;
  const params: unknown[] = [from, to];
  if (sourceArg !== 'all') {
    params.push(sourceArg);
    sql += ` AND source = $${params.length}`;
  }
  sql += ` ORDER BY start_at DESC`;

  const rows = await query(sql, params);
  return toolResult(rows);
}

// ── HRT Timeline tools ────────────────────────────────────────────────────────

interface HrtTimelinePeriodRow {
  uuid: string;
  name: string;
  started_at: string;
  ended_at: string | null;
  doses_e: string | null;
  doses_t_blocker: string | null;
  doses_other: string[];
  notes: string | null;
}

async function listHrtTimeline(args: Record<string, unknown>) {
  const limit = Math.min(Number(args.limit ?? 100), 500);
  const rows = await query<HrtTimelinePeriodRow>(
    `SELECT uuid, name,
            to_char(started_at, 'YYYY-MM-DD') AS started_at,
            CASE WHEN ended_at IS NULL THEN NULL ELSE to_char(ended_at, 'YYYY-MM-DD') END AS ended_at,
            doses_e, doses_t_blocker, doses_other, notes
       FROM hrt_timeline_periods
      ORDER BY started_at DESC
      LIMIT $1`,
    [limit],
  );
  return toolResult(rows);
}

async function createHrtTimelinePeriod(args: Record<string, unknown>) {
  const { name, started_at } = args;
  if (typeof name !== 'string' || !name.trim()) return toolError('name is required');
  if (typeof started_at !== 'string') return toolError('started_at is required (YYYY-MM-DD)');

  const dosesOther = Array.isArray(args.doses_other) ? args.doses_other : [];

  const row = await queryOne(
    `INSERT INTO hrt_timeline_periods
       (uuid, name, started_at, ended_at, doses_e, doses_t_blocker, doses_other, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     RETURNING uuid, name,
       to_char(started_at, 'YYYY-MM-DD') AS started_at,
       CASE WHEN ended_at IS NULL THEN NULL ELSE to_char(ended_at, 'YYYY-MM-DD') END AS ended_at,
       doses_e, doses_t_blocker, doses_other, notes`,
    [
      crypto.randomUUID(),
      name.trim(),
      started_at,
      typeof args.ended_at === 'string' ? args.ended_at : null,
      typeof args.doses_e === 'string' ? args.doses_e : null,
      typeof args.doses_t_blocker === 'string' ? args.doses_t_blocker : null,
      JSON.stringify(dosesOther),
      typeof args.notes === 'string' ? args.notes : null,
    ],
  );
  return toolResult(row);
}

async function updateHrtTimelinePeriod(args: Record<string, unknown>) {
  const { uuid } = args;
  if (typeof uuid !== 'string') return toolError('uuid is required');

  const fields: string[] = [];
  const params: unknown[] = [];
  let p = 0;

  if (typeof args.name === 'string') { fields.push(`name = $${++p}`); params.push(args.name); }
  if (typeof args.started_at === 'string') { fields.push(`started_at = $${++p}`); params.push(args.started_at); }
  if (args.ended_at !== undefined) { fields.push(`ended_at = $${++p}`); params.push(args.ended_at ?? null); }
  if (args.doses_e !== undefined) { fields.push(`doses_e = $${++p}`); params.push(args.doses_e ?? null); }
  if (args.doses_t_blocker !== undefined) { fields.push(`doses_t_blocker = $${++p}`); params.push(args.doses_t_blocker ?? null); }
  if (Array.isArray(args.doses_other)) { fields.push(`doses_other = $${++p}::jsonb`); params.push(JSON.stringify(args.doses_other)); }
  if (args.notes !== undefined) { fields.push(`notes = $${++p}`); params.push(args.notes ?? null); }

  if (fields.length === 0) return toolError('No fields to update');

  params.push(uuid);
  const row = await queryOne(
    `UPDATE hrt_timeline_periods SET ${fields.join(', ')} WHERE uuid = $${++p}
     RETURNING uuid, name,
       to_char(started_at, 'YYYY-MM-DD') AS started_at,
       CASE WHEN ended_at IS NULL THEN NULL ELSE to_char(ended_at, 'YYYY-MM-DD') END AS ended_at,
       doses_e, doses_t_blocker, doses_other, notes`,
    params,
  );
  return row ? toolResult(row) : toolError('HRT timeline period not found');
}

async function deleteHrtTimelinePeriod(args: Record<string, unknown>) {
  const { uuid } = args;
  if (typeof uuid !== 'string') return toolError('uuid is required');
  await query(`DELETE FROM hrt_timeline_periods WHERE uuid = $1`, [uuid]);
  return toolResult({ deleted: uuid });
}

// ── Lab tools ─────────────────────────────────────────────────────────────────

async function listLabDefinitions() {
  // Mirrors the static constant. Returned with the same shape MCP callers
  // would get from a DB read so server-side coaching tools don't need to
  // know the data is compile-time.
  return toolResult(Object.values(LAB_DEFINITIONS_BY_CODE).sort((a, b) => a.sort_order - b.sort_order));
}

interface LabDrawWithResultsRow {
  uuid: string;
  drawn_at: string;
  notes: string | null;
  source: string;
  results: Array<{ lab_code: string; value: number; in_range: boolean | null; status: string }>;
}

async function listLabDraws(args: Record<string, unknown>) {
  const limit = Math.min(Number(args.limit ?? 50), 500);
  const includeResults = args.include_results !== false;     // default true
  const sex: 'female' | 'male' = args.sex === 'male' ? 'male' : 'female';

  const draws = await query<{ uuid: string; drawn_at: string; notes: string | null; source: string }>(
    `SELECT uuid, to_char(drawn_at, 'YYYY-MM-DD') AS drawn_at, notes, source
       FROM lab_draws
       ORDER BY drawn_at DESC
       LIMIT $1`,
    [limit],
  );

  if (!includeResults || draws.length === 0) {
    return toolResult(draws.map(d => ({ ...d, results: [] })));
  }

  const drawUuids = draws.map(d => d.uuid);
  const results = await query<{ draw_uuid: string; lab_code: string; value: number }>(
    `SELECT draw_uuid, lab_code, value
       FROM lab_results
      WHERE draw_uuid = ANY($1::text[])`,
    [drawUuids],
  );

  const byDraw = new Map<string, LabDrawWithResultsRow['results']>();
  for (const r of results) {
    const def = LAB_DEFINITIONS_BY_CODE[r.lab_code];
    const value = Number(r.value);
    const status = def ? evaluateLabRange(def, value, sex) : 'unknown';
    const entry = byDraw.get(r.draw_uuid) ?? [];
    entry.push({
      lab_code: r.lab_code,
      value,
      in_range: status === 'unknown' ? null : status === 'in_range',
      status,
    });
    byDraw.set(r.draw_uuid, entry);
  }

  return toolResult(draws.map(d => ({ ...d, results: byDraw.get(d.uuid) ?? [] })));
}

async function getLabSeries(args: Record<string, unknown>) {
  const { lab_code } = args;
  if (typeof lab_code !== 'string') return toolError('lab_code is required');

  const limit = Math.min(Number(args.limit ?? 50), 500);
  const rows = await query<{ drawn_at: string; value: number }>(
    `SELECT to_char(d.drawn_at, 'YYYY-MM-DD') AS drawn_at, r.value
       FROM lab_results r
       JOIN lab_draws d ON d.uuid = r.draw_uuid
      WHERE r.lab_code = $1
      ORDER BY d.drawn_at ASC
      LIMIT $2`,
    [lab_code, limit],
  );

  const def = LAB_DEFINITIONS_BY_CODE[lab_code];
  if (!def) return toolError(`Unknown lab_code: ${lab_code}`);

  const sex: 'female' | 'male' = args.sex === 'male' ? 'male' : 'female';
  const series = rows.map(r => {
    const value = Number(r.value);
    const status = evaluateLabRange(def, value, sex);
    return { drawn_at: r.drawn_at, value, status };
  });

  return toolResult({ lab_code, label: def.label, unit: def.unit, series });
}

async function createLabDraw(args: Record<string, unknown>) {
  const { drawn_at } = args;
  if (typeof drawn_at !== 'string') return toolError('drawn_at is required (YYYY-MM-DD)');

  const results = Array.isArray(args.results) ? args.results : [];
  // Validate each result's lab_code matches a known definition before any DB write.
  for (const r of results as Array<{ lab_code?: unknown; value?: unknown }>) {
    if (typeof r?.lab_code !== 'string' || !LAB_DEFINITIONS_BY_CODE[r.lab_code]) {
      return toolError(`Unknown lab_code in results: ${String(r?.lab_code)}`);
    }
    if (typeof r?.value !== 'number' || !Number.isFinite(r.value)) {
      return toolError(`Invalid value for ${r.lab_code}`);
    }
  }

  const drawUuid = crypto.randomUUID();
  const statements: Array<{ text: string; params?: unknown[] }> = [
    {
      text: `INSERT INTO lab_draws (uuid, drawn_at, notes, source) VALUES ($1, $2, $3, $4)`,
      params: [
        drawUuid, drawn_at,
        typeof args.notes === 'string' ? args.notes : null,
        typeof args.source === 'string' ? args.source : 'mcp',
      ],
    },
  ];

  for (const r of results as Array<{ lab_code: string; value: number }>) {
    statements.push({
      text: `INSERT INTO lab_results (uuid, draw_uuid, lab_code, value)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (draw_uuid, lab_code) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      params: [crypto.randomUUID(), drawUuid, r.lab_code, r.value],
    });
  }

  await transaction(statements);

  const row = await queryOne(
    `SELECT uuid, to_char(drawn_at, 'YYYY-MM-DD') AS drawn_at, notes, source
       FROM lab_draws WHERE uuid = $1`,
    [drawUuid],
  );
  return toolResult({ ...(row ?? {}), results_imported: results.length });
}

async function deleteLabDraw(args: Record<string, unknown>) {
  const { uuid } = args;
  if (typeof uuid !== 'string') return toolError('uuid is required');
  await query(`DELETE FROM lab_draws WHERE uuid = $1`, [uuid]);
  return toolResult({ deleted: uuid });
}

async function upsertLabResults(args: Record<string, unknown>) {
  const { draw_uuid } = args;
  if (typeof draw_uuid !== 'string') return toolError('draw_uuid is required');

  const results = Array.isArray(args.results) ? args.results : [];
  if (results.length === 0) return toolError('results array is required');

  for (const r of results as Array<{ lab_code?: unknown; value?: unknown }>) {
    if (typeof r?.lab_code !== 'string' || !LAB_DEFINITIONS_BY_CODE[r.lab_code]) {
      return toolError(`Unknown lab_code: ${String(r?.lab_code)}`);
    }
    if (typeof r?.value !== 'number' || !Number.isFinite(r.value)) {
      return toolError(`Invalid value for ${r.lab_code}`);
    }
  }

  const draw = await queryOne(`SELECT uuid FROM lab_draws WHERE uuid = $1`, [draw_uuid]);
  if (!draw) return toolError(`Draw not found: ${draw_uuid}`);

  const statements = (results as Array<{ lab_code: string; value: number }>).map(r => ({
    text: `INSERT INTO lab_results (uuid, draw_uuid, lab_code, value)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (draw_uuid, lab_code) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    params: [crypto.randomUUID(), draw_uuid, r.lab_code, r.value],
  }));

  await transaction(statements);

  return toolResult({ draw_uuid, upserted: results.length });
}

// ── Apple Health medications (read-only) ──────────────────────────────────────

async function getHkMedications(args: Record<string, unknown>) {
  const days = Math.min(Math.max(Number(args.days ?? 30), 1), 365);
  const medication = typeof args.medication === 'string' ? args.medication : null;

  const params: unknown[] = [days];
  let where = `taken_at >= NOW() - ($1 || ' days')::interval`;
  if (medication) {
    params.push(`%${medication}%`);
    where += ` AND medication_name ILIKE $${params.length}`;
  }

  const rows = await query<{
    hk_uuid: string;
    medication_name: string;
    dose_string: string | null;
    taken_at: string;
    scheduled_at: string | null;
    source_name: string | null;
  }>(
    `SELECT hk_uuid, medication_name, dose_string,
            to_char(taken_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS taken_at,
            CASE WHEN scheduled_at IS NULL THEN NULL
                 ELSE to_char(scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS scheduled_at,
            source_name
       FROM healthkit_medications
      WHERE ${where}
      ORDER BY taken_at DESC
      LIMIT 1000`,
    params,
  );
  return toolResult(rows);
}

async function getHkMedicationSummary(args: Record<string, unknown>) {
  const days = Math.min(Math.max(Number(args.days ?? 7), 1), 90);
  const rows = await query<{
    medication_name: string;
    doses_in_window: number;
    last_taken_at: string;
  }>(
    `SELECT medication_name,
            COUNT(*)::int AS doses_in_window,
            to_char(MAX(taken_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_taken_at
       FROM healthkit_medications
      WHERE taken_at >= NOW() - ($1 || ' days')::interval
      GROUP BY medication_name
      ORDER BY doses_in_window DESC`,
    [days],
  );
  return toolResult({ window_days: days, medications: rows });
}

// ── Tool registry ─────────────────────────────────────────────────────────────

import { nutritionTools } from './mcp/nutrition-tools';

export const tools: MCPTool[] = [
  ...nutritionTools,
  {
    name: 'ping',
    description: 'Health check — confirms the MCP server is reachable.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => toolResult({ status: 'ok', service: 'rebirth-mcp' }),
  },
  // ── Read tools ──────────────────────────────────────────────────────────────
  {
    name: 'get_recent_workouts',
    description: 'Returns the last N completed workout sessions with exercises, sets, and total volume.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of workouts to return (default 10, max 50)' },
        days_back: { type: 'number', description: 'Only return workouts within this many days (default 30)' },
      },
    },
    execute: getRecentWorkouts,
  },
  {
    name: 'get_exercise_history',
    description: 'Returns historical performance data for a specific exercise, grouped by session with estimated 1RM.',
    inputSchema: {
      type: 'object',
      properties: {
        exercise_name: { type: 'string', description: 'Name fragment to fuzzy-match against exercise library (use instead of exercise_id)' },
        exercise_id: { type: 'string', description: 'UUID of the exercise (use instead of exercise_name)' },
        limit: { type: 'number', description: 'Number of sessions to return (default 20)' },
      },
    },
    execute: getExerciseHistory,
  },
  {
    name: 'get_active_routine',
    description: 'Returns the currently active workout plan with all routines, exercises, and set targets.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => getActiveRoutine(),
  },
  // Nutrition tools live in src/lib/mcp/nutrition-tools.ts and are spread
  // into this array at the top.
  {
    name: 'get_body_comp',
    description: 'Returns a structured body composition snapshot: current stats, 7d/30d trends, latest measurements per site, and historical weight/body-fat timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        days_back: { type: 'number', description: 'History window in days (default 90)' },
      },
    },
    execute: getBodyComp,
  },
  {
    name: 'update_body_comp',
    description: 'Logs body composition data. Writes to bodyweight_logs (weight), body_spec_logs (body_fat_pct/lean_mass), and/or measurement_logs (circumference sites) based on which fields are provided. At least one field required.',
    inputSchema: {
      type: 'object',
      properties: {
        weight: { type: 'number', description: 'Body weight in kg' },
        body_fat_pct: { type: 'number', description: 'Body fat percentage (InBody scan)' },
        lean_mass: { type: 'number', description: 'Lean mass in kg (InBody scan)' },
        height_cm: { type: 'number' },
        measurements: {
          type: 'object',
          description: 'Body measurements in cm — circumferences plus shoulder_width (tape over widest deltoid point). Any subset.',
          properties: {
            chest: { type: 'number' },
            waist: { type: 'number' },
            hips: { type: 'number' },
            neck: { type: 'number' },
            shoulder_width: { type: 'number' },
            abdomen: { type: 'number' },
            left_arm: { type: 'number' },
            right_arm: { type: 'number' },
            left_forearm: { type: 'number' },
            right_forearm: { type: 'number' },
            left_thigh: { type: 'number' },
            right_thigh: { type: 'number' },
            left_calf: { type: 'number' },
            right_calf: { type: 'number' },
          },
        },
        notes: { type: 'string' },
        date: { type: 'string', description: 'ISO date string (default: today)' },
      },
    },
    execute: updateBodyComp,
  },
  {
    name: 'get_body_comp_trend',
    description: 'Returns body composition trend data: weight, body spec, and measurements.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Look-back window in days (default 90)' },
      },
    },
    execute: getBodyCompTrend,
  },
  {
    name: 'get_weekly_summary',
    description: 'Returns a weekly training summary: workout count, total volume, volume by muscle group, and compliance vs active plan.',
    inputSchema: {
      type: 'object',
      properties: {
        week_offset: { type: 'number', description: '0 = current week, -1 = last week, etc. (default 0)' },
      },
    },
    execute: getWeeklySummary,
  },
  // ── Write tools ─────────────────────────────────────────────────────────────
  {
    name: 'find_exercises',
    description: 'Fuzzy-search the exercise library by name or muscle group.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name fragment to search for' },
        muscle_group: { type: 'string', description: 'Optional muscle group filter (e.g. "chest", "quads")' },
      },
      required: ['query'],
    },
    execute: findExercises,
  },
  {
    name: 'create_exercise',
    description: 'Creates a new custom exercise in the library. Use this to add exercises that do not already exist before adding them to a routine.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Display name for the exercise (e.g. "Romanian Deadlift: Dumbbell")' },
        primary_muscles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Primary muscle groups targeted (e.g. ["hamstrings", "glutes"])',
        },
        secondary_muscles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Secondary muscles worked (optional)',
        },
        equipment: {
          type: 'array',
          items: { type: 'string' },
          description: 'Equipment required (e.g. ["dumbbell"])',
        },
        description: { type: 'string', description: 'Optional description of the exercise' },
        alias: {
          type: 'array',
          items: { type: 'string' },
          description: 'Alternative names for fuzzy search matching',
        },
        steps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Numbered steps describing how to perform the exercise',
        },
        tips: {
          type: 'array',
          items: { type: 'string' },
          description: 'Coaching tips and things to watch out for',
        },
        movement_pattern: { type: 'string', description: 'Movement pattern (push, pull, hinge, squat, etc.)' },
        tracking_mode: {
          type: 'string',
          enum: ['reps', 'time'],
          description: 'How sets are tracked. "reps" = weight × repetitions (default). "time" = duration_seconds.',
        },
        youtube_url: {
          type: 'string',
          description: 'Optional YouTube reference URL with start time embedded (e.g. ?t=42). Validated server-side.',
        },
      },
      required: ['title', 'primary_muscles'],
    },
    execute: createExercise,
  },
  {
    name: 'update_exercise',
    description: 'Updates an existing exercise (catalog or custom). Pass uuid + only the fields you want to change. Server validates youtube_url format and rejects garbage.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'UUID of the exercise to update' },
        title: { type: 'string' },
        description: { type: 'string', description: 'About text. Pass null to clear.' },
        steps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replace the full steps list',
        },
        tips: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replace the full tips list',
        },
        equipment: { type: 'array', items: { type: 'string' } },
        primary_muscles: { type: 'array', items: { type: 'string' } },
        secondary_muscles: { type: 'array', items: { type: 'string' } },
        movement_pattern: { type: 'string' },
        tracking_mode: { type: 'string', enum: ['reps', 'time'] },
        youtube_url: {
          type: 'string',
          description: 'YouTube URL with optional ?t=N start. Pass null or empty string to clear.',
        },
      },
      required: ['uuid'],
    },
    execute: updateExercise,
  },
  {
    name: 'create_routine',
    description: 'Creates a new workout plan with days, exercises, and set targets. Accepts the full nested week structure in one call. Exercises can be specified by name (fuzzy-matched) or UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the workout plan (also accepted as "title")' },
        description: { type: 'string', description: 'Optional description of the plan' },
        routines: {
          type: 'array',
          description: 'Array of training days',
          items: {
            type: 'object',
            properties: {
              day_label: { type: 'string', description: 'Day label, e.g. "Monday — Push" (also accepted as "title")' },
              order: { type: 'number', description: 'Sort order (also accepted as "order_index")' },
              exercises: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    exercise_id: { type: 'string', description: 'UUID of the exercise (use instead of exercise_name)' },
                    exercise_name: { type: 'string', description: 'Name fragment to fuzzy-match (use instead of exercise_id)' },
                    order: { type: 'number', description: 'Sort order within the day (also accepted as "order_index")' },
                    sets: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          target_reps: { type: 'number', description: 'Target reps (stored as max_repetitions)' },
                          min_repetitions: { type: 'number' },
                          max_repetitions: { type: 'number' },
                          target_weight: { type: 'number', description: 'Target load in kg' },
                          rpe_target: { type: 'number', description: 'RPE target (5.0–10.0)' },
                        },
                      },
                    },
                  },
                },
              },
            },
            required: ['day_label'],
          },
        },
      },
      required: ['name', 'routines'],
    },
    execute: createRoutine,
  },
  {
    name: 'update_routine',
    description: 'Updates a workout plan\'s name, description, or active status.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'UUID of the workout plan' },
        name: { type: 'string', description: 'New name for the plan' },
        description: { type: 'string', description: 'New description' },
        is_active: { type: 'boolean', description: 'If true, activates this plan and deactivates any previous active plan' },
      },
      required: ['plan_id'],
    },
    execute: updateRoutine,
  },
  {
    name: 'delete_routine',
    description: 'Hard-deletes a workout plan and all its routines, exercises, and sets (CASCADE).',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'UUID of the workout plan to delete' },
      },
      required: ['plan_id'],
    },
    execute: deleteRoutine,
  },
  {
    name: 'activate_routine',
    description: 'Atomically sets the given workout plan as active, deactivating any previous active plan.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_uuid: { type: 'string', description: 'UUID of the workout plan to activate' },
      },
      required: ['plan_uuid'],
    },
    execute: activateRoutine,
  },
  {
    name: 'update_set_targets',
    description: 'Updates rep/RPE/duration targets for sets on a specific exercise in a routine. For time-mode exercises (e.g. plank), pass target_duration_seconds instead of min/max_repetitions.',
    inputSchema: {
      type: 'object',
      properties: {
        routine_uuid: { type: 'string' },
        exercise_uuid: { type: 'string' },
        sets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              order_index: { type: 'number' },
              min_repetitions: { type: 'number' },
              max_repetitions: { type: 'number' },
              target_duration_seconds: { type: 'number', description: 'Target hold in seconds (time-mode only)' },
            },
            required: ['order_index'],
          },
        },
      },
      required: ['routine_uuid', 'exercise_uuid', 'sets'],
    },
    execute: updateSetTargets,
  },
  {
    name: 'add_exercise',
    description: 'Adds an exercise (with optional sets) to a specific routine day. Exercise can be specified by name or UUID. For time-mode exercises (e.g. plank), pass target_duration_seconds per set instead of rep targets.',
    inputSchema: {
      type: 'object',
      properties: {
        routine_id: { type: 'string', description: 'UUID of the workout_routine (day)' },
        exercise_id: { type: 'string', description: 'UUID of the exercise (use instead of exercise_name)' },
        exercise_name: { type: 'string', description: 'Name fragment to fuzzy-match (use instead of exercise_id)' },
        order: { type: 'number', description: 'Position within the day (defaults to end)' },
        sets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              target_reps: { type: 'number' },
              min_repetitions: { type: 'number' },
              max_repetitions: { type: 'number' },
              target_weight: { type: 'number', description: 'Target load in kg' },
              rpe_target: { type: 'number', description: 'RPE target (5.0–10.0)' },
              target_duration_seconds: { type: 'number', description: 'Target hold in seconds (time-mode only)' },
            },
          },
        },
      },
      required: ['routine_id'],
    },
    execute: addExercise,
  },
  {
    name: 'swap_exercise',
    description: 'Replaces one exercise with another within a specific routine day. Sets are preserved. Exercises can be specified by name or UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        routine_id: { type: 'string', description: 'UUID of the workout_routine (day)' },
        old_exercise_id: { type: 'string', description: 'UUID of the exercise to replace (use instead of old_exercise_name)' },
        old_exercise_name: { type: 'string', description: 'Name fragment of the exercise to replace (use instead of old_exercise_id)' },
        new_exercise_id: { type: 'string', description: 'UUID of the replacement exercise (use instead of new_exercise_name)' },
        new_exercise_name: { type: 'string', description: 'Name fragment of the replacement exercise (use instead of new_exercise_id)' },
      },
      required: ['routine_id'],
    },
    execute: swapExercise,
  },
  {
    name: 'remove_exercise',
    description: 'Removes an exercise (and all its sets) from a specific routine day.',
    inputSchema: {
      type: 'object',
      properties: {
        routine_id: { type: 'string', description: 'UUID of the workout_routine (day)' },
        exercise_id: { type: 'string', description: 'UUID of the exercise to remove (use instead of exercise_name)' },
        exercise_name: { type: 'string', description: 'Name fragment to fuzzy-match (use instead of exercise_id)' },
      },
      required: ['routine_id'],
    },
    execute: removeExercise,
  },
  {
    name: 'update_sets',
    description: 'Fully replaces all sets for a routine exercise (delete + re-insert). Use routine_exercise_id from get_active_routine or add_exercise. For time-mode exercises (e.g. plank), pass target_duration_seconds per set instead of rep targets.',
    inputSchema: {
      type: 'object',
      properties: {
        routine_exercise_id: { type: 'string', description: 'UUID of the workout_routine_exercises row' },
        sets: {
          type: 'array',
          description: 'New set list — completely replaces existing sets',
          items: {
            type: 'object',
            properties: {
              target_reps: { type: 'number', description: 'Target reps (stored as max_repetitions)' },
              min_repetitions: { type: 'number' },
              max_repetitions: { type: 'number' },
              target_weight: { type: 'number', description: 'Target load in kg' },
              rpe_target: { type: 'number', description: 'RPE target (5.0–10.0)' },
              target_duration_seconds: { type: 'number', description: 'Target hold in seconds (time-mode only)' },
            },
          },
        },
      },
      required: ['routine_exercise_id', 'sets'],
    },
    execute: updateSets,
  },
  {
    name: 'log_body_comp',
    description: 'Logs a body composition snapshot (weight, body fat %, measurements).',
    inputSchema: {
      type: 'object',
      properties: {
        weight_kg: { type: 'number' },
        body_fat_pct: { type: 'number' },
        lean_mass_kg: { type: 'number' },
        height_cm: { type: 'number' },
        measurements: {
          type: 'array',
          description: 'Tape measurements by site',
          items: {
            type: 'object',
            properties: {
              site: { type: 'string', description: 'e.g. "waist", "hips", "chest", "thigh"' },
              value_cm: { type: 'number' },
            },
            required: ['site', 'value_cm'],
          },
        },
        notes: { type: 'string' },
      },
    },
    execute: logBodyComp,
  },
  // ── Coaching notes ───────────────────────────────────────────────────────────
  {
    name: 'list_coaching_notes',
    description: 'Returns Claude-authored coaching notes, optionally filtered to pinned or a specific context.',
    inputSchema: {
      type: 'object',
      properties: {
        pinned_only: { type: 'boolean', description: 'If true, return only pinned notes' },
        context: { type: 'string', description: 'Filter by context: workout | nutrition | body_comp | general' },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
    },
    execute: listCoachingNotes,
  },
  {
    name: 'create_coaching_note',
    description: 'Creates a coaching note that Claude can pin for persistent context.',
    inputSchema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Note content' },
        context: { type: 'string', description: 'workout | nutrition | body_comp | general' },
        pinned: { type: 'boolean', description: 'Pin this note for easy recall' },
      },
      required: ['note'],
    },
    execute: createCoachingNote,
  },
  {
    name: 'update_coaching_note',
    description: 'Updates an existing coaching note (content, context, or pinned state).',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        note: { type: 'string' },
        context: { type: 'string' },
        pinned: { type: 'boolean' },
      },
      required: ['uuid'],
    },
    execute: updateCoachingNote,
  },
  {
    name: 'delete_coaching_note',
    description: 'Deletes a coaching note.',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' } },
      required: ['uuid'],
    },
    execute: deleteCoachingNote,
  },
  // ── Training blocks ──────────────────────────────────────────────────────────
  {
    name: 'list_training_blocks',
    description: 'Returns all training blocks (periodisation periods) ordered by start date.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => listTrainingBlocks(),
  },
  {
    name: 'create_training_block',
    description: 'Creates a training block defining a periodisation period with a goal and linked plan.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Block name, e.g. "Hypertrophy Phase 1"' },
        goal: { type: 'string', description: 'strength | hypertrophy | endurance | cut | recomp | maintenance' },
        started_at: { type: 'string', description: 'ISO date, e.g. "2026-04-07"' },
        ended_at: { type: 'string', description: 'ISO date (optional)' },
        workout_plan_uuid: { type: 'string', description: 'UUID of the linked workout plan (optional)' },
        notes: { type: 'string' },
      },
      required: ['name', 'goal', 'started_at'],
    },
    execute: createTrainingBlock,
  },
  {
    name: 'update_training_block',
    description: 'Updates a training block.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        name: { type: 'string' },
        goal: { type: 'string' },
        started_at: { type: 'string' },
        ended_at: { type: 'string' },
        notes: { type: 'string' },
        workout_plan_uuid: { type: 'string' },
      },
      required: ['uuid'],
    },
    execute: updateTrainingBlock,
  },
  {
    name: 'delete_training_block',
    description: 'Deletes a training block.',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' } },
      required: ['uuid'],
    },
    execute: deleteTrainingBlock,
  },
  // ── InBody scan catalog ───────────────────────────────────────────────────────
  {
    name: 'log_inbody_scan',
    description: 'Logs a new InBody scan with every printed metric. Required: scanned_at (ISO string). Any subset of ~60 body-composition metrics may be provided.',
    inputSchema: {
      type: 'object',
      properties: {
        scanned_at: { type: 'string', description: 'ISO timestamp of the scan' },
        device: { type: 'string' },
        venue: { type: 'string' },
        age_at_scan: { type: 'number' },
        height_cm: { type: 'number' },
        weight_kg: { type: 'number' },
        total_body_water_l: { type: 'number' },
        intracellular_water_l: { type: 'number' },
        extracellular_water_l: { type: 'number' },
        protein_kg: { type: 'number' },
        minerals_kg: { type: 'number' },
        bone_mineral_kg: { type: 'number' },
        body_fat_mass_kg: { type: 'number' },
        smm_kg: { type: 'number', description: 'Skeletal muscle mass (kg)' },
        soft_lean_mass_kg: { type: 'number', description: 'Soft lean mass (kg) — body mass minus fat minus bone minerals' },
        fat_free_mass_kg: { type: 'number', description: 'Fat free mass (kg) — total body mass minus fat' },
        bmi: { type: 'number' },
        pbf_pct: { type: 'number', description: 'Percent body fat' },
        whr: { type: 'number', description: 'Waist-hip ratio' },
        inbody_score: { type: 'number' },
        visceral_fat_level: { type: 'number' },
        bmr_kcal: { type: 'number' },
        body_cell_mass_kg: { type: 'number' },
        ecw_ratio: { type: 'number' },
        seg_lean_right_arm_kg: { type: 'number' },
        seg_lean_right_arm_pct: { type: 'number' },
        seg_lean_left_arm_kg: { type: 'number' },
        seg_lean_left_arm_pct: { type: 'number' },
        seg_lean_trunk_kg: { type: 'number' },
        seg_lean_trunk_pct: { type: 'number' },
        seg_lean_right_leg_kg: { type: 'number' },
        seg_lean_right_leg_pct: { type: 'number' },
        seg_lean_left_leg_kg: { type: 'number' },
        seg_lean_left_leg_pct: { type: 'number' },
        seg_fat_right_arm_kg: { type: 'number' },
        seg_fat_right_arm_pct: { type: 'number', description: 'Segmental fat percentage (right arm)' },
        seg_fat_left_arm_kg: { type: 'number' },
        seg_fat_left_arm_pct: { type: 'number', description: 'Segmental fat percentage (left arm)' },
        seg_fat_trunk_kg: { type: 'number' },
        seg_fat_trunk_pct: { type: 'number', description: 'Segmental fat percentage (trunk)' },
        seg_fat_right_leg_kg: { type: 'number' },
        seg_fat_right_leg_pct: { type: 'number', description: 'Segmental fat percentage (right leg)' },
        seg_fat_left_leg_kg: { type: 'number' },
        seg_fat_left_leg_pct: { type: 'number', description: 'Segmental fat percentage (left leg)' },
        circ_neck_cm: { type: 'number' },
        circ_chest_cm: { type: 'number' },
        circ_abdomen_cm: { type: 'number' },
        circ_hip_cm: { type: 'number' },
        circ_right_arm_cm: { type: 'number' },
        circ_left_arm_cm: { type: 'number' },
        circ_right_thigh_cm: { type: 'number' },
        circ_left_thigh_cm: { type: 'number' },
        arm_muscle_circumference_cm: { type: 'number', description: 'Arm muscle circumference (cm) — research parameter distinct from the raw arm circumference' },
        target_weight_kg: { type: 'number' },
        weight_control_kg: { type: 'number' },
        fat_control_kg: { type: 'number' },
        muscle_control_kg: { type: 'number' },
        balance_upper: { type: 'string', enum: ['balanced', 'under', 'over', 'slightly_under', 'slightly_over'] },
        balance_lower: { type: 'string', enum: ['balanced', 'under', 'over', 'slightly_under', 'slightly_over'] },
        balance_upper_lower: { type: 'string', enum: ['balanced', 'under', 'over', 'slightly_under', 'slightly_over'] },
        impedance: { type: 'object', description: 'Raw impedance keyed by frequency → { ra, la, trunk, rl, ll }' },
        notes: { type: 'string' },
        raw_json: { type: 'object' },
      },
      required: ['scanned_at'],
    },
    execute: logInbodyScan,
  },
  {
    name: 'update_inbody_scan',
    description: 'PATCH an existing InBody scan. Accepts any subset of the log_inbody_scan fields.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
      },
      required: ['uuid'],
    },
    execute: updateInbodyScanTool,
  },
  {
    name: 'get_inbody_scan',
    description: 'Fetch a single InBody scan by uuid, or the most recent scan via { latest: true }.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        latest: { type: 'boolean' },
      },
    },
    execute: getInbodyScanTool,
  },
  {
    name: 'list_inbody_scans',
    description: 'Lists InBody scans, newest first. Supports limit, from, to (ISO).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        from: { type: 'string' },
        to: { type: 'string' },
      },
    },
    execute: listInbodyScansTool,
  },
  {
    name: 'delete_inbody_scan',
    description: 'Delete an InBody scan by uuid. Also cleans up any auto-inserted circumference rows in measurement_logs.',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' } },
      required: ['uuid'],
    },
    execute: deleteInbodyScanTool,
  },
  {
    name: 'compare_inbody_scans',
    description: 'Returns delta and percentage change between two scans across every numeric metric.',
    inputSchema: {
      type: 'object',
      properties: {
        a_uuid: { type: 'string' },
        b_uuid: { type: 'string' },
      },
      required: ['a_uuid', 'b_uuid'],
    },
    execute: compareInbodyScans,
  },
  {
    name: 'get_body_goals',
    description: 'Returns user-defined body goals (the "Me" reference), keyed by metric_key.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => getBodyGoalsTool(),
  },
  {
    name: 'set_body_goal',
    description: 'Upserts a body goal for a given metric_key. direction must be higher|lower|match.',
    inputSchema: {
      type: 'object',
      properties: {
        metric_key: { type: 'string' },
        target_value: { type: 'number' },
        unit: { type: 'string' },
        direction: { type: 'string', enum: ['higher', 'lower', 'match'] },
        notes: { type: 'string' },
      },
      required: ['metric_key', 'target_value', 'unit', 'direction'],
    },
    execute: setBodyGoal,
  },
  {
    name: 'delete_body_goal',
    description: 'Removes a body goal.',
    inputSchema: {
      type: 'object',
      properties: { metric_key: { type: 'string' } },
      required: ['metric_key'],
    },
    execute: deleteBodyGoalTool,
  },
  {
    name: 'get_body_norm_ranges',
    description: 'Returns seeded healthy norm ranges for the given sex, keyed by metric_key.',
    inputSchema: {
      type: 'object',
      properties: { sex: { type: 'string', enum: ['M', 'F'] } },
      required: ['sex'],
    },
    execute: getBodyNormRangesTool,
  },

  // ── Photo tracking ──────────────────────────────────────────────────────────
  {
    name: 'upload_progress_photo',
    description:
      'Upload a body progress photo (front/side/back pose) to Vercel Blob and record it in progress_photos. Provide image bytes via image_base64 (raw base64 or data URL) OR image_url (the server fetches and re-hosts). Pose is required. Optional notes and taken_at (ISO).',
    inputSchema: {
      type: 'object',
      properties: {
        pose: { type: 'string', enum: ['front', 'side', 'back'], description: 'Required pose tag' },
        image_base64: {
          type: 'string',
          description: 'Base64-encoded image bytes. Accepts raw base64 or "data:image/...;base64,..." form.',
        },
        image_url: {
          type: 'string',
          description: 'Public URL of an image to fetch and re-host on Vercel Blob. Use instead of image_base64.',
        },
        mime_type: {
          type: 'string',
          description: 'Override detected MIME type (e.g. image/jpeg, image/png, image/heic).',
        },
        notes: { type: 'string' },
        taken_at: { type: 'string', description: 'ISO timestamp; defaults to now.' },
      },
      required: ['pose'],
    },
    execute: uploadProgressPhotoTool,
  },
  {
    name: 'upload_inspo_photo',
    description:
      'Upload a physique inspiration photo to Vercel Blob and record it in inspo_photos. Provide image bytes via image_base64 OR image_url. Pass burst_group_id to attach this frame to an existing burst.',
    inputSchema: {
      type: 'object',
      properties: {
        image_base64: {
          type: 'string',
          description: 'Base64-encoded image bytes. Accepts raw base64 or "data:image/...;base64,..." form.',
        },
        image_url: {
          type: 'string',
          description: 'Public URL of an image to fetch and re-host on Vercel Blob.',
        },
        mime_type: { type: 'string' },
        notes: { type: 'string' },
        taken_at: { type: 'string', description: 'ISO timestamp; defaults to now.' },
        burst_group_id: {
          type: 'string',
          description: 'Optional UUID grouping multiple frames from a single burst capture.',
        },
      },
    },
    execute: uploadInspoPhotoTool,
  },
  {
    name: 'list_progress_photos',
    description: 'List progress photos newest first. Returns blob_url, pose, notes, taken_at.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Default 50.' } },
    },
    execute: listProgressPhotosTool,
  },
  {
    name: 'list_inspo_photos',
    description: 'List inspo photos newest first. Returns blob_url, notes, taken_at, burst_group_id.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Default 50.' } },
    },
    execute: listInspoPhotosTool,
  },

  // ── HealthKit tools ─────────────────────────────────────────────────────────
  {
    name: 'get_health_snapshot',
    description:
      'Returns a composite "how are they right now" snapshot from Apple HealthKit: last night sleep (total, REM, deep), HRV (latest + window + 30d baseline + delta %), resting HR (same), VO2 max, today\'s activity rings (steps, active/basal kcal, exercise min), any workouts HK recorded in the last 24h that aren\'t logged in Rebirth (source="hk_only" — this is the adherence/missed-workout signal), and data_quality info. Pass fields=["sleep_last_night","hrv"] to project only specific branches (~120 tokens vs ~500 full). Call once per session or when the user asks about health, training, or recovery. If HealthKit isn\'t connected, returns {status:"not_connected", reason, message}.',
    inputSchema: {
      type: 'object',
      properties: {
        as_of: { type: 'string', description: 'YYYY-MM-DD; defaults to today (UTC).' },
        window_days: { type: 'number', description: 'Window for window_avg and activity baselines. Default 7, max 90.' },
        fields: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['sleep_last_night', 'hrv', 'resting_hr', 'vo2_max', 'activity_today', 'unlogged_workouts_24h', 'data_quality'],
          },
          description: 'Optional subset of top-level keys to return. Omit for the full snapshot.',
        },
      },
    },
    execute: getHealthSnapshot,
  },
  {
    name: 'get_health_series',
    description:
      'Returns daily (or weekly) aggregate time-series for a single HealthKit metric. Use this for trend questions ("how has my HRV been over 2 weeks?"). Pairs with get_health_snapshot for point-in-time reads.',
    inputSchema: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: [...VALID_SERIES_METRICS],
          description: 'Which aggregate to fetch. Sleep metrics report minutes per stage.',
        },
        from: { type: 'string', description: 'YYYY-MM-DD inclusive start.' },
        to: { type: 'string', description: 'YYYY-MM-DD inclusive end (default today).' },
        bucket: { type: 'string', enum: ['day', 'week'], description: 'Default day.' },
      },
      required: ['metric', 'from'],
    },
    execute: getHealthSeries,
  },
  {
    name: 'get_health_workouts',
    description:
      'Returns HealthKit workout records in a date window. source="hk_only" finds workouts the user did (recorded by Apple Watch / similar) but didn\'t log in Rebirth — this is the reconciliation / missed-workout path for coaching. source="user_logged" = came from Rebirth. source="matched" = Apple Watch workout fuzzy-matched to a Rebirth session. source="all" (default) returns everything.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'ISO-8601 start (e.g. 2026-04-01T00:00:00Z).' },
        to: { type: 'string', description: 'ISO-8601 end; defaults to now.' },
        source: {
          type: 'string',
          enum: [...VALID_WORKOUT_SOURCES],
          description: 'Filter by source tag. Default "all".',
        },
      },
      required: ['from'],
    },
    execute: getHealthWorkoutsTool,
  },

  // ── HRT Timeline tools ──────────────────────────────────────────────────────
  {
    name: 'list_hrt_timeline',
    description:
      'List HRT protocol periods newest first. Each row has name, started_at, ended_at (null = current), doses_e (estrogen), doses_t_blocker, doses_other (array). Use to answer "what protocol was Lewis on during X period" or "show the timeline of all HRT changes."',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Default 100, max 500.' },
      },
    },
    execute: listHrtTimeline,
  },
  {
    name: 'create_hrt_timeline_period',
    description:
      'Create a new HRT timeline period. name + started_at (YYYY-MM-DD) required; ended_at optional (omit/null = "current"). doses_e + doses_t_blocker are display strings (e.g. "Sandrena Gel 2mg/day", "Cyproterone 12.5mg/day"); doses_other is an array of multi-select tags.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name (e.g. "Estrogel + Cypro Q2 2026").' },
        started_at: { type: 'string', description: 'YYYY-MM-DD.' },
        ended_at: { type: 'string', description: 'YYYY-MM-DD; omit for current.' },
        doses_e: { type: 'string', description: 'Estrogen dose, e.g. "Estrogel 1.5mg estradiol".' },
        doses_t_blocker: { type: 'string', description: 'T-blocker, e.g. "Cyproterone 12.5mg/day" or "None".' },
        doses_other: {
          type: 'array',
          items: { type: 'string' },
          description: 'Other concurrent meds, e.g. ["1 Tablet Ralovista/day"].',
        },
        notes: { type: 'string' },
      },
      required: ['name', 'started_at'],
    },
    execute: createHrtTimelinePeriod,
  },
  {
    name: 'update_hrt_timeline_period',
    description: 'Update fields on an existing HRT timeline period by uuid. Pass only fields to change.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        name: { type: 'string' },
        started_at: { type: 'string' },
        ended_at: { type: 'string' },
        doses_e: { type: 'string' },
        doses_t_blocker: { type: 'string' },
        doses_other: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['uuid'],
    },
    execute: updateHrtTimelinePeriod,
  },
  {
    name: 'delete_hrt_timeline_period',
    description: 'Delete an HRT timeline period by uuid.',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' } },
      required: ['uuid'],
    },
    execute: deleteHrtTimelinePeriod,
  },

  // ── Lab tools ───────────────────────────────────────────────────────────────
  {
    name: 'list_lab_definitions',
    description:
      'List the canonical lab catalog: lab_code, label, unit, reference ranges, category. Use this before calling create_lab_draw to confirm which lab_codes are valid (e.g. "e2", "testosterone", "hb").',
    inputSchema: { type: 'object', properties: {} },
    execute: listLabDefinitions,
  },
  {
    name: 'list_lab_draws',
    description:
      'List blood draws newest first, optionally with their results inlined. Each result includes the in/out-of-range status (uses female reference ranges by default — pass sex="male" to flip).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Default 50, max 500.' },
        include_results: { type: 'boolean', description: 'Default true.' },
        sex: { type: 'string', enum: ['female', 'male'], description: 'Reference range to evaluate against. Default female.' },
      },
    },
    execute: listLabDraws,
  },
  {
    name: 'get_lab_series',
    description:
      'Time-series for one lab: every recorded value across draws, oldest → newest. Pairs with list_hrt_timeline so coaching can correlate lab trends with protocol changes.',
    inputSchema: {
      type: 'object',
      properties: {
        lab_code: { type: 'string', description: 'e.g. "e2", "testosterone", "hb". Use list_lab_definitions for the catalog.' },
        limit: { type: 'number', description: 'Default 50.' },
        sex: { type: 'string', enum: ['female', 'male'] },
      },
      required: ['lab_code'],
    },
    execute: getLabSeries,
  },
  {
    name: 'create_lab_draw',
    description:
      'Create a new blood draw with one transaction-of inserts: a draw row plus each lab result. drawn_at is YYYY-MM-DD; results is an array of {lab_code, value}. Use this for bulk-importing a Notion blood-test row.',
    inputSchema: {
      type: 'object',
      properties: {
        drawn_at: { type: 'string', description: 'YYYY-MM-DD.' },
        notes: { type: 'string' },
        source: { type: 'string', description: 'Where this came from. Default "mcp".' },
        results: {
          type: 'array',
          description: 'Array of measurements at this draw.',
          items: {
            type: 'object',
            properties: {
              lab_code: { type: 'string' },
              value: { type: 'number' },
            },
            required: ['lab_code', 'value'],
          },
        },
      },
      required: ['drawn_at'],
    },
    execute: createLabDraw,
  },
  {
    name: 'upsert_lab_results',
    description: 'Add or update lab values on an existing draw. Same shape as create_lab_draw.results; uses (draw_uuid, lab_code) for idempotency.',
    inputSchema: {
      type: 'object',
      properties: {
        draw_uuid: { type: 'string' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: { lab_code: { type: 'string' }, value: { type: 'number' } },
            required: ['lab_code', 'value'],
          },
        },
      },
      required: ['draw_uuid', 'results'],
    },
    execute: upsertLabResults,
  },
  {
    name: 'delete_lab_draw',
    description: 'Delete a lab draw and (via FK CASCADE) all of its results.',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' } },
      required: ['uuid'],
    },
    execute: deleteLabDraw,
  },

  // ── Apple Health Medications (read-only) ────────────────────────────────────
  {
    name: 'get_hk_medications',
    description:
      'List medication records logged in the iOS Health app, newest first. These are NOT user-entered in Rebirth — they come from Apple Health "Medications" (HKCategoryTypeIdentifierMedicationRecord). Use to verify what Lewis actually took vs his prescribed protocol from list_hrt_timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Look-back window. Default 30, max 365.' },
        medication: { type: 'string', description: 'Optional ILIKE filter on medication_name.' },
      },
    },
    execute: getHkMedications,
  },
  {
    name: 'get_hk_medication_summary',
    description:
      'Aggregate counts per medication over a window — "doses_in_window" + last_taken_at per medication_name. Use this for trend questions like "how often has Lewis taken X this week?"',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Window in days. Default 7, max 90.' },
      },
    },
    execute: getHkMedicationSummary,
  },
];

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function executeTool(name: string, args: Record<string, unknown>) {
  const tool = tools.find(t => t.name === name);
  if (!tool) return toolError(`Unknown tool: ${name}`);
  try {
    return await tool.execute(args);
  } catch (e) {
    return toolError(e instanceof Error ? e.message : String(e));
  }
}
