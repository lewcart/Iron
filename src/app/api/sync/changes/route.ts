import { NextResponse } from 'next/server';
import { query } from '@/db/db';

// ─── /api/sync/changes ────────────────────────────────────────────────────────
//
// New CDC-style sync pull endpoint. Replaces the per-table timestamp cursor
// from /api/sync/pull with a single monotonic seq cursor backed by the
// change_log table (see migration 019).
//
// Request:  GET /api/sync/changes?since=<seq>&limit=<n>
// Response:
//   {
//     changes: [{ seq, table_name, row_uuid, op }, ...],
//     rows: { table_name: [{...row data}, ...], ... },
//     max_seq: number,
//     has_more: boolean
//   }
//
// `changes` is the ordered list of seq entries the client should apply.
// `rows` is the joined payload — for every (table_name, row_uuid) pair where
// op is insert or update, the latest row data is included. Deletes are
// represented only in `changes`; the client uses bulkDelete for those.
//
// `max_seq` lets the client advance its cursor exactly to the last applied
// change. `has_more` lets it loop until caught up.

const SYNCED_TABLES = [
  'exercises',
  'muscles',
  'workouts', 'workout_exercises', 'workout_sets',
  'workout_plans', 'workout_routines', 'workout_routine_exercises', 'workout_routine_sets',
  'bodyweight_logs', 'body_spec_logs', 'measurement_logs', 'inbody_scans', 'body_goals',
  'body_vision', 'body_plan', 'plan_checkpoint',
  'nutrition_logs', 'nutrition_week_meals', 'nutrition_day_notes', 'nutrition_targets',
  'hrt_timeline_periods',
  'lab_draws', 'lab_results',
  'wellbeing_logs', 'dysphoria_logs', 'clothes_test_logs',
  'progress_photos',
  'exercise_image_candidates',
  'vision_muscle_overrides',
] as const;

type SyncedTable = typeof SYNCED_TABLES[number];

interface ChangeLogRow {
  seq: number;
  table_name: SyncedTable;
  row_uuid: string;
  op: 'insert' | 'update' | 'delete';
}

const PAGE_LIMIT_DEFAULT = 1000;
const PAGE_LIMIT_MAX = 5000;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const since = Number(searchParams.get('since') ?? 0);
    const requestedLimit = Number(searchParams.get('limit') ?? PAGE_LIMIT_DEFAULT);
    const limit = Math.min(Math.max(requestedLimit, 1), PAGE_LIMIT_MAX);

    // Read one extra entry beyond the limit to detect has_more cheaply.
    const changesPlusOne = await query<ChangeLogRow>(
      `SELECT seq, table_name, row_uuid, op
         FROM change_log
        WHERE seq > $1
        ORDER BY seq
        LIMIT $2`,
      [since, limit + 1],
    );

    const has_more = changesPlusOne.length > limit;
    const changes = has_more ? changesPlusOne.slice(0, limit) : changesPlusOne;

    if (changes.length === 0) {
      return NextResponse.json({
        changes: [],
        rows: {},
        max_seq: since,
        has_more: false,
      });
    }

    // Group inserts/updates by table → unique row UUIDs to fetch.
    const fetchByTable = new Map<SyncedTable, Set<string>>();
    for (const c of changes) {
      if (c.op === 'delete') continue;
      // Defensive — a malformed table_name in change_log would break us. Skip
      // rather than crash the whole pull.
      if (!SYNCED_TABLES.includes(c.table_name)) continue;
      if (!fetchByTable.has(c.table_name)) {
        fetchByTable.set(c.table_name, new Set());
      }
      fetchByTable.get(c.table_name)!.add(c.row_uuid);
    }

    // Fetch row data for each table in parallel. Tables with zero
    // inserts/updates in this page are skipped entirely.
    const fetched = await Promise.all(
      [...fetchByTable.entries()].map(async ([table, uuids]) => {
        const rows = await fetchRows(table, [...uuids]);
        return [table, rows] as const;
      }),
    );

    const rows: Partial<Record<SyncedTable, Array<Record<string, unknown>>>> = {};
    for (const [table, data] of fetched) {
      if (data.length > 0) rows[table] = data;
    }

    const max_seq = changes[changes.length - 1].seq;

    return NextResponse.json({
      changes,
      rows,
      max_seq,
      has_more,
    });
  } catch (err) {
    console.error('sync/changes error:', err);
    return NextResponse.json({ error: 'Changes fetch failed' }, { status: 500 });
  }
}

// ─── Per-table row fetch + mapping ────────────────────────────────────────────
//
// Each table maps its server schema to the local Dexie shape. Row UUIDs
// come from change_log.row_uuid; for tables keyed by something other than
// `uuid` (body_goals = metric_key, nutrition_targets = id), we map back.

async function fetchRows(table: SyncedTable, uuids: string[]): Promise<Array<Record<string, unknown>>> {
  if (uuids.length === 0) return [];

  switch (table) {
    case 'exercises': {
      const r = await query<Record<string, unknown>>(
        'SELECT * FROM exercises WHERE uuid = ANY($1::text[])', [uuids]);
      return r.map(mapExercise);
    }
    case 'muscles':
      // change_log.row_uuid stores slug for this table.
      return (await query<Record<string, unknown>>(
        `SELECT slug, display_name, parent_group, optimal_sets_min, optimal_sets_max, display_order
         FROM muscles WHERE slug = ANY($1::text[])`, [uuids]))
        .map(r => ({
          slug: r.slug,
          display_name: r.display_name,
          parent_group: r.parent_group,
          optimal_sets_min: Number(r.optimal_sets_min),
          optimal_sets_max: Number(r.optimal_sets_max),
          display_order: Number(r.display_order),
        }));
    case 'workouts': {
      const r = await query<Record<string, unknown>>(
        'SELECT * FROM workouts WHERE uuid = ANY($1::text[])', [uuids]);
      return r.map(mapWorkout);
    }
    case 'workout_exercises': {
      const r = await query<Record<string, unknown>>(
        'SELECT * FROM workout_exercises WHERE uuid = ANY($1::text[])', [uuids]);
      return r.map(mapWorkoutExercise);
    }
    case 'workout_sets': {
      const r = await query<Record<string, unknown>>(
        'SELECT * FROM workout_sets WHERE uuid = ANY($1::text[])', [uuids]);
      return r.map(mapWorkoutSet);
    }
    case 'workout_plans':
      return (await query<Record<string, unknown>>(
        'SELECT uuid, title, COALESCE(order_index, 0) AS order_index, COALESCE(is_active, false) AS is_active FROM workout_plans WHERE uuid = ANY($1::text[])', [uuids]))
        .map(r => ({ ...r, is_active: Boolean(r.is_active) }));
    case 'workout_routines':
      return (await query<Record<string, unknown>>(
        'SELECT uuid, workout_plan_uuid, title, comment, order_index, cycle_length_days, frequency_per_week FROM workout_routines WHERE uuid = ANY($1::text[])', [uuids]))
        .map(r => ({
          ...r,
          cycle_length_days: r.cycle_length_days != null ? Number(r.cycle_length_days) : null,
          frequency_per_week: r.frequency_per_week != null ? Number(r.frequency_per_week) : null,
        }));
    case 'workout_routine_exercises':
      return (await query<Record<string, unknown>>(
        'SELECT uuid, workout_routine_uuid, exercise_uuid, comment, order_index, goal_window FROM workout_routine_exercises WHERE uuid = ANY($1::text[])', [uuids]))
        .map(r => ({ ...r, exercise_uuid: String(r.exercise_uuid).toLowerCase() }));
    case 'workout_routine_sets':
      return (await query<Record<string, unknown>>(
        'SELECT uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, tag, comment, order_index, target_duration_seconds, target_rir FROM workout_routine_sets WHERE uuid = ANY($1::text[])', [uuids]))
        .map(r => ({
          ...r,
          target_rir: r.target_rir != null ? Number(r.target_rir) : null,
        }));
    case 'vision_muscle_overrides':
      // Postgres composite PK (vision_uuid, muscle_slug). change_log emits
      // row_uuid as 'vision_uuid|muscle_slug'. Local Dexie uses synthetic
      // single-string `id` PK with the same format — emit it here so
      // bulkPut keys align.
      return (await query<Record<string, unknown>>(
        `SELECT vision_uuid, muscle_slug, override_sets_min, override_sets_max, override_freq_min, evidence, notes
         FROM vision_muscle_overrides
         WHERE (vision_uuid || '|' || muscle_slug) = ANY($1::text[])`, [uuids]))
        .map(r => ({
          id: `${r.vision_uuid}|${r.muscle_slug}`,
          vision_uuid: r.vision_uuid,
          muscle_slug: r.muscle_slug,
          override_sets_min: r.override_sets_min != null ? Number(r.override_sets_min) : null,
          override_sets_max: r.override_sets_max != null ? Number(r.override_sets_max) : null,
          override_freq_min: r.override_freq_min != null ? Number(r.override_freq_min) : null,
          evidence: r.evidence ?? null,
          notes: r.notes ?? null,
        }));
    case 'bodyweight_logs':
      return (await query<Record<string, unknown>>(
        'SELECT * FROM bodyweight_logs WHERE uuid = ANY($1::text[])', [uuids]))
        .map(mapBodyweightLog);
    case 'body_spec_logs':
      return (await query<Record<string, unknown>>(
        'SELECT * FROM body_spec_logs WHERE uuid = ANY($1::text[])', [uuids]))
        .map(r => ({
          uuid: r.uuid,
          height_cm: nullableNumber(r.height_cm),
          weight_kg: nullableNumber(r.weight_kg),
          body_fat_pct: nullableNumber(r.body_fat_pct),
          lean_mass_kg: nullableNumber(r.lean_mass_kg),
          notes: r.notes ?? null,
          measured_at: toIso(r.measured_at),
        }));
    case 'measurement_logs':
      return (await query<Record<string, unknown>>(
        'SELECT * FROM measurement_logs WHERE uuid = ANY($1::text[])', [uuids]))
        .map(r => ({
          uuid: r.uuid,
          site: r.site,
          value_cm: Number(r.value_cm),
          notes: r.notes ?? null,
          measured_at: toIso(r.measured_at),
          source: r.source ?? null,
          source_ref: r.source_ref ?? null,
        }));
    case 'inbody_scans':
      return (await query<Record<string, unknown>>(
        'SELECT * FROM inbody_scans WHERE uuid = ANY($1::text[])', [uuids]))
        .map(mapInbodyScan);
    case 'body_goals':
      // change_log.row_uuid stores metric_key for this table.
      return query<Record<string, unknown>>(
        'SELECT metric_key, target_value, unit, direction, notes FROM body_goals WHERE metric_key = ANY($1::text[])', [uuids]);
    case 'body_vision':
      return (await query<Record<string, unknown>>(
        `SELECT uuid, title, body_md, summary, principles, build_emphasis, maintain_emphasis,
                deemphasize, status, archived_at
         FROM body_vision WHERE uuid = ANY($1::text[])`, [uuids]))
        .map(r => ({
          ...r,
          principles: Array.isArray(r.principles) ? r.principles : [],
          build_emphasis: Array.isArray(r.build_emphasis) ? r.build_emphasis : [],
          maintain_emphasis: Array.isArray(r.maintain_emphasis) ? r.maintain_emphasis : [],
          deemphasize: Array.isArray(r.deemphasize) ? r.deemphasize : [],
          archived_at: r.archived_at ? toIso(r.archived_at) : null,
        }));
    case 'body_plan':
      return (await query<Record<string, unknown>>(
        `SELECT uuid, vision_id, title, summary, body_md, horizon_months,
                start_date, target_date, north_star_metrics, programming_dose,
                nutrition_anchors, reevaluation_triggers, status
         FROM body_plan WHERE uuid = ANY($1::text[])`, [uuids]))
        .map(r => ({
          ...r,
          horizon_months: Number(r.horizon_months),
          start_date: toIso(r.start_date).slice(0, 10),
          target_date: toIso(r.target_date).slice(0, 10),
          north_star_metrics: Array.isArray(r.north_star_metrics) ? r.north_star_metrics : [],
          programming_dose: r.programming_dose ?? {},
          nutrition_anchors: r.nutrition_anchors ?? {},
          reevaluation_triggers: Array.isArray(r.reevaluation_triggers) ? r.reevaluation_triggers : [],
        }));
    case 'plan_checkpoint':
      return (await query<Record<string, unknown>>(
        `SELECT uuid, plan_id, quarter_label, target_date, review_date, status,
                metrics_snapshot, assessment, notes, adjustments_made
         FROM plan_checkpoint WHERE uuid = ANY($1::text[])`, [uuids]))
        .map(r => ({
          ...r,
          target_date: toIso(r.target_date).slice(0, 10),
          review_date: r.review_date ? toIso(r.review_date).slice(0, 10) : null,
          metrics_snapshot: r.metrics_snapshot ?? null,
          adjustments_made: Array.isArray(r.adjustments_made) ? r.adjustments_made : [],
        }));
    case 'nutrition_logs':
      return (await query<Record<string, unknown>>(
        `SELECT uuid, logged_at, meal_type, meal_name, calories, protein_g, carbs_g, fat_g,
                notes, template_meal_id, status
         FROM nutrition_logs WHERE uuid = ANY($1::text[])`, [uuids]))
        .map(r => ({
          ...r,
          logged_at: toIso(r.logged_at),
          // Postgres NUMERIC → string by default in node-postgres. Without the
          // cast, the client sums them with `+` and gets "571"+"114" = "571114".
          calories: r.calories != null ? Number(r.calories) : null,
          protein_g: r.protein_g != null ? Number(r.protein_g) : null,
          carbs_g: r.carbs_g != null ? Number(r.carbs_g) : null,
          fat_g: r.fat_g != null ? Number(r.fat_g) : null,
        }));
    case 'nutrition_week_meals':
      return (await query<Record<string, unknown>>(
        `SELECT uuid, day_of_week, meal_slot, meal_name, protein_g, carbs_g, fat_g,
                calories, quality_rating, sort_order
         FROM nutrition_week_meals WHERE uuid = ANY($1::text[])`, [uuids]))
        .map(r => ({
          ...r,
          calories: r.calories != null ? Number(r.calories) : null,
          protein_g: r.protein_g != null ? Number(r.protein_g) : null,
          carbs_g: r.carbs_g != null ? Number(r.carbs_g) : null,
          fat_g: r.fat_g != null ? Number(r.fat_g) : null,
        }));
    case 'nutrition_day_notes':
      return (await query<Record<string, unknown>>(
        `SELECT uuid, date, hydration_ml, notes, approved_status, approved_at,
                template_applied_at
         FROM nutrition_day_notes WHERE uuid = ANY($1::text[])`, [uuids]))
        .map(r => ({
          ...r,
          approved_at: r.approved_at ? toIso(r.approved_at) : null,
          template_applied_at: r.template_applied_at ? toIso(r.template_applied_at) : null,
        }));
    case 'nutrition_targets':
      // Singleton — uuids contains '1'. Map id→id.
      return (await query<Record<string, unknown>>(
        `SELECT id, calories, protein_g, carbs_g, fat_g, bands
         FROM nutrition_targets WHERE id::TEXT = ANY($1::text[])`, [uuids]))
        .map(r => ({ ...r, id: Number(r.id) }));
    case 'hrt_timeline_periods':
      return (await query<Record<string, unknown>>(
        'SELECT uuid, name, started_at, ended_at, doses_e, doses_t_blocker, doses_other, notes FROM hrt_timeline_periods WHERE uuid = ANY($1::text[])', [uuids]))
        .map(r => ({
          ...r,
          started_at: toIso(r.started_at).slice(0, 10),
          ended_at: r.ended_at ? toIso(r.ended_at).slice(0, 10) : null,
          doses_other: Array.isArray(r.doses_other) ? r.doses_other : [],
        }));
    case 'lab_draws':
      return (await query<Record<string, unknown>>(
        'SELECT uuid, drawn_at, notes, source FROM lab_draws WHERE uuid = ANY($1::text[])', [uuids]))
        .map(r => ({
          ...r,
          drawn_at: toIso(r.drawn_at).slice(0, 10),
        }));
    case 'lab_results':
      return (await query<Record<string, unknown>>(
        'SELECT uuid, draw_uuid, lab_code, value FROM lab_results WHERE uuid = ANY($1::text[])', [uuids]))
        .map(r => ({ ...r, value: Number(r.value) }));
    case 'wellbeing_logs':
      return (await query<Record<string, unknown>>(
        'SELECT uuid, logged_at, mood, energy, sleep_hours, sleep_quality, stress, notes FROM wellbeing_logs WHERE uuid = ANY($1::text[])', [uuids]))
        .map(r => ({ ...r, logged_at: toIso(r.logged_at) }));
    case 'dysphoria_logs':
      return (await query<Record<string, unknown>>(
        'SELECT uuid, logged_at, scale, note FROM dysphoria_logs WHERE uuid = ANY($1::text[])', [uuids]))
        .map(r => ({ ...r, logged_at: toIso(r.logged_at) }));
    case 'clothes_test_logs':
      return (await query<Record<string, unknown>>(
        'SELECT uuid, logged_at, outfit_description, photo_url, comfort_rating, euphoria_rating, notes FROM clothes_test_logs WHERE uuid = ANY($1::text[])', [uuids]))
        .map(r => ({ ...r, logged_at: toIso(r.logged_at) }));
    case 'progress_photos':
      return (await query<Record<string, unknown>>(
        'SELECT uuid, blob_url, pose, notes, taken_at, crop_offset_y FROM progress_photos WHERE uuid = ANY($1::text[])', [uuids]))
        .map(r => ({ ...r, taken_at: toIso(r.taken_at) }));
    case 'exercise_image_candidates':
      return (await query<Record<string, unknown>>(
        `SELECT uuid, exercise_uuid, batch_id, frame_index, url, is_active, created_at
           FROM exercise_image_candidates WHERE uuid = ANY($1::text[])`, [uuids]))
        .map(r => ({
          uuid: String(r.uuid),
          exercise_uuid: String(r.exercise_uuid).toLowerCase(),
          batch_id: String(r.batch_id),
          frame_index: Number(r.frame_index),
          url: String(r.url),
          is_active: Boolean(r.is_active),
          created_at: toIso(r.created_at),
        }));
  }
}

// ─── Mappers (preserved from /api/sync/pull) ──────────────────────────────────

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function nullableNumber(v: unknown): number | null {
  return v == null ? null : Number(v);
}

function mapWorkout(r: Record<string, unknown>) {
  return {
    uuid: r.uuid,
    start_time: toIso(r.start_time),
    end_time: r.end_time ? toIso(r.end_time) : null,
    title: r.title ?? null,
    comment: r.comment ?? null,
    is_current: Boolean(r.is_current),
    workout_routine_uuid: r.workout_routine_uuid ?? null,
  };
}

function mapWorkoutExercise(r: Record<string, unknown>) {
  return {
    uuid: r.uuid,
    workout_uuid: r.workout_uuid,
    exercise_uuid: String(r.exercise_uuid).toLowerCase(),
    comment: r.comment ?? null,
    order_index: Number(r.order_index),
  };
}

function mapWorkoutSet(r: Record<string, unknown>) {
  return {
    uuid: r.uuid,
    workout_exercise_uuid: r.workout_exercise_uuid,
    weight: nullableNumber(r.weight),
    repetitions: nullableNumber(r.repetitions),
    min_target_reps: nullableNumber(r.min_target_reps),
    max_target_reps: nullableNumber(r.max_target_reps),
    rpe: nullableNumber(r.rpe),
    rir: nullableNumber(r.rir),
    tag: r.tag ?? null,
    comment: r.comment ?? null,
    is_completed: Boolean(r.is_completed),
    is_pr: Boolean(r.is_pr),
    excluded_from_pb: Boolean(r.excluded_from_pb),
    order_index: Number(r.order_index),
    duration_seconds: nullableNumber(r.duration_seconds),
  };
}

function mapBodyweightLog(r: Record<string, unknown>) {
  return {
    uuid: r.uuid,
    weight_kg: Number(r.weight_kg),
    logged_at: toIso(r.logged_at),
    note: r.note ?? null,
  };
}

function mapExercise(r: Record<string, unknown>) {
  const parseJsonOrArray = (v: unknown): unknown[] =>
    Array.isArray(v) ? v : JSON.parse((v as string) || '[]') || [];
  return {
    uuid: String(r.uuid).toLowerCase(),
    everkinetic_id: r.everkinetic_id as number,
    title: r.title as string,
    alias: parseJsonOrArray(r.alias) as string[],
    description: (r.description as string | null) ?? null,
    primary_muscles: parseJsonOrArray(r.primary_muscles) as string[],
    secondary_muscles: parseJsonOrArray(r.secondary_muscles) as string[],
    equipment: parseJsonOrArray(r.equipment) as string[],
    steps: parseJsonOrArray(r.steps) as string[],
    tips: parseJsonOrArray(r.tips) as string[],
    is_custom: Boolean(r.is_custom),
    is_hidden: Boolean(r.is_hidden),
    movement_pattern: (r.movement_pattern as string | null) ?? null,
    tracking_mode: (r.tracking_mode === 'time' ? 'time' : 'reps') as 'reps' | 'time',
    image_count: typeof r.image_count === 'number' ? r.image_count : 0,
    youtube_url: (r.youtube_url as string | null) ?? null,
    image_urls: Array.isArray(r.image_urls) ? r.image_urls as string[] : null,
    has_sides: Boolean(r.has_sides),
    lateral_emphasis: Boolean(r.lateral_emphasis),
    secondary_weights: parseSecondaryWeights(r.secondary_weights),
    weight_source: parseWeightSource(r.weight_source),
  };
}

/** Coerce JSONB secondary_weights to a Record<string, number> or null.
 *  Preserves empty `{}` as the audited-zero-secondary-credit signal — the
 *  legacy exercises (leg extension, calf raise, tricep pushdown) use it to
 *  mean "no secondary muscles credit at all." Collapsing to null would let
 *  the math fall back to 0.5 default and re-credit muscles the audit
 *  explicitly zeroed.
 *  Returns null only when the server value is genuinely null/missing OR
 *  the payload is not a flat number-valued object. */
function parseSecondaryWeights(v: unknown): Record<string, number> | null {
  if (v == null) return null;
  let obj: unknown = v;
  if (typeof v === 'string') {
    try { obj = JSON.parse(v); } catch { return null; }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 1) {
      out[k] = val;
    }
  }
  return out; // preserve empty object; only return null when source was null
}

function parseWeightSource(v: unknown): 'audited' | 'inferred' | 'default' | 'manual-override' | null {
  if (v === 'audited' || v === 'inferred' || v === 'default' || v === 'manual-override') return v;
  return null;
}

function mapInbodyScan(r: Record<string, unknown>) {
  // Pass through every column. Numeric coercion for stable typed reads on
  // the client; null preserved for missing values.
  const out: Record<string, unknown> = { uuid: r.uuid };
  for (const [k, v] of Object.entries(r)) {
    if (k === 'uuid') continue;
    if (k === 'scanned_at' || k === 'created_at' || k === 'updated_at') {
      out[k] = v ? toIso(v) : null;
    } else if (k === 'device' || k === 'venue' || k === 'notes') {
      out[k] = v ?? null;
    } else if (k === 'balance_upper' || k === 'balance_lower' || k === 'balance_upper_lower') {
      out[k] = v ?? null;
    } else if (k === 'impedance' || k === 'raw_json') {
      out[k] = v ?? {};
    } else if (k === 'inbody_score' || k === 'visceral_fat_level' || k === 'bmr_kcal' || k === 'age_at_scan') {
      out[k] = v == null ? null : Number(v);
    } else {
      out[k] = nullableNumber(v);
    }
  }
  return out;
}
