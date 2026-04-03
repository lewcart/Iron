/**
 * Rebirth MCP Server — stateless JSON-RPC 2.0 over HTTP
 *
 * Implements the Model Context Protocol so Claude can manage training,
 * nutrition, and body composition data directly in Neon.
 *
 * Auth: REBIRTH_API_KEY bearer token (same as the rest of the API).
 * If the env var is unset all requests are allowed (local dev mode).
 *
 * Transport: plain POST — no SSE streaming needed for tool calls.
 * Each Vercel invocation is stateless; initialize/tools-list/tools-call
 * all handled in the same function with no session state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { query, queryOne } from '@/db/db';

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function ok(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}

function err(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } });
}

function toolResult(content: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(content, null, 2) }] };
}

function toolError(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ── Tool schemas ──────────────────────────────────────────────────────────────

const TOOLS = [
  // ── Read tools ──────────────────────────────────────────────────────────────
  {
    name: 'get_recent_workouts',
    description: 'Returns the last N completed workout sessions with exercises and sets.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of workouts to return (default 10, max 50)' },
      },
    },
  },
  {
    name: 'get_exercise_history',
    description: 'Returns historical performance data for a specific exercise.',
    inputSchema: {
      type: 'object',
      properties: {
        exercise_uuid: { type: 'string', description: 'UUID of the exercise' },
        limit: { type: 'number', description: 'Number of sessions to return (default 20)' },
      },
      required: ['exercise_uuid'],
    },
  },
  {
    name: 'get_active_routine',
    description: 'Returns the currently active workout plan with all routines, exercises, and set targets.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_active_nutrition_plan',
    description: 'Returns the current standard-week meal plan template.',
    inputSchema: { type: 'object', properties: {} },
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
  },
  {
    name: 'get_weekly_summary',
    description: 'Returns a summary of the current week: workouts logged, nutrition totals, bodyweight.',
    inputSchema: { type: 'object', properties: {} },
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
  },
  {
    name: 'create_routine',
    description: 'Creates a new workout plan with days, exercises, and set targets.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Name of the workout plan' },
        routines: {
          type: 'array',
          description: 'Array of training days',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              order_index: { type: 'number' },
              exercises: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    exercise_uuid: { type: 'string' },
                    order_index: { type: 'number' },
                    sets: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          min_repetitions: { type: 'number' },
                          max_repetitions: { type: 'number' },
                          order_index: { type: 'number' },
                        },
                      },
                    },
                  },
                  required: ['exercise_uuid', 'order_index'],
                },
              },
            },
            required: ['title', 'order_index'],
          },
        },
      },
      required: ['title', 'routines'],
    },
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
  },
  {
    name: 'update_set_targets',
    description: 'Updates rep/RPE targets for sets on a specific exercise in a routine.',
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
            },
            required: ['order_index'],
          },
        },
      },
      required: ['routine_uuid', 'exercise_uuid', 'sets'],
    },
  },
  {
    name: 'swap_exercise',
    description: 'Replaces all occurrences of an exercise in a plan with a different exercise.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_uuid: { type: 'string', description: 'UUID of the workout plan' },
        old_exercise_uuid: { type: 'string' },
        new_exercise_uuid: { type: 'string' },
      },
      required: ['plan_uuid', 'old_exercise_uuid', 'new_exercise_uuid'],
    },
  },
  {
    name: 'load_nutrition_plan',
    description: 'Replaces the entire standard-week meal template with a new plan.',
    inputSchema: {
      type: 'object',
      properties: {
        meals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day_of_week: { type: 'number', description: '0=Mon … 6=Sun' },
              meal_slot: { type: 'string', description: 'e.g. "breakfast", "lunch", "dinner", "snack"' },
              meal_name: { type: 'string' },
              protein_g: { type: 'number' },
              calories: { type: 'number' },
              sort_order: { type: 'number' },
            },
            required: ['day_of_week', 'meal_slot', 'meal_name'],
          },
        },
      },
      required: ['meals'],
    },
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
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleToolCall(name: string, args: Record<string, unknown>) {
  try {
    switch (name) {
      case 'get_recent_workouts': return await getRecentWorkouts(args);
      case 'get_exercise_history': return await getExerciseHistory(args);
      case 'get_active_routine': return await getActiveRoutine();
      case 'get_active_nutrition_plan': return await getActiveNutritionPlan();
      case 'get_body_comp_trend': return await getBodyCompTrend(args);
      case 'get_weekly_summary': return await getWeeklySummary();
      case 'find_exercises': return await findExercises(args);
      case 'create_routine': return await createRoutine(args);
      case 'activate_routine': return await activateRoutine(args);
      case 'update_set_targets': return await updateSetTargets(args);
      case 'swap_exercise': return await swapExercise(args);
      case 'load_nutrition_plan': return await loadNutritionPlan(args);
      case 'log_body_comp': return await logBodyComp(args);
      default: return toolError(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return toolError(e instanceof Error ? e.message : String(e));
  }
}

// ── Read: get_recent_workouts ─────────────────────────────────────────────────

async function getRecentWorkouts(args: Record<string, unknown>) {
  const limit = Math.min(Number(args.limit ?? 10), 50);

  const workouts = await query<{
    uuid: string; title: string | null; start_time: string; end_time: string | null;
    comment: string | null; routine_title: string | null;
  }>(`
    SELECT w.uuid, w.title, w.start_time, w.end_time, w.comment,
           wr.title AS routine_title
    FROM workouts w
    LEFT JOIN workout_routines wr ON wr.uuid = w.workout_routine_uuid
    WHERE w.is_current = false
    ORDER BY w.start_time DESC
    LIMIT $1
  `, [limit]);

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
    rpe: number | null; is_completed: boolean; is_pr: boolean; order_index: number;
  }>(`
    SELECT workout_exercise_uuid, weight, repetitions, rpe, is_completed, is_pr, order_index
    FROM workout_sets
    WHERE workout_exercise_uuid = ANY($1)
    ORDER BY workout_exercise_uuid, order_index
  `, [weUuids]) : [];

  // Assemble
  const setsByWe = sets.reduce((acc, s) => {
    (acc[s.workout_exercise_uuid] ??= []).push(s);
    return acc;
  }, {} as Record<string, typeof sets>);

  const exByWorkout = exercises.reduce((acc, e) => {
    (acc[e.workout_uuid] ??= []).push({ ...e, sets: setsByWe[e.we_uuid] ?? [] });
    return acc;
  }, {} as Record<string, unknown[]>);

  return toolResult(workouts.map(w => ({ ...w, exercises: exByWorkout[w.uuid] ?? [] })));
}

// ── Read: get_exercise_history ────────────────────────────────────────────────

async function getExerciseHistory(args: Record<string, unknown>) {
  const { exercise_uuid, limit = 20 } = args as { exercise_uuid: string; limit?: number };

  const rows = await query<{
    session_date: string; weight: number | null; repetitions: number | null;
    rpe: number | null; is_pr: boolean; set_order: number;
  }>(`
    SELECT w.start_time AS session_date,
           ws.weight, ws.repetitions, ws.rpe, ws.is_pr, ws.order_index AS set_order
    FROM workout_sets ws
    JOIN workout_exercises we ON we.uuid = ws.workout_exercise_uuid
    JOIN workouts w ON w.uuid = we.workout_uuid
    WHERE we.exercise_uuid = $1
      AND w.is_current = false
      AND ws.is_completed = true
    ORDER BY w.start_time DESC, ws.order_index
    LIMIT $2
  `, [exercise_uuid, Math.min(Number(limit), 100)]);

  return toolResult(rows);
}

// ── Read: get_active_routine ──────────────────────────────────────────────────

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

// ── Read: get_active_nutrition_plan ──────────────────────────────────────────

async function getActiveNutritionPlan() {
  const meals = await query(`
    SELECT day_of_week, meal_slot, meal_name, protein_g, calories, sort_order
    FROM nutrition_week_meals
    ORDER BY day_of_week, sort_order
  `);
  return toolResult(meals);
}

// ── Read: get_body_comp_trend ─────────────────────────────────────────────────

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

// ── Read: get_weekly_summary ──────────────────────────────────────────────────

async function getWeeklySummary() {
  const [workouts, nutrition, bodyweight] = await Promise.all([
    query(`
      SELECT w.uuid, w.title, w.start_time, w.end_time,
             COUNT(ws.uuid) AS sets_completed
      FROM workouts w
      LEFT JOIN workout_exercises we ON we.workout_uuid = w.uuid
      LEFT JOIN workout_sets ws ON ws.workout_exercise_uuid = we.uuid AND ws.is_completed = true
      WHERE w.start_time >= date_trunc('week', NOW())
        AND w.is_current = false
      GROUP BY w.uuid, w.title, w.start_time, w.end_time
      ORDER BY w.start_time
    `),
    query(`
      SELECT day_local,
             SUM(calories) AS total_calories,
             SUM(protein_g) AS total_protein_g
      FROM nutrition_food_entries
      WHERE day_local >= to_char(date_trunc('week', NOW()), 'YYYY-MM-DD')
      GROUP BY day_local
      ORDER BY day_local
    `),
    queryOne(`
      SELECT weight_kg, logged_at
      FROM bodyweight_logs
      ORDER BY logged_at DESC
      LIMIT 1
    `),
  ]);

  return toolResult({ workouts, nutrition, latest_bodyweight: bodyweight });
}

// ── Write: find_exercises ─────────────────────────────────────────────────────

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

// ── Write: create_routine ─────────────────────────────────────────────────────

async function createRoutine(args: Record<string, unknown>) {
  const { title, routines } = args as {
    title: string;
    routines: Array<{
      title: string;
      order_index: number;
      exercises?: Array<{
        exercise_uuid: string;
        order_index: number;
        sets?: Array<{ min_repetitions?: number; max_repetitions?: number; order_index: number }>;
      }>;
    }>;
  };

  const planUuid = crypto.randomUUID();

  await query('INSERT INTO workout_plans (uuid, title) VALUES ($1, $2)', [planUuid, title]);

  for (const routine of routines) {
    const rUuid = crypto.randomUUID();
    await query(
      'INSERT INTO workout_routines (uuid, workout_plan_uuid, title, order_index) VALUES ($1, $2, $3, $4)',
      [rUuid, planUuid, routine.title, routine.order_index]
    );

    for (const ex of routine.exercises ?? []) {
      const reUuid = crypto.randomUUID();
      await query(
        'INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index) VALUES ($1, $2, $3, $4)',
        [reUuid, rUuid, ex.exercise_uuid, ex.order_index]
      );

      for (const s of ex.sets ?? []) {
        await query(
          'INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index) VALUES ($1, $2, $3, $4, $5)',
          [crypto.randomUUID(), reUuid, s.min_repetitions ?? null, s.max_repetitions ?? null, s.order_index]
        );
      }
    }
  }

  return toolResult({ plan_uuid: planUuid, message: `Created routine "${title}" with ${routines.length} day(s).` });
}

// ── Write: activate_routine ───────────────────────────────────────────────────

async function activateRoutine(args: Record<string, unknown>) {
  const { plan_uuid } = args as { plan_uuid: string };

  const plan = await queryOne('SELECT uuid, title FROM workout_plans WHERE uuid = $1', [plan_uuid]);
  if (!plan) return toolError(`Plan ${plan_uuid} not found`);

  // Atomic swap — deactivate all then activate target
  await query('UPDATE workout_plans SET is_active = false WHERE is_active = true');
  await query('UPDATE workout_plans SET is_active = true WHERE uuid = $1', [plan_uuid]);

  return toolResult({ activated: plan_uuid, message: `Plan is now active.` });
}

// ── Write: update_set_targets ─────────────────────────────────────────────────

async function updateSetTargets(args: Record<string, unknown>) {
  const { routine_uuid, exercise_uuid, sets } = args as {
    routine_uuid: string;
    exercise_uuid: string;
    sets: Array<{ order_index: number; min_repetitions?: number; max_repetitions?: number }>;
  };

  const re = await queryOne<{ uuid: string }>(
    'SELECT uuid FROM workout_routine_exercises WHERE workout_routine_uuid = $1 AND exercise_uuid = $2 LIMIT 1',
    [routine_uuid, exercise_uuid]
  );
  if (!re) return toolError(`Exercise ${exercise_uuid} not found in routine ${routine_uuid}`);

  let updated = 0;
  for (const s of sets) {
    const result = await query(
      `UPDATE workout_routine_sets
       SET min_repetitions = COALESCE($1, min_repetitions),
           max_repetitions = COALESCE($2, max_repetitions)
       WHERE workout_routine_exercise_uuid = $3 AND order_index = $4`,
      [s.min_repetitions ?? null, s.max_repetitions ?? null, re.uuid, s.order_index]
    );
    if (result.length >= 0) updated++;
  }

  return toolResult({ updated_sets: updated });
}

// ── Write: swap_exercise ──────────────────────────────────────────────────────

async function swapExercise(args: Record<string, unknown>) {
  const { plan_uuid, old_exercise_uuid, new_exercise_uuid } = args as {
    plan_uuid: string; old_exercise_uuid: string; new_exercise_uuid: string;
  };

  const newEx = await queryOne<{ title: string }>(
    'SELECT title FROM exercises WHERE uuid = $1 AND is_hidden = false',
    [new_exercise_uuid]
  );
  if (!newEx) return toolError(`Exercise ${new_exercise_uuid} not found`);

  await query(`
    UPDATE workout_routine_exercises
    SET exercise_uuid = $1
    WHERE exercise_uuid = $2
      AND workout_routine_uuid IN (
        SELECT uuid FROM workout_routines WHERE workout_plan_uuid = $3
      )
  `, [new_exercise_uuid, old_exercise_uuid, plan_uuid]);

  return toolResult({ message: `Swapped to "${newEx.title}" across all days in plan.` });
}

// ── Write: load_nutrition_plan ────────────────────────────────────────────────

async function loadNutritionPlan(args: Record<string, unknown>) {
  const { meals } = args as {
    meals: Array<{
      day_of_week: number; meal_slot: string; meal_name: string;
      protein_g?: number; calories?: number; sort_order?: number;
    }>;
  };

  // Full replace — delete all then insert
  await query('DELETE FROM nutrition_week_meals');

  for (const m of meals) {
    await query(
      `INSERT INTO nutrition_week_meals (uuid, day_of_week, meal_slot, meal_name, protein_g, calories, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        crypto.randomUUID(), m.day_of_week, m.meal_slot, m.meal_name,
        m.protein_g ?? null, m.calories ?? null, m.sort_order ?? 0,
      ]
    );
  }

  return toolResult({ loaded: meals.length, message: `Nutrition plan loaded with ${meals.length} meal entries.` });
}

// ── Write: log_body_comp ──────────────────────────────────────────────────────

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

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Auth check
  const authErr = requireApiKey(request);
  if (authErr) return authErr;

  let body: { jsonrpc?: string; method?: string; params?: Record<string, unknown>; id?: unknown };
  try {
    body = await request.json();
  } catch {
    return err(null, -32700, 'Parse error');
  }

  const { method, params = {}, id } = body;

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'rebirth', version: '1.0.0' },
      });

    case 'notifications/initialized':
      // Fire-and-forget notification — no response body required
      return new NextResponse(null, { status: 204 });

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, { tools: TOOLS });

    case 'tools/call': {
      const name = params.name as string;
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      const result = await handleToolCall(name, toolArgs);
      return ok(id, result);
    }

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

// MCP servers must not respond to GET with an error (Claude Code health-checks via GET)
export async function GET() {
  return NextResponse.json({ name: 'rebirth-mcp', version: '1.0.0', status: 'ok' });
}
