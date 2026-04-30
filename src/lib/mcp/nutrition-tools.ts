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

import { query, queryOne } from '@/db/db';
import { searchOpenFoodFacts, searchUsdaFdc } from '@/lib/food-search-remote';
import { computeDayAdherence, computeStreak, DEFAULT_BANDS } from '@/lib/adherence';
import type { MacroBands } from '@/db/local';
import type { MCPTool } from '@/lib/mcp-tools';

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

  const layer1 = sources.has('local')
    ? await query<Record<string, unknown>>(
        `SELECT food_name, calories, protein_g, carbs_g, fat_g,
                last_logged_at, times_logged
         FROM nutrition_food_canonical
         WHERE canonical_name LIKE $1 || '%' ESCAPE '\\'
            OR canonical_name LIKE '%' || $1 || '%' ESCAPE '\\'
            OR canonical_name % $2
         ORDER BY (canonical_name LIKE $1 || '%' ESCAPE '\\') DESC,
                  times_logged DESC, last_logged_at DESC
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
    },
  });
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
];
