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
    name: 'get_nutrition_plan',
    description: 'Returns the current weekly meal plan grouped by day, with optional 7-day compliance summary from nutrition logs.',
    inputSchema: {
      type: 'object',
      properties: {
        include_compliance: { type: 'boolean', description: 'If true, include avg calories/protein from the last 7 logged days' },
      },
    },
  },
  {
    name: 'get_body_comp',
    description: 'Returns a structured body composition snapshot: current stats, 7d/30d trends, latest measurements per site, and historical weight/body-fat timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        days_back: { type: 'number', description: 'History window in days (default 90)' },
      },
    },
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
        measurements: {
          type: 'object',
          description: 'Circumference measurements in cm (any subset)',
          properties: {
            chest: { type: 'number' },
            waist: { type: 'number' },
            hips: { type: 'number' },
            neck: { type: 'number' },
            shoulders: { type: 'number' },
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
    description: 'Replaces the entire standard-week meal template with a new plan. Accepts days with nested meals.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'array',
          description: 'Array of days with their meals',
          items: {
            type: 'object',
            properties: {
              day: { type: ['string', 'number'], description: 'Day name (Mon/Tue/Wed/Thu/Fri/Sat/Sun) or number (1=Mon … 7=Sun)' },
              meals: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    slot: { type: 'string', description: 'breakfast | lunch | dinner | snack' },
                    description: { type: 'string', description: 'Meal name/description' },
                    calories: { type: 'number' },
                    protein_g: { type: 'number' },
                    carbs_g: { type: 'number', description: 'Accepted but not stored (column absent from schema)' },
                    fat_g: { type: 'number', description: 'Accepted but not stored (column absent from schema)' },
                  },
                  required: ['slot', 'description'],
                },
              },
            },
            required: ['day', 'meals'],
          },
        },
        targets: {
          type: 'object',
          description: 'Daily macro targets — accepted but not stored (no targets table exists)',
          properties: {
            calories: { type: 'number' },
            protein_g: { type: 'number' },
            carbs_g: { type: 'number' },
            fat_g: { type: 'number' },
          },
        },
      },
      required: ['days'],
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
  },
  {
    name: 'delete_coaching_note',
    description: 'Deletes a coaching note.',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' } },
      required: ['uuid'],
    },
  },
  // ── Training blocks ──────────────────────────────────────────────────────────
  {
    name: 'list_training_blocks',
    description: 'Returns all training blocks (periodisation periods) ordered by start date.',
    inputSchema: { type: 'object', properties: {} },
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
  },
  {
    name: 'delete_training_block',
    description: 'Deletes a training block.',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' } },
      required: ['uuid'],
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
      case 'get_nutrition_plan': return await getNutritionPlan(args);
      case 'get_body_comp': return await getBodyComp(args);
      case 'update_body_comp': return await updateBodyComp(args);
      case 'get_body_comp_trend': return await getBodyCompTrend(args);
      case 'get_weekly_summary': return await getWeeklySummary();
      case 'find_exercises': return await findExercises(args);
      case 'create_routine': return await createRoutine(args);
      case 'activate_routine': return await activateRoutine(args);
      case 'update_set_targets': return await updateSetTargets(args);
      case 'swap_exercise': return await swapExercise(args);
      case 'load_nutrition_plan': return await loadNutritionPlan(args);
      case 'log_body_comp': return await logBodyComp(args);
      case 'list_coaching_notes': return await listCoachingNotes(args);
      case 'create_coaching_note': return await createCoachingNote(args);
      case 'update_coaching_note': return await updateCoachingNote(args);
      case 'delete_coaching_note': return await deleteCoachingNote(args);
      case 'list_training_blocks': return await listTrainingBlocks();
      case 'create_training_block': return await createTrainingBlock(args);
      case 'update_training_block': return await updateTrainingBlock(args);
      case 'delete_training_block': return await deleteTrainingBlock(args);
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

// ── Read: get_nutrition_plan ──────────────────────────────────────────────────

const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function getNutritionPlan(args: Record<string, unknown>) {
  const includeCompliance = args.include_compliance === true;

  const meals = await query<{
    day_of_week: number; meal_slot: string; meal_name: string;
    protein_g: number | null; calories: number | null; sort_order: number;
  }>(`
    SELECT day_of_week, meal_slot, meal_name, protein_g, calories, sort_order
    FROM nutrition_week_meals
    ORDER BY day_of_week, sort_order
  `);

  // Group by day
  const byDay = new Map<number, typeof meals>();
  for (const m of meals) {
    if (!byDay.has(m.day_of_week)) byDay.set(m.day_of_week, []);
    byDay.get(m.day_of_week)!.push(m);
  }

  const week_plan = Array.from(byDay.entries())
    .sort(([a], [b]) => a - b)
    .map(([dow, dayMeals]) => ({
      day: DOW_NAMES[dow] ?? String(dow),
      meals: dayMeals.map(m => ({
        slot: m.meal_slot,
        description: m.meal_name,
        calories: m.calories,
        protein_g: m.protein_g,
      })),
    }));

  const result: Record<string, unknown> = { week_plan };

  if (includeCompliance) {
    const compliance = await queryOne<{
      avg_calories: string | null; avg_protein: string | null; logged_days: string;
    }>(`
      SELECT
        ROUND(AVG(daily_cal)::numeric, 1) AS avg_calories,
        ROUND(AVG(daily_prot)::numeric, 1) AS avg_protein,
        COUNT(*)::int AS logged_days
      FROM (
        SELECT
          DATE(logged_at) AS d,
          SUM(calories) AS daily_cal,
          SUM(protein_g) AS daily_prot
        FROM nutrition_logs
        WHERE logged_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(logged_at)
      ) sub
    `);
    result.compliance_7d = {
      avg_calories: compliance?.avg_calories != null ? Number(compliance.avg_calories) : null,
      avg_protein: compliance?.avg_protein != null ? Number(compliance.avg_protein) : null,
      logged_days: Number(compliance?.logged_days ?? 0),
    };
  }

  return toolResult(result);
}

// ── Read: get_body_comp ───────────────────────────────────────────────────────

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

  const currentWeight = toNum(latestWeight?.weight_kg);
  const currentBF = toNum(latestSpec?.body_fat_pct);
  const currentLM = toNum(latestSpec?.lean_mass_kg);

  const w7 = toNum(weight7dAgo?.weight_kg);
  const w30 = toNum(weight30dAgo?.weight_kg);
  const bf7 = toNum(spec7dAgo?.body_fat_pct);
  const bf30 = toNum(spec30dAgo?.body_fat_pct);

  const round2 = (n: number | null) => n != null ? Math.round(n * 100) / 100 : null;

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

// ── Write: update_body_comp ───────────────────────────────────────────────────

// Maps tool-facing measurement field names to DB site names
const MEASUREMENT_SITE_MAP: Record<string, string> = {
  chest: 'chest',
  waist: 'waist',
  hips: 'hips',
  neck: 'neck',
  shoulders: 'shoulders',
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

  // Use parameterized timestamp to avoid SQL injection
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

const DAY_NAME_MAP: Record<string, number> = {
  mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
};

function parseDayOfWeek(day: string | number): number {
  if (typeof day === 'number') return Math.max(0, Math.min(6, day - 1));
  const key = String(day).toLowerCase().slice(0, 3);
  return DAY_NAME_MAP[key] ?? 0;
}

async function loadNutritionPlan(args: Record<string, unknown>) {
  const { days, targets } = args as {
    days: Array<{
      day: string | number;
      meals: Array<{
        slot: string; description: string; calories?: number;
        protein_g?: number; carbs_g?: number; fat_g?: number;
      }>;
    }>;
    targets?: { calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number };
  };

  // Full replace — delete all then insert
  await query('DELETE FROM nutrition_week_meals');

  let mealCount = 0;
  for (const d of days) {
    const dow = parseDayOfWeek(d.day as string | number);
    for (let i = 0; i < d.meals.length; i++) {
      const m = d.meals[i];
      await query(
        `INSERT INTO nutrition_week_meals (uuid, day_of_week, meal_slot, meal_name, protein_g, calories, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [crypto.randomUUID(), dow, m.slot, m.description, m.protein_g ?? null, m.calories ?? null, i]
      );
      mealCount++;
    }
  }

  const notes: string[] = [];
  if (targets) notes.push('targets not stored (no targets table in schema)');
  const hasUnstorableFields = days.some(d =>
    d.meals.some(m => m.carbs_g !== undefined || m.fat_g !== undefined)
  );
  if (hasUnstorableFields) notes.push('carbs_g and fat_g not stored (columns absent from nutrition_week_meals)');

  return toolResult({
    success: true,
    meals_created: mealCount,
    weeks_loaded: days.length,
    ...(notes.length > 0 ? { notes } : {}),
  });
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

// ── Coaching notes ────────────────────────────────────────────────────────────

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

// ── Training blocks ───────────────────────────────────────────────────────────

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
