/**
 * Rebirth MCP — nutrition tools (additions).
 *
 * Why this file exists separately from `mcp-tools.ts`:
 * The original `tools` array is 2900+ lines. Adding 8 new tools to the same
 * spot would push it past 3500. New tools live here so future-Lewis only
 * scrolls one ~600-line file when extending the nutrition surface.
 *
 * Conventions (consistent with the rest of mcp-tools.ts):
 *   - Tool names: verb_noun, e.g. update_nutrition_log
 *   - Date params: 'YYYY-MM-DD' in user's local TZ. The agent computes
 *     relative dates ("yesterday") itself; tools never accept literal
 *     "yesterday".
 *   - Timestamps: ISO-8601 with TZ offset.
 *   - Errors: { error: { code, message, hint? } } — every error names the
 *     next tool to call when applicable.
 *
 * Auto-approval rule (referenced by approve_nutrition_day, list_nutrition_logs,
 * get_nutrition_summary descriptions):
 *   - DB stores only 'pending' | 'approved'.
 *   - "Logged" is derived in the application layer for past dates that are
 *     still 'pending'. The agent doesn't need to set this — it's free.
 *   - approve_nutrition_day flips a date to 'approved'. Today is the only
 *     day where the user is expected to actively approve.
 */

import { query, queryOne, transaction } from '@/db/db';
import { searchOpenFoodFacts, searchUsdaFdc } from '@/lib/food-search-remote';
import { computeDayAdherence, computeStreak, DEFAULT_BANDS } from '@/lib/adherence';
import type { MacroBands } from '@/db/local';
import type { MCPTool } from '@/lib/mcp-tools';

// ─── Shared day-of-week helpers (used by load_nutrition_plan + get_nutrition_plan) ──

const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DAY_NAME_MAP: Record<string, number> = {
  mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
};

function parseDayOfWeek(day: string | number): number {
  if (typeof day === 'number') return Math.max(0, Math.min(6, day - 1));
  const key = String(day).toLowerCase().slice(0, 3);
  return DAY_NAME_MAP[key] ?? 0;
}

// ─── Result helpers (mirror mcp-tools.ts) ────────────────────────────────────

function toolResult(content: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(content, null, 2) }] };
}

function toolError(code: string, message: string, hint?: string) {
  return {
    content: [
      { type: 'text', text: JSON.stringify({ error: { code, message, hint } }, null, 2) },
    ],
    isError: true,
  };
}

// ─── Shared validators ───────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'other']);
const LOG_STATUSES = new Set(['planned', 'deviation', 'added']);

function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

// ─── Whitelist for update_nutrition_log ─────────────────────────────────────

const UPDATE_LOG_FIELDS: Record<
  string,
  (v: unknown) => string | number | null | undefined
> = {
  meal_type: (v) =>
    v == null ? null : MEAL_TYPES.has(String(v)) ? String(v) : undefined,
  meal_name: (v) => (v == null ? null : String(v)),
  calories: num,
  protein_g: num,
  carbs_g: num,
  fat_g: num,
  notes: (v) => (v == null ? null : String(v)),
  status: (v) =>
    v == null ? null : LOG_STATUSES.has(String(v)) ? String(v) : undefined,
  logged_at: (v) => (v == null ? undefined : String(v)),
};

// ─── 1. list_nutrition_logs ──────────────────────────────────────────────────

async function listNutritionLogs(args: Record<string, unknown>) {
  const date = args.date;
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return toolError('INVALID_INPUT', 'date is required (YYYY-MM-DD format).');
  }

  const rows = await query(
    `SELECT uuid, logged_at, meal_type, meal_name, calories, protein_g, carbs_g, fat_g,
            notes, template_meal_id, status
     FROM nutrition_logs
     WHERE to_char(logged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = $1
        OR logged_at::date = $1::date
     ORDER BY logged_at ASC`,
    [date],
  );

  return toolResult({ date, logs: rows });
}

// ─── 2. update_nutrition_log ─────────────────────────────────────────────────

async function updateNutritionLog(args: Record<string, unknown>) {
  const uuid = args.uuid;
  if (typeof uuid !== 'string') {
    return toolError('INVALID_INPUT', 'uuid is required.');
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  let p = 0;

  for (const [field, validator] of Object.entries(UPDATE_LOG_FIELDS)) {
    if (!(field in args)) continue;
    const value = validator(args[field]);
    if (value === undefined) {
      return toolError('INVALID_INPUT', `Invalid value for ${field}.`);
    }
    setClauses.push(`${field} = $${++p}`);
    params.push(value);
  }

  if (setClauses.length === 0) {
    return toolError('INVALID_INPUT', 'No editable fields provided.', 'Pass any of: meal_type, meal_name, calories, protein_g, carbs_g, fat_g, notes, status, logged_at.');
  }

  setClauses.push(`updated_at = NOW()`);
  params.push(uuid);

  const row = await queryOne(
    `UPDATE nutrition_logs SET ${setClauses.join(', ')} WHERE uuid = $${++p} RETURNING *`,
    params,
  );

  if (!row) {
    return toolError(
      'NOT_FOUND',
      `No nutrition log with uuid ${uuid}.`,
      'Call list_nutrition_logs(date) first to get uuids.',
    );
  }

  return toolResult(row);
}

// ─── 3. delete_nutrition_log ─────────────────────────────────────────────────

async function deleteNutritionLog(args: Record<string, unknown>) {
  const uuid = args.uuid;
  if (typeof uuid !== 'string') {
    return toolError('INVALID_INPUT', 'uuid is required.');
  }

  const result = await query(
    `DELETE FROM nutrition_logs WHERE uuid = $1 RETURNING uuid`,
    [uuid],
  );

  if (result.length === 0) {
    return toolError(
      'NOT_FOUND',
      `No nutrition log with uuid ${uuid}.`,
      'Call list_nutrition_logs(date) first to get uuids.',
    );
  }

  return toolResult({ deleted: uuid });
}

// ─── 4. bulk_log_nutrition_meals ─────────────────────────────────────────────

async function bulkLogNutritionMeals(args: Record<string, unknown>) {
  const date = args.date;
  const meals = args.meals;

  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return toolError('INVALID_INPUT', 'date is required (YYYY-MM-DD format).');
  }
  if (!Array.isArray(meals) || meals.length === 0) {
    return toolError('INVALID_INPUT', 'meals must be a non-empty array.');
  }

  const results: Array<
    | { index: number; ok: true; uuid: string }
    | { index: number; ok: false; error: { code: string; message: string } }
  > = [];

  // Default logged_at to noon of the date for any meal without one.
  const baseTs = new Date(`${date}T12:00:00`).toISOString();

  for (let i = 0; i < meals.length; i++) {
    const m = meals[i] as Record<string, unknown>;
    if (m == null || typeof m !== 'object') {
      results.push({ index: i, ok: false, error: { code: 'INVALID_INPUT', message: 'meal must be an object' } });
      continue;
    }
    if (m.meal_type != null && !MEAL_TYPES.has(String(m.meal_type))) {
      results.push({ index: i, ok: false, error: { code: 'INVALID_INPUT', message: `meal_type must be one of ${[...MEAL_TYPES].join(', ')}` } });
      continue;
    }
    if (m.status != null && !LOG_STATUSES.has(String(m.status))) {
      results.push({ index: i, ok: false, error: { code: 'INVALID_INPUT', message: `status must be one of ${[...LOG_STATUSES].join(', ')}` } });
      continue;
    }

    try {
      const row = await queryOne<{ uuid: string }>(
        `INSERT INTO nutrition_logs
           (uuid, logged_at, meal_type, meal_name, calories, protein_g, carbs_g, fat_g,
            notes, template_meal_id, status)
         VALUES (gen_random_uuid(), COALESCE($1::timestamptz, $2::timestamptz),
                 $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING uuid`,
        [
          m.logged_at ?? null,
          baseTs,
          m.meal_type ?? null,
          m.meal_name ?? null,
          num(m.calories),
          num(m.protein_g),
          num(m.carbs_g),
          num(m.fat_g),
          m.notes ?? null,
          m.template_meal_id ?? null,
          m.status ?? null,
        ],
      );
      if (row) results.push({ index: i, ok: true, uuid: row.uuid });
    } catch (e) {
      results.push({
        index: i,
        ok: false,
        error: { code: 'DB_ERROR', message: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  return toolResult({ date, succeeded, total: meals.length, results });
}

// ─── 5. approve_nutrition_day ────────────────────────────────────────────────

async function approveNutritionDay(args: Record<string, unknown>) {
  const date = args.date;
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return toolError('INVALID_INPUT', 'date is required (YYYY-MM-DD format).');
  }

  const today = todayLocalISO();
  if (date > today) {
    return toolError(
      'BUSINESS_RULE',
      `Cannot approve future date ${date} (today is ${today}).`,
      'approve_nutrition_day only accepts today or past dates.',
    );
  }

  // Idempotent: already-approved → silent success with prior state echoed.
  const existing = await queryOne<{ approved_status: string; approved_at: string | null }>(
    `SELECT approved_status, approved_at FROM nutrition_day_notes WHERE date = $1`,
    [date],
  );
  if (existing?.approved_status === 'approved') {
    return toolResult({
      date,
      approved_status: 'approved',
      approved_at: existing.approved_at,
      already_approved: true,
    });
  }

  const row = await queryOne(
    `INSERT INTO nutrition_day_notes (uuid, date, approved_status, approved_at, updated_at)
     VALUES (gen_random_uuid(), $1, 'approved', NOW(), NOW())
     ON CONFLICT (date) DO UPDATE SET
       approved_status = 'approved',
       approved_at = NOW(),
       updated_at = NOW()
     RETURNING date, approved_status, approved_at`,
    [date],
  );

  return toolResult(row);
}

// ─── 6. search_nutrition_foods ───────────────────────────────────────────────

async function searchNutritionFoods(args: Record<string, unknown>) {
  const query_ = args.query;
  if (typeof query_ !== 'string' || query_.trim().length < 2) {
    return toolError('INVALID_INPUT', 'query is required (min 2 chars).');
  }
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
  const sources = Array.isArray(args.sources)
    ? new Set((args.sources as string[]).filter((s) => ['local', 'off', 'usda'].includes(s)))
    : new Set(['local', 'off', 'usda']);

  const rawQ = query_.trim();
  const safeQ = rawQ.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c);

  // DISTINCT ON (c.food_name): same fan-out guard as the HTTP route. One result
  // per canonical name; LATERAL sub-select picks the single most-recent
  // non-archived food row so uuid is deterministic.
  const layer1 = sources.has('local')
    ? await query<Record<string, unknown>>(
        `SELECT DISTINCT ON (c.food_name)
                c.food_name, c.calories, c.protein_g, c.carbs_g, c.fat_g,
                c.last_logged_at, c.times_logged,
                f.uuid AS uuid
         FROM nutrition_food_canonical c
         LEFT JOIN LATERAL (
           SELECT uuid
           FROM foods
           WHERE lower(name) = c.canonical_name
             AND archived_at IS NULL
           ORDER BY created_at DESC
           LIMIT 1
         ) f ON true
         WHERE c.canonical_name LIKE $1 || '%' ESCAPE '\\'
            OR c.canonical_name LIKE '%' || $1 || '%' ESCAPE '\\'
            OR similarity(c.canonical_name, $2) >= 0.22
         ORDER BY c.food_name,
                  (c.canonical_name LIKE $1 || '%' ESCAPE '\\') DESC,
                  c.times_logged DESC, c.last_logged_at DESC
         LIMIT $3`,
        [safeQ, rawQ.toLowerCase(), limit],
      )
    : [];

  const [layer2, layer3] = await Promise.all([
    sources.has('off') ? searchOpenFoodFacts(rawQ, 15).catch(() => []) : Promise.resolve([]),
    sources.has('usda') ? searchUsdaFdc(rawQ, 15).catch(() => []) : Promise.resolve([]),
  ]);

  return toolResult({
    query: rawQ,
    // uuid is null for foods not yet promoted; non-null when previously attached as ingredient
    layer1: layer1.map((r) => ({ source: 'local', ...r })),
    layer2,
    layer3,
  });
}

// ─── 7. get_nutrition_summary ────────────────────────────────────────────────

interface SummaryRow {
  date: string;
  calories: string | number | null;
  protein_g: string | number | null;
  carbs_g: string | number | null;
  fat_g: string | number | null;
  log_count: string | number;
  approved_status: string | null;
}

async function getNutritionSummary(args: Record<string, unknown>) {
  const start_date = args.start_date;
  const end_date = args.end_date;

  if (typeof start_date !== 'string' || !DATE_RE.test(start_date)) {
    return toolError('INVALID_INPUT', 'start_date is required (YYYY-MM-DD).');
  }
  if (typeof end_date !== 'string' || !DATE_RE.test(end_date)) {
    return toolError('INVALID_INPUT', 'end_date is required (YYYY-MM-DD).');
  }
  if (end_date < start_date) {
    return toolError('INVALID_INPUT', 'end_date must be >= start_date.');
  }

  const targetsRow = await queryOne<{
    calories: string | number | null;
    protein_g: string | number | null;
    carbs_g: string | number | null;
    fat_g: string | number | null;
    bands: MacroBands | null;
  }>(`SELECT calories, protein_g, carbs_g, fat_g, bands FROM nutrition_targets WHERE id = 1`);

  const targets = targetsRow
    ? {
        id: 1 as const,
        calories: num(targetsRow.calories),
        protein_g: num(targetsRow.protein_g),
        carbs_g: num(targetsRow.carbs_g),
        fat_g: num(targetsRow.fat_g),
        bands: targetsRow.bands,
        _synced: true as const,
        _updated_at: 0,
        _deleted: false as const,
      }
    : null;

  const bands = (targets?.bands ?? DEFAULT_BANDS) as MacroBands;

  const rows = await query<SummaryRow>(
    `WITH range AS (
       SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS d
     ),
     log_agg AS (
       SELECT logged_at::date AS d,
              SUM(calories) AS calories,
              SUM(protein_g) AS protein_g,
              SUM(carbs_g) AS carbs_g,
              SUM(fat_g) AS fat_g,
              COUNT(*) AS log_count
       FROM nutrition_logs
       WHERE logged_at::date BETWEEN $1::date AND $2::date
       GROUP BY 1
     )
     SELECT
       to_char(r.d, 'YYYY-MM-DD') AS date,
       la.calories, la.protein_g, la.carbs_g, la.fat_g,
       COALESCE(la.log_count, 0) AS log_count,
       nd.approved_status
     FROM range r
     LEFT JOIN log_agg la ON la.d = r.d
     LEFT JOIN nutrition_day_notes nd ON nd.date = to_char(r.d, 'YYYY-MM-DD')
     ORDER BY r.d ASC`,
    [start_date, end_date],
  );

  let approved = 0;
  let auto_logged = 0;
  let missed = 0;
  let in_band = 0;
  let denominator = 0;

  const days = rows.map((r) => {
    const macros = {
      calories: num(r.calories),
      protein_g: num(r.protein_g),
      carbs_g: num(r.carbs_g),
      fat_g: num(r.fat_g),
    };
    const hasData = Number(r.log_count) > 0;
    const adh = computeDayAdherence(macros, targets, bands);
    const status = r.approved_status === 'approved' ? 'approved' : 'pending';

    if (status === 'approved') approved++;
    else if (hasData) auto_logged++;
    else missed++;

    if (hasData && adh.target_count > 0) {
      denominator++;
      if (adh.in_band) in_band++;
    }

    return {
      date: r.date,
      ...macros,
      hit_count: adh.hit_count,
      target_count: adh.target_count,
      has_data: hasData,
      approved_status: status,
    };
  });

  // Streak from most-recent backwards.
  const streak = computeStreak(
    [...days].reverse().map((d) => ({
      adherence: { hit_count: d.hit_count, target_count: d.target_count, in_band: d.target_count > 0 && d.hit_count === d.target_count },
      has_data: d.has_data,
    })),
  );

  return toolResult({
    start_date,
    end_date,
    days,
    targets: targets
      ? {
          calories: targets.calories,
          protein_g: targets.protein_g,
          carbs_g: targets.carbs_g,
          fat_g: targets.fat_g,
          bands,
        }
      : null,
    derived: {
      adherence_pct: denominator > 0 ? Math.round((in_band / denominator) * 100) : null,
      streak_days: streak,
      approval_counts: { approved, auto_logged, missed },
    },
  });
}

// ─── 8. get_nutrition_rules ──────────────────────────────────────────────────
// (Pre-existing tools — moved out of mcp-tools.ts so the entire nutrition
// MCP surface lives in one file.)

// ─── Server-side food resolver (mirrors resolveExercise in mcp-tools.ts) ─────

type ResolvedFood = {
  uuid: string;
  name: string;
  per_unit: string;
  per_qty: number;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
};
type FoodError = { error: string };

async function resolveFood(args: { food_uuid?: string; food_name?: string }): Promise<ResolvedFood | FoodError> {
  const { food_uuid, food_name } = args;

  if (food_uuid) {
    // UUID lookup: include archived so existing ingredient rows can still resolve
    const row = await queryOne<ResolvedFood>(
      `SELECT uuid, name, per_unit, per_qty::float AS per_qty,
              calories::float AS calories, protein_g::float AS protein_g,
              carbs_g::float AS carbs_g, fat_g::float AS fat_g
       FROM foods WHERE uuid = $1`,
      [food_uuid],
    );
    if (!row) return { error: `Food not found: ${food_uuid}` };
    return row;
  }

  if (food_name) {
    // Name lookup: case-insensitive, non-archived only
    const row = await queryOne<ResolvedFood>(
      `SELECT uuid, name, per_unit, per_qty::float AS per_qty,
              calories::float AS calories, protein_g::float AS protein_g,
              carbs_g::float AS carbs_g, fat_g::float AS fat_g
       FROM foods
       WHERE lower(name) = lower($1) AND archived_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [food_name.trim()],
    );
    if (!row) return { error: `Food not found: "${food_name}"` };
    return row;
  }

  return { error: 'Provide food_uuid or food_name' };
}

function isFoodError(r: ResolvedFood | FoodError): r is FoodError {
  return 'error' in r;
}

// ─── Ingredients query helper ─────────────────────────────────────────────────

interface IngredientRow {
  uuid: string;
  food_uuid: string;
  food_name: string;
  amount: number;
  per_unit: string;
  per_qty: number;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  sort_order: number;
}

async function fetchIngredientsForMeals(mealUuids: string[]): Promise<Map<string, IngredientRow[]>> {
  if (mealUuids.length === 0) return new Map();

  // Build $1, $2, ... placeholders
  const placeholders = mealUuids.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await query<IngredientRow & { week_meal_uuid: string }>(
    `SELECT wmi.uuid, wmi.week_meal_uuid, wmi.food_uuid, f.name AS food_name,
            wmi.amount::float AS amount,
            f.per_unit, f.per_qty::float AS per_qty,
            (wmi.amount / NULLIF(f.per_qty, 0) * f.calories)::float AS calories,
            (wmi.amount / NULLIF(f.per_qty, 0) * f.protein_g)::float AS protein_g,
            (wmi.amount / NULLIF(f.per_qty, 0) * f.carbs_g)::float AS carbs_g,
            (wmi.amount / NULLIF(f.per_qty, 0) * f.fat_g)::float AS fat_g,
            wmi.sort_order
     FROM week_meal_ingredients wmi
     JOIN foods f ON f.uuid = wmi.food_uuid
     WHERE wmi.week_meal_uuid IN (${placeholders})
     ORDER BY wmi.week_meal_uuid, wmi.sort_order`,
    mealUuids,
  );

  const map = new Map<string, IngredientRow[]>();
  for (const r of rows) {
    const { week_meal_uuid, ...rest } = r;
    if (!map.has(week_meal_uuid)) map.set(week_meal_uuid, []);
    map.get(week_meal_uuid)!.push(rest);
  }
  return map;
}

// get_active_nutrition_plan
async function getActiveNutritionPlan() {
  const meals = await query<{
    uuid: string; day_of_week: number; meal_slot: string; meal_name: string;
    protein_g: number | null; carbs_g: number | null; fat_g: number | null;
    calories: number | null; quality_rating: number | null; sort_order: number;
    is_recipe: boolean;
  }>(`
    SELECT nwm.uuid, nwm.day_of_week, nwm.meal_slot, nwm.meal_name,
           e.calories::float AS calories, e.protein_g::float AS protein_g,
           e.carbs_g::float AS carbs_g, e.fat_g::float AS fat_g,
           nwm.quality_rating, nwm.sort_order, nwm.is_recipe
    FROM nutrition_week_meals nwm
    JOIN nutrition_week_meal_effective e ON e.uuid = nwm.uuid
    ORDER BY nwm.day_of_week, nwm.sort_order
  `);

  const ingredientsMap = await fetchIngredientsForMeals(meals.map(m => m.uuid));

  return toolResult(meals.map(m => ({
    ...m,
    ingredients: ingredientsMap.get(m.uuid) ?? [],
  })));
}

// get_nutrition_plan
async function getNutritionPlan(args: Record<string, unknown>) {
  const includeCompliance = args.include_compliance === true;

  const meals = await query<{
    uuid: string; day_of_week: number; meal_slot: string; meal_name: string;
    protein_g: number | null; carbs_g: number | null; fat_g: number | null;
    calories: number | null; quality_rating: number | null; sort_order: number;
    is_recipe: boolean;
  }>(`
    SELECT nwm.uuid, nwm.day_of_week, nwm.meal_slot, nwm.meal_name,
           e.calories::float AS calories, e.protein_g::float AS protein_g,
           e.carbs_g::float AS carbs_g, e.fat_g::float AS fat_g,
           nwm.quality_rating, nwm.sort_order, nwm.is_recipe
    FROM nutrition_week_meals nwm
    JOIN nutrition_week_meal_effective e ON e.uuid = nwm.uuid
    ORDER BY nwm.day_of_week, nwm.sort_order
  `);

  const ingredientsMap = await fetchIngredientsForMeals(meals.map(m => m.uuid));

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
        uuid: m.uuid,
        slot: m.meal_slot,
        description: m.meal_name,
        is_recipe: m.is_recipe,
        calories: m.calories,
        protein_g: m.protein_g,
        carbs_g: m.carbs_g,
        fat_g: m.fat_g,
        quality_rating: m.quality_rating,
        ingredients: ingredientsMap.get(m.uuid) ?? [],
      })),
    }));

  const targets = await queryOne<{
    calories: number | null; protein_g: number | null;
    carbs_g: number | null; fat_g: number | null;
  }>(`SELECT calories, protein_g, carbs_g, fat_g FROM nutrition_targets WHERE id = 1`);

  const result: Record<string, unknown> = { week_plan, targets: targets ?? null };

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

// load_nutrition_plan
async function loadNutritionPlan(args: Record<string, unknown>) {
  const { days, targets } = args as {
    days: Array<{
      day: string | number;
      meals: Array<{
        slot: string; description: string; calories?: number;
        protein_g?: number; carbs_g?: number; fat_g?: number;
        quality_rating?: number;
      }>;
    }>;
    targets?: { calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number };
  };

  const statements: Array<{ text: string; params?: unknown[] }> = [
    { text: 'DELETE FROM nutrition_week_meals' },
  ];

  const ALLOWED_WEEK_SLOTS = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
  const normalizeSlot = (raw: string): string => {
    const s = raw.toLowerCase().trim();
    if (ALLOWED_WEEK_SLOTS.has(s)) return s;
    if (s.includes('breakfast')) return 'breakfast';
    if (s.includes('lunch')) return 'lunch';
    if (s.includes('dinner')) return 'dinner';
    return 'snack';
  };

  let mealCount = 0;
  for (const d of days) {
    const dow = parseDayOfWeek(d.day as string | number);
    for (let i = 0; i < d.meals.length; i++) {
      const m = d.meals[i];
      statements.push({
        text: `INSERT INTO nutrition_week_meals
           (uuid, day_of_week, meal_slot, meal_name,
            protein_g, carbs_g, fat_g, calories, quality_rating, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        params: [
          crypto.randomUUID(), dow, normalizeSlot(m.slot), m.description,
          m.protein_g ?? null, m.carbs_g ?? null, m.fat_g ?? null,
          m.calories ?? null, m.quality_rating ?? null, i,
        ],
      });
      mealCount++;
    }
  }

  if (targets) {
    statements.push({
      text: `INSERT INTO nutrition_targets (id, calories, protein_g, carbs_g, fat_g, updated_at)
       VALUES (1, $1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET
         calories = EXCLUDED.calories,
         protein_g = EXCLUDED.protein_g,
         carbs_g = EXCLUDED.carbs_g,
         fat_g = EXCLUDED.fat_g,
         updated_at = NOW()`,
      params: [targets.calories ?? null, targets.protein_g ?? null, targets.carbs_g ?? null, targets.fat_g ?? null],
    });
  }

  await transaction(statements);

  return toolResult({
    success: true,
    meals_created: mealCount,
    weeks_loaded: days.length,
    targets_set: targets ? true : false,
  });
}

// add_week_meal — append a single meal to the standard-week template without
// touching anything else. Companion to load_nutrition_plan (full wipe-replace)
// and update_week_meal (partial edit by uuid).
async function addWeekMeal(args: Record<string, unknown>) {
  const ALLOWED_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

  if (args.day == null || (typeof args.day !== 'string' && typeof args.day !== 'number')) {
    return toolError('INVALID_INPUT', 'day is required (Mon/Tue/.../Sun or 1–7)');
  }
  if (typeof args.meal_slot !== 'string') {
    return toolError('INVALID_INPUT', 'meal_slot is required (breakfast | lunch | dinner | snack)');
  }
  const slot = args.meal_slot.toLowerCase().trim();
  if (!ALLOWED_SLOTS.includes(slot as typeof ALLOWED_SLOTS[number])) {
    return toolError('INVALID_INPUT', `meal_slot must be one of ${ALLOWED_SLOTS.join(' | ')}`);
  }
  if (typeof args.meal_name !== 'string' || args.meal_name.trim() === '') {
    return toolError('INVALID_INPUT', 'meal_name is required');
  }
  if (
    args.quality_rating != null &&
    (typeof args.quality_rating !== 'number' || args.quality_rating < 1 || args.quality_rating > 5)
  ) {
    return toolError('INVALID_INPUT', 'quality_rating must be 1–5');
  }

  const dow = parseDayOfWeek(args.day as string | number);

  let sortOrder: number;
  if (typeof args.sort_order === 'number') {
    sortOrder = args.sort_order;
  } else {
    const countRow = await queryOne<{ c: string | number }>(
      `SELECT COUNT(*)::int AS c FROM nutrition_week_meals WHERE day_of_week = $1`,
      [dow],
    );
    sortOrder = Number(countRow?.c ?? 0);
  }

  const row = await queryOne(
    `INSERT INTO nutrition_week_meals
       (uuid, day_of_week, meal_slot, meal_name,
        protein_g, carbs_g, fat_g, calories, quality_rating, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      crypto.randomUUID(),
      dow,
      slot,
      args.meal_name.trim(),
      args.protein_g ?? null,
      args.carbs_g ?? null,
      args.fat_g ?? null,
      args.calories ?? null,
      args.quality_rating ?? null,
      sortOrder,
    ],
  );

  return toolResult(row);
}

const LOG_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'other'] as const;
const LOG_MEAL_STATUSES = ['planned', 'deviation', 'added'] as const;

// log_nutrition_meal
async function logNutritionMeal(args: Record<string, unknown>) {
  const {
    meal_type = null, meal_name = null, calories, protein_g, carbs_g, fat_g,
    notes = null, template_meal_id = null, status = null, logged_at,
  } = args as {
    meal_type?: string | null; meal_name?: string | null;
    calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number;
    notes?: string | null; template_meal_id?: string | null;
    status?: string | null; logged_at?: string;
  };

  if (meal_type != null && !LOG_MEAL_TYPES.includes(meal_type as typeof LOG_MEAL_TYPES[number])) {
    return toolError('INVALID_INPUT', `meal_type must be one of ${LOG_MEAL_TYPES.join(', ')}`);
  }
  if (status != null && !LOG_MEAL_STATUSES.includes(status as typeof LOG_MEAL_STATUSES[number])) {
    return toolError('INVALID_INPUT', `status must be one of ${LOG_MEAL_STATUSES.join(', ')}`);
  }

  const row = await queryOne(
    `INSERT INTO nutrition_logs
       (uuid, logged_at, meal_type, meal_name, calories, protein_g, carbs_g, fat_g,
        notes, template_meal_id, status)
     VALUES ($1, COALESCE($2::timestamp, NOW()), $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      crypto.randomUUID(), logged_at ?? null, meal_type, meal_name,
      calories ?? null, protein_g ?? null, carbs_g ?? null, fat_g ?? null,
      notes, template_meal_id, status,
    ],
  );
  return toolResult(row);
}

// set_nutrition_day_notes
async function setNutritionDayNotes(args: Record<string, unknown>) {
  const { date, hydration_ml = null, notes = null } = args as {
    date?: string; hydration_ml?: number | null; notes?: string | null;
  };
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return toolError('INVALID_INPUT', 'date is required in YYYY-MM-DD format');
  }

  const row = await queryOne(
    `INSERT INTO nutrition_day_notes (uuid, date, hydration_ml, notes, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (date) DO UPDATE SET
       hydration_ml = COALESCE(EXCLUDED.hydration_ml, nutrition_day_notes.hydration_ml),
       notes = COALESCE(EXCLUDED.notes, nutrition_day_notes.notes),
       updated_at = NOW()
     RETURNING *`,
    [crypto.randomUUID(), date, hydration_ml, notes],
  );
  return toolResult(row);
}

// set_nutrition_targets
async function setNutritionTargetsTool(args: Record<string, unknown>) {
  const { calories = null, protein_g = null, carbs_g = null, fat_g = null } = args as {
    calories?: number | null; protein_g?: number | null;
    carbs_g?: number | null; fat_g?: number | null;
  };

  const row = await queryOne(
    `INSERT INTO nutrition_targets (id, calories, protein_g, carbs_g, fat_g, updated_at)
     VALUES (1, $1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET
       calories = EXCLUDED.calories,
       protein_g = EXCLUDED.protein_g,
       carbs_g = EXCLUDED.carbs_g,
       fat_g = EXCLUDED.fat_g,
       updated_at = NOW()
     RETURNING *`,
    [calories, protein_g, carbs_g, fat_g],
  );
  return toolResult(row);
}

// update_week_meal
async function updateWeekMeal(args: Record<string, unknown>) {
  const { uuid } = args;
  if (typeof uuid !== 'string') return toolError('INVALID_INPUT', 'uuid is required');

  const fields: string[] = [];
  const params: unknown[] = [];
  let p = 0;
  const pushField = (col: string, val: unknown) => {
    fields.push(`${col} = $${++p}`);
    params.push(val);
  };

  if (typeof args.meal_slot === 'string') {
    const slot = args.meal_slot.toLowerCase().trim();
    if (!['breakfast', 'lunch', 'dinner', 'snack'].includes(slot)) {
      return toolError('INVALID_INPUT', 'meal_slot must be one of breakfast | lunch | dinner | snack');
    }
    pushField('meal_slot', slot);
  }
  if (typeof args.meal_name === 'string') pushField('meal_name', args.meal_name);
  if (args.calories !== undefined) pushField('calories', args.calories ?? null);
  if (args.protein_g !== undefined) pushField('protein_g', args.protein_g ?? null);
  if (args.carbs_g !== undefined) pushField('carbs_g', args.carbs_g ?? null);
  if (args.fat_g !== undefined) pushField('fat_g', args.fat_g ?? null);
  if (args.quality_rating !== undefined) pushField('quality_rating', args.quality_rating ?? null);
  if (typeof args.sort_order === 'number') pushField('sort_order', args.sort_order);

  if (fields.length === 0) return toolError('INVALID_INPUT', 'No fields to update');

  params.push(uuid);
  const row = await queryOne(
    `UPDATE nutrition_week_meals SET ${fields.join(', ')} WHERE uuid = $${++p} RETURNING *`,
    params,
  );
  return row ? toolResult(row) : toolError('NOT_FOUND', 'Meal not found');
}

async function getNutritionRules() {
  return toolResult({
    auto_approval: {
      description:
        "Past days that are still 'pending' display as 'Logged' in the UI but stay 'pending' in the DB. " +
        "approve_nutrition_day flips a date to 'approved'. The DB only ever stores 'pending' | 'approved'.",
    },
    date_format: {
      description:
        "All `date` params are 'YYYY-MM-DD' in the user's local timezone. " +
        "All `*_at` params are ISO-8601 with TZ offset. " +
        "The agent must compute relative dates ('yesterday') itself; tools never accept 'yesterday' as a literal.",
    },
    default_bands: DEFAULT_BANDS,
    workflow: {
      log_food: 'search_nutrition_foods → log_nutrition_meal',
      edit_past_day: 'list_nutrition_logs(date) → update_nutrition_log(uuid, ...)',
      catch_up: 'bulk_log_nutrition_meals(date, [...meals])',
      compose_recipe_from_ingredients:
        'search_nutrition_foods (returns uuid) → set_meal_ingredients; or create_food for items not in search',
    },
  });
}

// ─── Ingredient write tools ───────────────────────────────────────────────────

// create_food — mint a foods row for later use as an ingredient
async function createFood(args: Record<string, unknown>) {
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (!name) return toolError('INVALID_INPUT', 'name is required');

  const perUnit = typeof args.per_unit === 'string' ? args.per_unit.trim() : 'serve';
  if (!['g', 'ml', 'serve'].includes(perUnit)) {
    return toolError('INVALID_INPUT', 'per_unit must be one of g | ml | serve');
  }
  const perQty = num(args.per_qty ?? 1);
  if (!perQty || perQty <= 0) {
    return toolError('INVALID_INPUT', 'per_qty must be a positive number');
  }

  for (const field of ['calories', 'protein_g', 'carbs_g', 'fat_g'] as const) {
    const v = num(args[field]);
    if (args[field] != null && (v === null || !Number.isFinite(v))) {
      return toolError('INVALID_INPUT', `${field} must be a finite number`);
    }
  }

  // Idempotent by lower(name) + source='manual'
  const existing = await queryOne<{ uuid: string }>(
    `SELECT uuid FROM foods WHERE lower(name) = lower($1) AND source = 'manual' AND archived_at IS NULL LIMIT 1`,
    [name],
  );
  if (existing) return toolResult({ uuid: existing.uuid, deduplicated: true });

  const row = await queryOne<{ uuid: string; name: string }>(
    `INSERT INTO foods (uuid, name, brand, per_unit, per_qty, calories, protein_g, carbs_g, fat_g, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual')
     RETURNING uuid, name`,
    [
      crypto.randomUUID(),
      name,
      args.brand ? String(args.brand).trim() : null,
      perUnit,
      perQty,
      num(args.calories) ?? null,
      num(args.protein_g) ?? null,
      num(args.carbs_g) ?? null,
      num(args.fat_g) ?? null,
    ],
  );
  return toolResult(row);
}

// convert_week_meal_to_recipe — idempotent flag-flip
async function convertWeekMealToRecipe(args: Record<string, unknown>) {
  const { week_meal_uuid } = args;
  if (typeof week_meal_uuid !== 'string') {
    return toolError('INVALID_INPUT', 'week_meal_uuid is required');
  }
  const row = await queryOne(
    `UPDATE nutrition_week_meals SET is_recipe = true WHERE uuid = $1 RETURNING uuid, is_recipe`,
    [week_meal_uuid],
  );
  if (!row) return toolError('NOT_FOUND', `Meal ${week_meal_uuid} not found`);
  return toolResult(row);
}

// set_meal_ingredients — bulk replace all ingredients for a meal
async function setMealIngredients(args: Record<string, unknown>) {
  const { week_meal_uuid } = args;
  if (typeof week_meal_uuid !== 'string') {
    return toolError('INVALID_INPUT', 'week_meal_uuid is required');
  }
  const ingredients = args.ingredients;
  if (!Array.isArray(ingredients)) {
    return toolError('INVALID_INPUT', 'ingredients must be an array');
  }

  // Resolve all foods first (fail fast before any writes)
  type ResolvedIngredient = { food: ResolvedFood; amount: number; sortOrder: number };
  const resolved: ResolvedIngredient[] = [];

  for (let i = 0; i < ingredients.length; i++) {
    const ing = ingredients[i] as Record<string, unknown>;
    if (!ing || typeof ing !== 'object') {
      return toolError('INVALID_INPUT', `ingredient[${i}] must be an object`);
    }

    const amount = num(ing.amount);
    if (!amount || amount <= 0) {
      return toolError('INVALID_INPUT', `ingredient[${i}].amount must be > 0`);
    }

    const foodResult = await resolveFood({
      food_uuid: ing.food_uuid ? String(ing.food_uuid) : undefined,
      food_name: ing.food_name ? String(ing.food_name) : undefined,
    });
    if (isFoodError(foodResult)) {
      return toolError(
        'FOOD_NOT_FOUND',
        `ingredient[${i}]: ${foodResult.error}`,
        'create the food first with create_food, or search_nutrition_foods',
      );
    }
    resolved.push({ food: foodResult, amount, sortOrder: i });
  }

  // Verify meal exists
  const meal = await queryOne<{ uuid: string }>(
    `SELECT uuid FROM nutrition_week_meals WHERE uuid = $1`,
    [week_meal_uuid],
  );
  if (!meal) return toolError('NOT_FOUND', `Meal ${week_meal_uuid} not found`);

  // Delete old ingredients, insert new set, set is_recipe=true — all in a transaction
  const statements: Array<{ text: string; params?: unknown[] }> = [
    { text: `DELETE FROM week_meal_ingredients WHERE week_meal_uuid = $1`, params: [week_meal_uuid] },
    { text: `UPDATE nutrition_week_meals SET is_recipe = true WHERE uuid = $1`, params: [week_meal_uuid] },
    ...resolved.map(({ food, amount, sortOrder }) => ({
      text: `INSERT INTO week_meal_ingredients (uuid, week_meal_uuid, food_uuid, amount, sort_order)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (week_meal_uuid, food_uuid) DO UPDATE SET amount = EXCLUDED.amount, sort_order = EXCLUDED.sort_order`,
      params: [crypto.randomUUID(), week_meal_uuid, food.uuid, amount, sortOrder],
    })),
  ];

  await transaction(statements);

  // Return the updated ingredients list
  const updatedIngredients = await fetchIngredientsForMeals([week_meal_uuid]);
  return toolResult({
    week_meal_uuid,
    is_recipe: true,
    ingredients: updatedIngredients.get(week_meal_uuid) ?? [],
  });
}

// add_meal_ingredient — upsert a single ingredient (never throws 23505)
async function addMealIngredient(args: Record<string, unknown>) {
  const { week_meal_uuid } = args;
  if (typeof week_meal_uuid !== 'string') {
    return toolError('INVALID_INPUT', 'week_meal_uuid is required');
  }

  const amount = num(args.amount);
  if (!amount || amount <= 0) {
    return toolError('INVALID_INPUT', 'amount must be > 0');
  }

  const foodResult = await resolveFood({
    food_uuid: args.food_uuid ? String(args.food_uuid) : undefined,
    food_name: args.food_name ? String(args.food_name) : undefined,
  });
  if (isFoodError(foodResult)) {
    return toolError(
      'FOOD_NOT_FOUND',
      foodResult.error,
      'create the food first with create_food, or search_nutrition_foods',
    );
  }

  // Verify meal exists
  const meal = await queryOne<{ uuid: string }>(
    `SELECT uuid FROM nutrition_week_meals WHERE uuid = $1`,
    [week_meal_uuid],
  );
  if (!meal) return toolError('NOT_FOUND', `Meal ${week_meal_uuid} not found`);

  // Get the next sort_order
  const countRow = await queryOne<{ c: string | number }>(
    `SELECT COUNT(*)::int AS c FROM week_meal_ingredients WHERE week_meal_uuid = $1`,
    [week_meal_uuid],
  );
  const sortOrder = Number(countRow?.c ?? 0);

  // Upsert — never 23505
  await transaction([
    {
      text: `INSERT INTO week_meal_ingredients (uuid, week_meal_uuid, food_uuid, amount, sort_order)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (week_meal_uuid, food_uuid) DO UPDATE SET amount = EXCLUDED.amount`,
      params: [crypto.randomUUID(), week_meal_uuid, foodResult.uuid, amount, sortOrder],
    },
    {
      text: `UPDATE nutrition_week_meals SET is_recipe = true WHERE uuid = $1`,
      params: [week_meal_uuid],
    },
  ]);

  const updatedIngredients = await fetchIngredientsForMeals([week_meal_uuid]);
  return toolResult({
    week_meal_uuid,
    is_recipe: true,
    ingredients: updatedIngredients.get(week_meal_uuid) ?? [],
  });
}

// update_meal_ingredient
async function updateMealIngredient(args: Record<string, unknown>) {
  const { ingredient_uuid } = args;
  if (typeof ingredient_uuid !== 'string') {
    return toolError('INVALID_INPUT', 'ingredient_uuid is required');
  }

  const amount = num(args.amount);
  if (!amount || amount <= 0) {
    return toolError('INVALID_INPUT', 'amount must be > 0');
  }

  const row = await queryOne<{ uuid: string; week_meal_uuid: string }>(
    `UPDATE week_meal_ingredients SET amount = $1 WHERE uuid = $2 RETURNING uuid, week_meal_uuid`,
    [amount, ingredient_uuid],
  );
  if (!row) return toolError('NOT_FOUND', `Ingredient ${ingredient_uuid} not found`);

  const updatedIngredients = await fetchIngredientsForMeals([row.week_meal_uuid]);
  return toolResult({
    ingredient_uuid,
    week_meal_uuid: row.week_meal_uuid,
    ingredients: updatedIngredients.get(row.week_meal_uuid) ?? [],
  });
}

// remove_meal_ingredient
async function removeMealIngredient(args: Record<string, unknown>) {
  const { ingredient_uuid } = args;
  if (typeof ingredient_uuid !== 'string') {
    return toolError('INVALID_INPUT', 'ingredient_uuid is required');
  }

  const row = await queryOne<{ uuid: string; week_meal_uuid: string }>(
    `DELETE FROM week_meal_ingredients WHERE uuid = $1 RETURNING uuid, week_meal_uuid`,
    [ingredient_uuid],
  );
  if (!row) return toolError('NOT_FOUND', `Ingredient ${ingredient_uuid} not found`);

  return toolResult({ deleted: ingredient_uuid, week_meal_uuid: row.week_meal_uuid });
}

// ─── Tool registry export ────────────────────────────────────────────────────

export const nutritionTools: MCPTool[] = [
  {
    name: 'list_nutrition_logs',
    description:
      'Lists every nutrition log for a given date (YYYY-MM-DD). Required prerequisite for update_nutrition_log and delete_nutrition_log — you need a uuid before you can edit or remove. Past days that are still pending in the DB display as "Logged" in the UI; this tool returns the raw approved_status from the DB.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD in user local timezone' },
      },
      required: ['date'],
    },
    execute: listNutritionLogs,
  },
  {
    name: 'update_nutrition_log',
    description:
      'Updates one nutrition log row by uuid. Pass uuid plus any fields to change (named params, not a fields blob). Server-side whitelist rejects any field not in the editable set. Get uuids via list_nutrition_logs(date) first.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        meal_type: { type: 'string', description: 'breakfast | lunch | dinner | snack | other' },
        meal_name: { type: 'string' },
        calories: { type: 'number' },
        protein_g: { type: 'number' },
        carbs_g: { type: 'number' },
        fat_g: { type: 'number' },
        notes: { type: 'string' },
        status: { type: 'string', description: 'planned | deviation | added' },
        logged_at: { type: 'string', description: 'ISO-8601 timestamp with timezone' },
      },
      required: ['uuid'],
    },
    execute: updateNutritionLog,
  },
  {
    name: 'delete_nutrition_log',
    description: 'Deletes one nutrition log row by uuid. Get uuids via list_nutrition_logs(date) first.',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' } },
      required: ['uuid'],
    },
    execute: deleteNutritionLog,
  },
  {
    name: 'bulk_log_nutrition_meals',
    description:
      'Logs multiple meals for a date in one call (catch-up logging). Each meal accepts the same shape as log_nutrition_meal (minus logged_at, which defaults to noon of the given date). Returns per-item results; partial failures do not abort the batch.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD in user local timezone' },
        meals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              meal_type: { type: 'string', description: 'breakfast | lunch | dinner | snack | other' },
              meal_name: { type: 'string' },
              calories: { type: 'number' },
              protein_g: { type: 'number' },
              carbs_g: { type: 'number' },
              fat_g: { type: 'number' },
              notes: { type: 'string' },
              status: { type: 'string', description: 'planned | deviation | added' },
              template_meal_id: { type: 'string' },
              logged_at: { type: 'string', description: 'ISO-8601 (overrides default noon-of-date)' },
            },
          },
        },
      },
      required: ['date', 'meals'],
    },
    execute: bulkLogNutritionMeals,
  },
  {
    name: 'approve_nutrition_day',
    description:
      "Marks a date as approved (status = 'approved'). Idempotent — calling on an already-approved day returns silent success. Future dates rejected with BUSINESS_RULE error. Past days that are still 'pending' display as 'Logged' in the UI; this tool flips them to 'Reviewed'.",
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['date'],
    },
    execute: approveNutritionDay,
  },
  {
    name: 'search_nutrition_foods',
    description:
      'Three-layer food search: (1) local nutrition_food_entries (foods you have logged before), (2) Open Food Facts (branded products), (3) USDA FoodData Central (raw ingredients). Optional `sources` filter to restrict to a subset. Use this before log_nutrition_meal to find macros for a food.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term, min 2 chars' },
        limit: { type: 'number', description: 'Default 20, max 50' },
        sources: {
          type: 'array',
          items: { type: 'string', enum: ['local', 'off', 'usda'] },
          description: 'Restrict to a subset of layers',
        },
      },
      required: ['query'],
    },
    execute: searchNutritionFoods,
  },
  {
    name: 'get_nutrition_summary',
    description:
      'Aggregate adherence + approval stats over a date range. Returns per-day totals, hit-count vs targets, in-band classification, current streak, and approval counts. Adherence is computed against current targets; days with no data are excluded from the denominator.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD (inclusive)' },
        end_date: { type: 'string', description: 'YYYY-MM-DD (inclusive)' },
      },
      required: ['start_date', 'end_date'],
    },
    execute: getNutritionSummary,
  },
  {
    name: 'get_nutrition_rules',
    description:
      'Returns the implicit rules that govern the nutrition surface: auto-approval semantics, date/timezone conventions, default adherence bands, and recommended tool workflows. Call this once when first interacting with nutrition tools.',
    inputSchema: { type: 'object', properties: {} },
    execute: getNutritionRules,
  },

  // ─── Pre-existing tools (relocated from mcp-tools.ts) ──────────────────────

  {
    name: 'get_active_nutrition_plan',
    description: 'Returns the current standard-week meal plan template.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => getActiveNutritionPlan(),
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
    execute: getNutritionPlan,
  },
  {
    name: 'load_nutrition_plan',
    description: 'Replaces the entire standard-week meal template with a new plan. Accepts days with nested meals and optional daily macro targets.',
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
                    carbs_g: { type: 'number' },
                    fat_g: { type: 'number' },
                    quality_rating: { type: 'number', description: '1–5 quality rating' },
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
          description: 'Daily macro targets (upserts the singleton nutrition_targets row).',
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
    execute: loadNutritionPlan,
  },
  {
    name: 'add_week_meal',
    description:
      'Appends a single meal to the standard-week template without touching anything else. Use this when adding one meal — load_nutrition_plan wipes the whole template, update_week_meal only edits existing rows. day accepts Mon/Tue/.../Sun or 1–7. sort_order defaults to the next slot at the end of that day.',
    inputSchema: {
      type: 'object',
      properties: {
        day: { type: ['string', 'number'], description: 'Day name (Mon/Tue/Wed/Thu/Fri/Sat/Sun) or number (1=Mon … 7=Sun)' },
        meal_slot: { type: 'string', description: 'breakfast | lunch | dinner | snack' },
        meal_name: { type: 'string', description: 'Meal name/description' },
        calories: { type: 'number' },
        protein_g: { type: 'number' },
        carbs_g: { type: 'number' },
        fat_g: { type: 'number' },
        quality_rating: { type: 'number', description: '1–5 quality rating' },
        sort_order: { type: 'number', description: 'Optional; defaults to end of day' },
      },
      required: ['day', 'meal_slot', 'meal_name'],
    },
    execute: addWeekMeal,
  },
  {
    name: 'update_week_meal',
    description: "Partially updates a single meal in the standard-week template by uuid. Only provided fields are changed.",
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'UUID of the nutrition_week_meals row' },
        meal_slot: { type: 'string', description: 'breakfast | lunch | dinner | snack' },
        meal_name: { type: 'string' },
        calories: { type: 'number' },
        protein_g: { type: 'number' },
        carbs_g: { type: 'number' },
        fat_g: { type: 'number' },
        quality_rating: { type: 'number', description: '1–5' },
        sort_order: { type: 'number' },
      },
      required: ['uuid'],
    },
    execute: updateWeekMeal,
  },
  {
    name: 'log_nutrition_meal',
    description: 'Logs an actual eaten meal to nutrition_logs (compliance + deviation tracking). meal_type one of breakfast|lunch|dinner|snack|other; status one of planned|deviation|added.',
    inputSchema: {
      type: 'object',
      properties: {
        meal_type: { type: 'string', description: 'breakfast | lunch | dinner | snack | other' },
        meal_name: { type: 'string' },
        calories: { type: 'number' },
        protein_g: { type: 'number' },
        carbs_g: { type: 'number' },
        fat_g: { type: 'number' },
        notes: { type: 'string' },
        template_meal_id: { type: 'string', description: 'UUID of the nutrition_week_meals row this log came from' },
        status: { type: 'string', description: 'planned | deviation | added' },
        logged_at: { type: 'string', description: 'ISO timestamp (defaults to now)' },
      },
    },
    execute: logNutritionMeal,
  },
  {
    name: 'set_nutrition_day_notes',
    description: 'Upserts hydration and free-text notes for a specific calendar day (YYYY-MM-DD). Omitted fields preserve existing values.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        hydration_ml: { type: 'number' },
        notes: { type: 'string' },
      },
      required: ['date'],
    },
    execute: setNutritionDayNotes,
  },
  {
    name: 'set_nutrition_targets',
    description: 'Replaces the singleton daily-macro-targets row. Omitted fields are set to null — always pass the full set (calories, protein_g, carbs_g, fat_g) if you want all four tracked.',
    inputSchema: {
      type: 'object',
      properties: {
        calories: { type: 'number' },
        protein_g: { type: 'number' },
        carbs_g: { type: 'number' },
        fat_g: { type: 'number' },
      },
    },
    execute: setNutritionTargetsTool,
  },

  // ─── Ingredient / recipe tools ────────────────────────────────────────────

  {
    name: 'create_food',
    description:
      'Mints a new food in the foods table (source=manual). Use for foods not found in search_nutrition_foods. ' +
      'Idempotent by lower(name): if a manual food with the same name already exists (non-archived), returns its uuid with deduplicated=true. ' +
      'Returns the food uuid for use in set_meal_ingredients / add_meal_ingredient.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Food name (deduplicated by lower-case match)' },
        per_unit: { type: 'string', description: 'g | ml | serve (default: serve)' },
        per_qty: { type: 'number', description: 'How many units the macros are per (default: 1). E.g. 100 for per_unit=g means macros are per 100g.' },
        calories: { type: 'number' },
        protein_g: { type: 'number' },
        carbs_g: { type: 'number' },
        fat_g: { type: 'number' },
        brand: { type: 'string' },
      },
      required: ['name'],
    },
    execute: createFood,
  },
  {
    name: 'convert_week_meal_to_recipe',
    description:
      'Marks a standard-week meal as a recipe (is_recipe=true). Idempotent. ' +
      'Once flagged, the meal\'s macros are derived from its ingredients (via nutrition_week_meal_effective) instead of stored flat values. ' +
      'Call this before adding ingredients if you want the UI to show derived macros immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        week_meal_uuid: { type: 'string', description: 'UUID of the nutrition_week_meals row' },
      },
      required: ['week_meal_uuid'],
    },
    execute: convertWeekMealToRecipe,
  },
  {
    name: 'set_meal_ingredients',
    description:
      'Bulk-replaces all ingredients for a standard-week meal and sets is_recipe=true. ' +
      'The agent-friendly tool: call search_nutrition_foods first to get food uuids; pass food_uuid or food_name per ingredient. ' +
      'If a food_name has no match, returns FOOD_NOT_FOUND with hint to call create_food. ' +
      'Replaces the full ingredient set — to add/edit one ingredient without touching others, use add_meal_ingredient or update_meal_ingredient instead.',
    inputSchema: {
      type: 'object',
      properties: {
        week_meal_uuid: { type: 'string', description: 'UUID of the nutrition_week_meals row' },
        ingredients: {
          type: 'array',
          description: 'Ordered list of ingredients (sort_order = array index)',
          items: {
            type: 'object',
            properties: {
              food_uuid: { type: 'string', description: 'Preferred: use uuid from search_nutrition_foods or create_food' },
              food_name: { type: 'string', description: 'Alternative: case-insensitive name lookup (requires prior create_food if not in search)' },
              amount: { type: 'number', description: 'Amount in the food\'s per_unit (grams if per_unit=g, etc.)' },
            },
            required: ['amount'],
          },
        },
      },
      required: ['week_meal_uuid', 'ingredients'],
    },
    execute: setMealIngredients,
  },
  {
    name: 'add_meal_ingredient',
    description:
      'Adds or updates a single ingredient in a standard-week meal. Sets is_recipe=true on the parent meal. ' +
      'If the same food is already an ingredient, updates its amount (no duplicate error). ' +
      'Pass food_uuid (preferred — from search_nutrition_foods) or food_name (case-insensitive lookup).',
    inputSchema: {
      type: 'object',
      properties: {
        week_meal_uuid: { type: 'string', description: 'UUID of the nutrition_week_meals row' },
        food_uuid: { type: 'string', description: 'Preferred: food uuid from search_nutrition_foods or create_food' },
        food_name: { type: 'string', description: 'Alternative: case-insensitive name lookup' },
        amount: { type: 'number', description: 'Amount in the food\'s per_unit' },
      },
      required: ['week_meal_uuid', 'amount'],
    },
    execute: addMealIngredient,
  },
  {
    name: 'update_meal_ingredient',
    description: 'Updates the amount on a single week_meal_ingredients row. Get ingredient_uuid from get_nutrition_plan or get_active_nutrition_plan.',
    inputSchema: {
      type: 'object',
      properties: {
        ingredient_uuid: { type: 'string', description: 'UUID of the week_meal_ingredients row' },
        amount: { type: 'number', description: 'New amount in the food\'s per_unit' },
      },
      required: ['ingredient_uuid', 'amount'],
    },
    execute: updateMealIngredient,
  },
  {
    name: 'remove_meal_ingredient',
    description: 'Removes a single ingredient from a week meal. Get ingredient_uuid from get_nutrition_plan or get_active_nutrition_plan.',
    inputSchema: {
      type: 'object',
      properties: {
        ingredient_uuid: { type: 'string', description: 'UUID of the week_meal_ingredients row' },
      },
      required: ['ingredient_uuid'],
    },
    execute: removeMealIngredient,
  },
];
