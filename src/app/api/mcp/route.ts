/**
 * Rebirth MCP Server — JSON-RPC 2.0 endpoint
 *
 * Exposes fitness data tools for Claude coaching automation.
 * Auth: Bearer token via REBIRTH_API_KEY (open in dev if unset).
 *
 * Tool groups:
 *   Readers    — get_recent_workouts, get_exercise_history, get_active_routine,
 *                get_active_nutrition_plan, get_body_comp_trend, get_weekly_summary
 *   Finders    — find_exercises
 *   Writers    — create_routine, activate_routine, update_set_targets,
 *                swap_exercise, load_nutrition_plan, log_body_comp
 *   Coaching   — list_coaching_notes, create_coaching_note, update_coaching_note,
 *                delete_coaching_note
 *   Blocks     — list_training_blocks, create_training_block, update_training_block,
 *                delete_training_block
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import {
  getLastWorkoutsWithDetails,
  getExerciseProgress,
  getExercisePRs,
  listExercises,
  getActivePlanWithRoutines,
  listNutritionWeekMeals,
  listBodySpecLogs,
  listMeasurementLogs,
  listBodyweightLogs,
  getWeekWorkouts,
  getWeekVolume,
  getWorkoutStreak,
  getWeekMuscleFrequency,
  listPlans,
  createPlan,
  createRoutine,
  addExerciseToRoutine,
  addRoutineSet,
  activatePlan,
  updateRoutineSet,
  listRoutineExercises,
  listRoutineSets,
  swapExerciseInPlan,
  replaceNutritionWeekPlan,
  createBodySpecLog,
  createMeasurementLog,
  logBodyweight,
  listCoachingNotes,
  createCoachingNote,
  updateCoachingNote,
  deleteCoachingNote,
  listTrainingBlocks,
  createTrainingBlock,
  updateTrainingBlock,
  deleteTrainingBlock,
  type NutritionWeekMealInput,
} from '@/db/queries';

// ── Types ─────────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

function ok(id: string | number | null, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}

function err(id: string | number | null, code: number, message: string, data?: unknown) {
  const error: JsonRpcError = { code, message };
  if (data !== undefined) error.data = data;
  return NextResponse.json({ jsonrpc: '2.0', id, error }, { status: 200 });
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleTool(method: string, params: Record<string, unknown>) {
  switch (method) {

    // ── READERS ────────────────────────────────────────────────────────────

    case 'get_recent_workouts': {
      const limit = typeof params.limit === 'number' ? params.limit : 10;
      return getLastWorkoutsWithDetails(Math.min(limit, 50));
    }

    case 'get_exercise_history': {
      const { exercise_uuid, since_days } = params;
      if (typeof exercise_uuid !== 'string') throw { code: -32602, message: 'exercise_uuid required' };
      const since = typeof since_days === 'number'
        ? new Date(Date.now() - since_days * 86400_000)
        : undefined;
      const [progress, prs] = await Promise.all([
        getExerciseProgress(exercise_uuid, since),
        getExercisePRs(exercise_uuid),
      ]);
      return { exercise_uuid, progress, prs };
    }

    case 'get_active_routine': {
      const data = await getActivePlanWithRoutines();
      if (!data) return null;
      return data;
    }

    case 'get_active_nutrition_plan': {
      const meals = await listNutritionWeekMeals();
      // Group by day for readability
      const byDay: Record<number, typeof meals> = {};
      for (const meal of meals) {
        if (!byDay[meal.day_of_week]) byDay[meal.day_of_week] = [];
        byDay[meal.day_of_week].push(meal);
      }
      return { meals, by_day: byDay };
    }

    case 'get_body_comp_trend': {
      const limit = typeof params.limit === 'number' ? params.limit : 30;
      const [body_spec, measurements, bodyweight] = await Promise.all([
        listBodySpecLogs(Math.min(limit, 180)),
        listMeasurementLogs({ limit: Math.min(limit * 10, 500) }),
        listBodyweightLogs(Math.min(limit, 180)),
      ]);
      return { body_spec, measurements, bodyweight };
    }

    case 'get_weekly_summary': {
      const [workouts, volume, streak, muscleRows] = await Promise.all([
        getWeekWorkouts(),
        getWeekVolume(),
        getWorkoutStreak(),
        getWeekMuscleFrequency(),
      ]);

      // Flatten muscle group mentions into a frequency map
      const muscleFreq: Record<string, number> = {};
      for (const row of muscleRows) {
        const muscles = Array.isArray(row.primary_muscles)
          ? row.primary_muscles
          : JSON.parse((row.primary_muscles as string) || '[]');
        for (const m of muscles) {
          muscleFreq[m] = (muscleFreq[m] ?? 0) + 1;
        }
      }

      return {
        workouts_this_week: workouts.length,
        total_volume_kg: volume,
        week_streak: streak.length,
        muscle_frequency: muscleFreq,
        workouts,
      };
    }

    // ── FINDERS ────────────────────────────────────────────────────────────

    case 'find_exercises': {
      const search = typeof params.search === 'string' ? params.search : undefined;
      const muscleGroup = typeof params.muscle_group === 'string' ? params.muscle_group : undefined;
      const equipment = typeof params.equipment === 'string' ? params.equipment : undefined;

      if (!search && !muscleGroup && !equipment) {
        throw { code: -32602, message: 'At least one of search, muscle_group, or equipment required' };
      }

      const exercises = await listExercises({ search, muscleGroup, equipment });
      return { count: exercises.length, exercises: exercises.slice(0, 20) };
    }

    // ── WRITERS ────────────────────────────────────────────────────────────

    case 'create_routine': {
      const { title, routines } = params;
      if (typeof title !== 'string') throw { code: -32602, message: 'title required' };

      const plan = await createPlan(title);

      // routines: Array<{ title, exercises: Array<{ exercise_uuid, sets: Array<{ min_reps, max_reps }> }> }>
      if (Array.isArray(routines)) {
        for (let ri = 0; ri < routines.length; ri++) {
          const r = routines[ri] as Record<string, unknown>;
          if (typeof r.title !== 'string') continue;

          const routine = await createRoutine(plan.uuid, r.title);

          if (Array.isArray(r.exercises)) {
            for (let ei = 0; ei < r.exercises.length; ei++) {
              const e = r.exercises[ei] as Record<string, unknown>;
              if (typeof e.exercise_uuid !== 'string') continue;

              const re = await addExerciseToRoutine(routine.uuid, e.exercise_uuid);

              if (Array.isArray(e.sets)) {
                for (const s of e.sets as Record<string, unknown>[]) {
                  await addRoutineSet(re.uuid, {
                    minRepetitions: typeof s.min_reps === 'number' ? s.min_reps : undefined,
                    maxRepetitions: typeof s.max_reps === 'number' ? s.max_reps : undefined,
                  });
                }
              }
            }
          }
        }
      }

      // Return what was just created regardless of active state
      const allPlans = await listPlans();
      const created = allPlans.find(p => p.uuid === plan.uuid);
      return { plan: created ?? plan };
    }

    case 'activate_routine': {
      const { plan_uuid } = params;
      if (typeof plan_uuid !== 'string') throw { code: -32602, message: 'plan_uuid required' };
      await activatePlan(plan_uuid);
      const data = await getActivePlanWithRoutines();
      return { activated: plan_uuid, active_plan: data };
    }

    case 'update_set_targets': {
      // Updates rep targets across multiple sets in a routine
      // sets: Array<{ routine_set_uuid, min_reps?, max_reps? }>
      const { sets } = params;
      if (!Array.isArray(sets) || sets.length === 0) {
        throw { code: -32602, message: 'sets array required' };
      }

      const results = [];
      for (const s of sets as Record<string, unknown>[]) {
        if (typeof s.routine_set_uuid !== 'string') continue;
        const updated = await updateRoutineSet(s.routine_set_uuid, {
          min_repetitions: typeof s.min_reps === 'number' ? s.min_reps : undefined,
          max_repetitions: typeof s.max_reps === 'number' ? s.max_reps : undefined,
        });
        results.push(updated);
      }
      return { updated: results.length, sets: results };
    }

    case 'swap_exercise': {
      const { plan_uuid, from_exercise_uuid, to_exercise_uuid } = params;
      if (typeof plan_uuid !== 'string') throw { code: -32602, message: 'plan_uuid required' };
      if (typeof from_exercise_uuid !== 'string') throw { code: -32602, message: 'from_exercise_uuid required' };
      if (typeof to_exercise_uuid !== 'string') throw { code: -32602, message: 'to_exercise_uuid required' };

      const count = await swapExerciseInPlan(plan_uuid, from_exercise_uuid, to_exercise_uuid);
      return { swapped_count: count, plan_uuid, from: from_exercise_uuid, to: to_exercise_uuid };
    }

    case 'load_nutrition_plan': {
      const { meals } = params;
      if (!Array.isArray(meals) || meals.length === 0) {
        throw { code: -32602, message: 'meals array required' };
      }

      const mealInputs: NutritionWeekMealInput[] = (meals as Record<string, unknown>[]).map(m => {
        if (typeof m.day_of_week !== 'number' || typeof m.meal_name !== 'string') {
          throw { code: -32602, message: 'Each meal requires day_of_week (number) and meal_name (string)' };
        }
        return {
          day_of_week: m.day_of_week,
          meal_slot: typeof m.meal_slot === 'string' ? m.meal_slot : 'meal',
          meal_name: m.meal_name,
          protein_g: typeof m.protein_g === 'number' ? m.protein_g : null,
          calories: typeof m.calories === 'number' ? m.calories : null,
          quality_rating: typeof m.quality_rating === 'number' ? m.quality_rating : null,
          sort_order: typeof m.sort_order === 'number' ? m.sort_order : 0,
        };
      });

      const inserted = await replaceNutritionWeekPlan(mealInputs);
      return { replaced: inserted.length, meals: inserted };
    }

    case 'log_body_comp': {
      const { measured_at } = params;
      const results: Record<string, unknown> = {};

      // Body spec (InBody / DEXA style)
      if (params.body_fat_pct != null || params.lean_mass_kg != null || params.weight_kg != null) {
        results.body_spec = await createBodySpecLog({
          height_cm: typeof params.height_cm === 'number' ? params.height_cm : null,
          weight_kg: typeof params.weight_kg === 'number' ? params.weight_kg : null,
          body_fat_pct: typeof params.body_fat_pct === 'number' ? params.body_fat_pct : null,
          lean_mass_kg: typeof params.lean_mass_kg === 'number' ? params.lean_mass_kg : null,
          notes: typeof params.notes === 'string' ? params.notes : null,
          measured_at: typeof measured_at === 'string' ? measured_at : new Date().toISOString(),
        });
      }

      // Tape measurements
      if (params.measurements && typeof params.measurements === 'object') {
        const m = params.measurements as Record<string, number>;
        const measurementEntries = Object.entries(m);
        const measurementResults = [];
        for (const [site, value_cm] of measurementEntries) {
          if (typeof value_cm === 'number') {
            const log = await createMeasurementLog({
              site,
              value_cm,
              notes: null,
              measured_at: typeof measured_at === 'string' ? measured_at : undefined,
            });
            measurementResults.push(log);
          }
        }
        results.measurements = measurementResults;
      }

      // Scale weight only
      if (params.weight_kg != null && params.body_fat_pct == null) {
        results.bodyweight = await logBodyweight(
          params.weight_kg as number,
          typeof params.notes === 'string' ? params.notes : undefined,
        );
      }

      return results;
    }

    // ── COACHING NOTES ─────────────────────────────────────────────────────

    case 'list_coaching_notes': {
      const pinned_only = params.pinned_only === true;
      const category = typeof params.category === 'string' ? params.category : undefined;
      const limit = typeof params.limit === 'number' ? params.limit : 50;
      return listCoachingNotes({ pinned_only, category, limit });
    }

    case 'create_coaching_note': {
      const { content } = params;
      if (typeof content !== 'string') throw { code: -32602, message: 'content required' };
      return createCoachingNote({
        content,
        is_pinned: params.is_pinned === true,
        category: typeof params.category === 'string' ? params.category : null,
        related_exercise_uuid: typeof params.related_exercise_uuid === 'string' ? params.related_exercise_uuid : null,
      });
    }

    case 'update_coaching_note': {
      const { uuid } = params;
      if (typeof uuid !== 'string') throw { code: -32602, message: 'uuid required' };
      return updateCoachingNote(uuid, {
        content: typeof params.content === 'string' ? params.content : undefined,
        is_pinned: typeof params.is_pinned === 'boolean' ? params.is_pinned : undefined,
        category: params.category !== undefined ? (params.category as string | null) : undefined,
        related_exercise_uuid: params.related_exercise_uuid !== undefined
          ? (params.related_exercise_uuid as string | null)
          : undefined,
      });
    }

    case 'delete_coaching_note': {
      const { uuid } = params;
      if (typeof uuid !== 'string') throw { code: -32602, message: 'uuid required' };
      await deleteCoachingNote(uuid);
      return { deleted: uuid };
    }

    // ── TRAINING BLOCKS ────────────────────────────────────────────────────

    case 'list_training_blocks': {
      return listTrainingBlocks();
    }

    case 'create_training_block': {
      const { title, start_date, end_date } = params;
      if (typeof title !== 'string') throw { code: -32602, message: 'title required' };
      if (typeof start_date !== 'string') throw { code: -32602, message: 'start_date required' };
      if (typeof end_date !== 'string') throw { code: -32602, message: 'end_date required' };
      return createTrainingBlock({
        title,
        start_date,
        end_date,
        goal: typeof params.goal === 'string' ? params.goal : null,
        workout_plan_uuid: typeof params.workout_plan_uuid === 'string' ? params.workout_plan_uuid : null,
        notes: typeof params.notes === 'string' ? params.notes : null,
      });
    }

    case 'update_training_block': {
      const { uuid } = params;
      if (typeof uuid !== 'string') throw { code: -32602, message: 'uuid required' };
      return updateTrainingBlock(uuid, {
        title: typeof params.title === 'string' ? params.title : undefined,
        goal: params.goal !== undefined ? (params.goal as string | null) : undefined,
        start_date: typeof params.start_date === 'string' ? params.start_date : undefined,
        end_date: typeof params.end_date === 'string' ? params.end_date : undefined,
        notes: params.notes !== undefined ? (params.notes as string | null) : undefined,
        workout_plan_uuid: params.workout_plan_uuid !== undefined
          ? (params.workout_plan_uuid as string | null)
          : undefined,
      });
    }

    case 'delete_training_block': {
      const { uuid } = params;
      if (typeof uuid !== 'string') throw { code: -32602, message: 'uuid required' };
      await deleteTrainingBlock(uuid);
      return { deleted: uuid };
    }

    default:
      throw { code: -32601, message: `Method not found: ${method}` };
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  let body: JsonRpcRequest;
  try {
    body = await request.json();
  } catch {
    return err(null, -32700, 'Parse error');
  }

  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return err(body.id ?? null, -32600, 'Invalid Request');
  }

  try {
    const result = await handleTool(body.method, body.params ?? {});
    return ok(body.id ?? null, result);
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
      const rpcErr = e as JsonRpcError;
      return err(body.id ?? null, rpcErr.code, rpcErr.message, rpcErr.data);
    }
    console.error('[MCP] Unhandled error:', e);
    return err(body.id ?? null, -32603, 'Internal error');
  }
}

// Introspection: list available tools
export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  return NextResponse.json({
    server: 'rebirth-mcp',
    version: '1.0.0',
    tools: [
      // Readers
      { name: 'get_recent_workouts', description: 'Recent completed workouts with exercises and volume', params: ['limit?'] },
      { name: 'get_exercise_history', description: 'Progression data and PRs for a specific exercise', params: ['exercise_uuid', 'since_days?'] },
      { name: 'get_active_routine', description: 'The currently active training plan with all routines and set targets', params: [] },
      { name: 'get_active_nutrition_plan', description: 'Current week meal plan grouped by day', params: [] },
      { name: 'get_body_comp_trend', description: 'Body spec, measurements, and weight logs', params: ['limit?'] },
      { name: 'get_weekly_summary', description: 'This week — workout count, volume, streak, muscle frequency', params: [] },
      // Finders
      { name: 'find_exercises', description: 'Fuzzy search the exercise library', params: ['search?', 'muscle_group?', 'equipment?'] },
      // Writers
      { name: 'create_routine', description: 'Create a new workout plan with routines and exercises', params: ['title', 'routines?'] },
      { name: 'activate_routine', description: 'Mark a plan as the active training plan (atomic swap)', params: ['plan_uuid'] },
      { name: 'update_set_targets', description: 'Update rep targets on routine sets', params: ['sets'] },
      { name: 'swap_exercise', description: 'Replace an exercise across all routines in a plan', params: ['plan_uuid', 'from_exercise_uuid', 'to_exercise_uuid'] },
      { name: 'load_nutrition_plan', description: 'Replace the entire week meal plan (transactional)', params: ['meals'] },
      { name: 'log_body_comp', description: 'Log body composition data (InBody, tape measurements, scale weight)', params: ['weight_kg?', 'body_fat_pct?', 'lean_mass_kg?', 'measurements?', 'measured_at?'] },
      // Coaching notes
      { name: 'list_coaching_notes', description: 'List coaching notes, optionally filtered by pinned/category', params: ['pinned_only?', 'category?', 'limit?'] },
      { name: 'create_coaching_note', description: 'Create a coaching note (pinnable context for Claude)', params: ['content', 'is_pinned?', 'category?', 'related_exercise_uuid?'] },
      { name: 'update_coaching_note', description: 'Update a coaching note', params: ['uuid', 'content?', 'is_pinned?', 'category?'] },
      { name: 'delete_coaching_note', description: 'Delete a coaching note', params: ['uuid'] },
      // Training blocks
      { name: 'list_training_blocks', description: 'List all training blocks (periodisation)', params: [] },
      { name: 'create_training_block', description: 'Create a training block with goal, dates, and linked plan', params: ['title', 'start_date', 'end_date', 'goal?', 'workout_plan_uuid?'] },
      { name: 'update_training_block', description: 'Update a training block', params: ['uuid', 'title?', 'goal?', 'start_date?', 'end_date?', 'notes?'] },
      { name: 'delete_training_block', description: 'Delete a training block', params: ['uuid'] },
    ],
  });
}
