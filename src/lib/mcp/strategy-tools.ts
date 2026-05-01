/**
 * Rebirth MCP — strategy (Vision / Plan / Checkpoint) write tools.
 *
 * Lives in its own file (not mcp-tools.ts) for the same reason nutrition-tools
 * does: keeps the registry per-domain so each surface stays scrollable.
 *
 * Read tools (get_active_vision, get_active_plan, get_plan_progress) remain
 * in mcp-tools.ts — they predate this split. Write tools go here.
 *
 * Conventions (mirror mcp-tools.ts and mcp/nutrition-tools.ts):
 *   - Tool names: verb_noun (update_vision, update_plan, create_plan, log_plan_checkpoint).
 *   - Errors: { error: { code, message, hint? } } — every error names a next-step tool when applicable.
 *   - Whitelisted column updates: any field not in the editable set is a no-op (or rejected if obviously wrong).
 *   - Active-row enforcement: body_vision and body_plan each have a partial-unique index
 *     on status='active'. update_vision / update_plan upsert the active row by uuid;
 *     callers wanting to swap the active row should archive the existing one first.
 */

import { queryOne } from '@/db/db';
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

const VISION_STATUSES = new Set(['active', 'archived']);
const PLAN_STATUSES = new Set(['active', 'archived', 'superseded']);
const CHECKPOINT_STATUSES = new Set(['scheduled', 'completed']);
const CHECKPOINT_ASSESSMENTS = new Set(['on_track', 'ahead', 'behind', 'reset_required']);

function asStringArray(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}

function genUUID(): string {
  // crypto.randomUUID is available on the server (node 19+ and Vercel runtime).
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

// ─── update_vision ───────────────────────────────────────────────────────────

/**
 * Upsert the active body_vision row.
 *   - With `uuid`: targets that specific row (must exist).
 *   - Without `uuid`: looks up the active vision; if none exists, creates one
 *     (title required in that branch).
 *
 * Whitelisted fields: title, body_md, summary, principles, build_emphasis,
 * maintain_emphasis, deemphasize, status. Anything else is silently dropped.
 */
async function updateVision(args: Record<string, unknown>) {
  const uuid = typeof args.uuid === 'string' ? args.uuid : undefined;

  // Resolve the target row. If no uuid, find the active vision; if no active
  // vision exists, this branch creates a new one (title required).
  const target = uuid
    ? await queryOne<{ uuid: string }>(`SELECT uuid FROM body_vision WHERE uuid = $1`, [uuid])
    : await queryOne<{ uuid: string }>(`SELECT uuid FROM body_vision WHERE status = 'active' LIMIT 1`);

  if (uuid && !target) {
    return toolError('NOT_FOUND', `No body_vision with uuid ${uuid}.`, 'Call get_active_vision to find the current uuid.');
  }

  if (!target) {
    // Create branch — title required.
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) {
      return toolError(
        'INVALID_INPUT',
        'No active vision exists yet — title is required to create one.',
        'Pass { title, body_md?, summary?, principles?, build_emphasis?, maintain_emphasis?, deemphasize? } to create.',
      );
    }
    const newUuid = genUUID();
    const principles = asStringArray(args.principles) ?? [];
    const build_emphasis = asStringArray(args.build_emphasis) ?? [];
    const maintain_emphasis = asStringArray(args.maintain_emphasis) ?? [];
    const deemphasize = asStringArray(args.deemphasize) ?? [];
    const body_md = typeof args.body_md === 'string' ? args.body_md : null;
    const summary = typeof args.summary === 'string' ? args.summary : null;

    const row = await queryOne(
      `INSERT INTO body_vision (uuid, title, body_md, summary, principles,
                                build_emphasis, maintain_emphasis, deemphasize, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
       RETURNING *`,
      [newUuid, title, body_md, summary, principles, build_emphasis, maintain_emphasis, deemphasize],
    );
    return toolResult(row);
  }

  // Update branch — build SET clause from whitelisted fields actually present.
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let p = 0;
  const push = (col: string, val: unknown) => {
    setClauses.push(`${col} = $${++p}`);
    params.push(val);
  };

  if ('title' in args) {
    if (typeof args.title !== 'string' || !args.title.trim()) {
      return toolError('INVALID_INPUT', 'title must be a non-empty string.');
    }
    push('title', args.title.trim());
  }
  if ('body_md' in args) {
    push('body_md', args.body_md == null ? null : String(args.body_md));
  }
  if ('summary' in args) {
    push('summary', args.summary == null ? null : String(args.summary));
  }
  if ('principles' in args) {
    const arr = asStringArray(args.principles);
    if (arr === undefined) return toolError('INVALID_INPUT', 'principles must be an array of strings.');
    push('principles', arr);
  }
  if ('build_emphasis' in args) {
    const arr = asStringArray(args.build_emphasis);
    if (arr === undefined) return toolError('INVALID_INPUT', 'build_emphasis must be an array of strings.');
    push('build_emphasis', arr);
  }
  if ('maintain_emphasis' in args) {
    const arr = asStringArray(args.maintain_emphasis);
    if (arr === undefined) return toolError('INVALID_INPUT', 'maintain_emphasis must be an array of strings.');
    push('maintain_emphasis', arr);
  }
  if ('deemphasize' in args) {
    const arr = asStringArray(args.deemphasize);
    if (arr === undefined) return toolError('INVALID_INPUT', 'deemphasize must be an array of strings.');
    push('deemphasize', arr);
  }
  if ('status' in args) {
    if (typeof args.status !== 'string' || !VISION_STATUSES.has(args.status)) {
      return toolError('INVALID_INPUT', `status must be one of ${[...VISION_STATUSES].join(', ')}.`);
    }
    push('status', args.status);
    // If archiving, stamp archived_at unless caller passed one.
    if (args.status === 'archived' && !('archived_at' in args)) {
      push('archived_at', new Date().toISOString());
    }
  }
  if ('archived_at' in args) {
    push('archived_at', args.archived_at == null ? null : String(args.archived_at));
  }

  if (setClauses.length === 0) {
    return toolError(
      'INVALID_INPUT',
      'No editable fields provided.',
      'Pass any of: title, body_md, summary, principles, build_emphasis, maintain_emphasis, deemphasize, status.',
    );
  }

  setClauses.push(`updated_at = NOW()`);
  params.push(target.uuid);

  const row = await queryOne(
    `UPDATE body_vision SET ${setClauses.join(', ')} WHERE uuid = $${++p} RETURNING *`,
    params,
  );
  return toolResult(row);
}

// ─── update_plan ─────────────────────────────────────────────────────────────

/**
 * Update an existing body_plan row. Pass `uuid` to target a specific plan;
 * omit it to target the active plan. Editable fields whitelisted below.
 *
 * Note: this tool intentionally doesn't create a new plan — use create_plan
 * for that, since plan creation needs vision_id, start_date, target_date,
 * horizon_months which would make the schema awkward to share with update.
 */
async function updatePlan(args: Record<string, unknown>) {
  const uuid = typeof args.uuid === 'string' ? args.uuid : undefined;

  const target = uuid
    ? await queryOne<{ uuid: string }>(`SELECT uuid FROM body_plan WHERE uuid = $1`, [uuid])
    : await queryOne<{ uuid: string }>(`SELECT uuid FROM body_plan WHERE status = 'active' LIMIT 1`);

  if (uuid && !target) {
    return toolError('NOT_FOUND', `No body_plan with uuid ${uuid}.`, 'Call get_active_plan to find the current uuid.');
  }
  if (!target) {
    return toolError(
      'NOT_FOUND',
      'No active plan exists yet.',
      'Call create_plan to start a new training block (requires title, body_md, vision_id, start_date, target_date, horizon_months).',
    );
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  let p = 0;
  const push = (col: string, val: unknown) => {
    setClauses.push(`${col} = $${++p}`);
    params.push(val);
  };

  if ('title' in args) {
    if (typeof args.title !== 'string' || !args.title.trim()) {
      return toolError('INVALID_INPUT', 'title must be a non-empty string.');
    }
    push('title', args.title.trim());
  }
  if ('summary' in args) {
    push('summary', args.summary == null ? null : String(args.summary));
  }
  if ('body_md' in args) {
    push('body_md', args.body_md == null ? null : String(args.body_md));
  }
  if ('horizon_months' in args) {
    const n = Number(args.horizon_months);
    if (!Number.isFinite(n) || n <= 0) return toolError('INVALID_INPUT', 'horizon_months must be a positive number.');
    push('horizon_months', n);
  }
  if ('start_date' in args) {
    if (typeof args.start_date !== 'string' || !DATE_RE.test(args.start_date)) {
      return toolError('INVALID_INPUT', 'start_date must be YYYY-MM-DD.');
    }
    push('start_date', args.start_date);
  }
  if ('target_date' in args) {
    if (typeof args.target_date !== 'string' || !DATE_RE.test(args.target_date)) {
      return toolError('INVALID_INPUT', 'target_date must be YYYY-MM-DD.');
    }
    push('target_date', args.target_date);
  }
  if ('north_star_metrics' in args) {
    if (!Array.isArray(args.north_star_metrics)) {
      return toolError('INVALID_INPUT', 'north_star_metrics must be an array.');
    }
    push('north_star_metrics', JSON.stringify(args.north_star_metrics));
  }
  if ('programming_dose' in args) {
    if (typeof args.programming_dose !== 'object' || args.programming_dose == null) {
      return toolError('INVALID_INPUT', 'programming_dose must be an object.');
    }
    push('programming_dose', JSON.stringify(args.programming_dose));
  }
  if ('nutrition_anchors' in args) {
    if (typeof args.nutrition_anchors !== 'object' || args.nutrition_anchors == null) {
      return toolError('INVALID_INPUT', 'nutrition_anchors must be an object.');
    }
    push('nutrition_anchors', JSON.stringify(args.nutrition_anchors));
  }
  if ('reevaluation_triggers' in args) {
    const arr = asStringArray(args.reevaluation_triggers);
    if (arr === undefined) return toolError('INVALID_INPUT', 'reevaluation_triggers must be an array of strings.');
    push('reevaluation_triggers', arr);
  }
  if ('status' in args) {
    if (typeof args.status !== 'string' || !PLAN_STATUSES.has(args.status)) {
      return toolError('INVALID_INPUT', `status must be one of ${[...PLAN_STATUSES].join(', ')}.`);
    }
    push('status', args.status);
  }

  if (setClauses.length === 0) {
    return toolError(
      'INVALID_INPUT',
      'No editable fields provided.',
      'Pass any of: title, summary, body_md, horizon_months, start_date, target_date, north_star_metrics, programming_dose, nutrition_anchors, reevaluation_triggers, status.',
    );
  }

  setClauses.push(`updated_at = NOW()`);
  params.push(target.uuid);

  const row = await queryOne(
    `UPDATE body_plan SET ${setClauses.join(', ')} WHERE uuid = $${++p} RETURNING *`,
    params,
  );
  return toolResult(row);
}

// ─── create_plan ─────────────────────────────────────────────────────────────

/**
 * Create a new body_plan. Required: title, vision_id, start_date,
 * target_date, horizon_months. Defaults status='active' — caller should
 * archive the previous plan first (the partial-unique index on
 * status='active' will reject a second active plan).
 */
async function createPlan(args: Record<string, unknown>) {
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title) return toolError('INVALID_INPUT', 'title is required.');

  const vision_id = typeof args.vision_id === 'string' ? args.vision_id : undefined;
  if (!vision_id) {
    // Default to active vision if caller didn't pass one.
    const v = await queryOne<{ uuid: string }>(`SELECT uuid FROM body_vision WHERE status = 'active' LIMIT 1`);
    if (!v) return toolError('INVALID_INPUT', 'vision_id is required and no active vision exists.', 'Call update_vision first to create one.');
    args.vision_id = v.uuid;
  } else {
    const v = await queryOne<{ uuid: string }>(`SELECT uuid FROM body_vision WHERE uuid = $1`, [vision_id]);
    if (!v) return toolError('NOT_FOUND', `vision_id ${vision_id} does not exist.`);
  }

  const start_date = typeof args.start_date === 'string' && DATE_RE.test(args.start_date) ? args.start_date : undefined;
  if (!start_date) return toolError('INVALID_INPUT', 'start_date is required (YYYY-MM-DD).');

  const target_date = typeof args.target_date === 'string' && DATE_RE.test(args.target_date) ? args.target_date : undefined;
  if (!target_date) return toolError('INVALID_INPUT', 'target_date is required (YYYY-MM-DD).');
  if (target_date < start_date) return toolError('INVALID_INPUT', 'target_date must be on or after start_date.');

  const horizon_months = Number(args.horizon_months);
  if (!Number.isFinite(horizon_months) || horizon_months <= 0) {
    return toolError('INVALID_INPUT', 'horizon_months must be a positive number.');
  }

  const status = typeof args.status === 'string' && PLAN_STATUSES.has(args.status) ? args.status : 'active';

  // If creating an active plan, the partial-unique index will reject if one
  // already exists. Surface that as a friendlier error.
  if (status === 'active') {
    const existing = await queryOne<{ uuid: string; title: string }>(
      `SELECT uuid, title FROM body_plan WHERE status = 'active' LIMIT 1`,
    );
    if (existing) {
      return toolError(
        'CONFLICT',
        `An active plan already exists ("${existing.title}", uuid=${existing.uuid}).`,
        'Archive the existing plan first via update_plan({ uuid, status: "archived" }), then call create_plan again.',
      );
    }
  }

  const newUuid = genUUID();
  const body_md = typeof args.body_md === 'string' ? args.body_md : null;
  const summary = typeof args.summary === 'string' ? args.summary : null;
  const north_star_metrics = Array.isArray(args.north_star_metrics) ? args.north_star_metrics : [];
  const programming_dose = typeof args.programming_dose === 'object' && args.programming_dose != null ? args.programming_dose : {};
  const nutrition_anchors = typeof args.nutrition_anchors === 'object' && args.nutrition_anchors != null ? args.nutrition_anchors : {};
  const reevaluation_triggers = asStringArray(args.reevaluation_triggers) ?? [];

  const row = await queryOne(
    `INSERT INTO body_plan
       (uuid, vision_id, title, summary, body_md, horizon_months, start_date, target_date,
        north_star_metrics, programming_dose, nutrition_anchors, reevaluation_triggers, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13)
     RETURNING *`,
    [
      newUuid, args.vision_id, title, summary, body_md, horizon_months, start_date, target_date,
      JSON.stringify(north_star_metrics), JSON.stringify(programming_dose),
      JSON.stringify(nutrition_anchors), reevaluation_triggers, status,
    ],
  );
  return toolResult(row);
}

// ─── log_plan_checkpoint ─────────────────────────────────────────────────────

/**
 * Fill in (or update) a quarterly checkpoint record. Two modes:
 *   - With `uuid`: updates that specific checkpoint row (typically a stub
 *     auto-created at plan-create time). This is the common case.
 *   - With `plan_uuid` + `quarter_label` + `target_date`: creates a brand-new
 *     checkpoint (e.g. extending the plan window).
 *
 * Setting any of (review_date, metrics_snapshot, assessment, notes,
 * adjustments_made) is the typical "I did the review" call. status flips
 * to 'completed' implicitly when review_date is set, unless caller overrides.
 */
async function logPlanCheckpoint(args: Record<string, unknown>) {
  const uuid = typeof args.uuid === 'string' ? args.uuid : undefined;
  const plan_uuid = typeof args.plan_uuid === 'string' ? args.plan_uuid : undefined;

  // Resolve target row.
  let target: { uuid: string; plan_id: string } | null = null;
  if (uuid) {
    target = await queryOne<{ uuid: string; plan_id: string }>(
      `SELECT uuid, plan_id FROM plan_checkpoint WHERE uuid = $1`, [uuid],
    );
    if (!target) return toolError('NOT_FOUND', `No plan_checkpoint with uuid ${uuid}.`, 'Call get_active_plan to find checkpoint uuids.');
  }

  // Validate optional inputs up front.
  let assessment: string | null | undefined;
  if ('assessment' in args) {
    if (args.assessment == null) {
      assessment = null;
    } else if (typeof args.assessment === 'string' && CHECKPOINT_ASSESSMENTS.has(args.assessment)) {
      assessment = args.assessment;
    } else {
      return toolError('INVALID_INPUT', `assessment must be one of ${[...CHECKPOINT_ASSESSMENTS].join(', ')} (or null).`);
    }
  }
  let status: string | undefined;
  if ('status' in args) {
    if (typeof args.status !== 'string' || !CHECKPOINT_STATUSES.has(args.status)) {
      return toolError('INVALID_INPUT', `status must be one of ${[...CHECKPOINT_STATUSES].join(', ')}.`);
    }
    status = args.status;
  }
  let review_date: string | null | undefined;
  if ('review_date' in args) {
    if (args.review_date == null) {
      review_date = null;
    } else if (typeof args.review_date === 'string' && DATE_RE.test(args.review_date)) {
      review_date = args.review_date;
    } else {
      return toolError('INVALID_INPUT', 'review_date must be YYYY-MM-DD or null.');
    }
  }
  let body_md_arg: string | null | undefined;
  if ('body_md' in args) {
    body_md_arg = args.body_md == null ? null : String(args.body_md);
  }
  // body_md → notes column on plan_checkpoint (the schema has a `notes` text
  // column, no body_md). Accept either name from callers.
  if (body_md_arg !== undefined && !('notes' in args)) {
    args.notes = body_md_arg;
  }
  let metrics: unknown;
  if ('metrics' in args || 'metrics_snapshot' in args) {
    metrics = (args.metrics_snapshot ?? args.metrics) ?? null;
  }
  let adjustments: string[] | undefined;
  if ('adjustments_made' in args) {
    const arr = asStringArray(args.adjustments_made);
    if (arr === undefined) return toolError('INVALID_INPUT', 'adjustments_made must be an array of strings.');
    adjustments = arr;
  }

  // CREATE branch — caller passed plan_uuid + quarter_label + target_date instead of uuid.
  if (!target) {
    if (!plan_uuid) {
      return toolError('INVALID_INPUT', 'Either uuid (to update an existing checkpoint) or plan_uuid (to create a new one) is required.');
    }
    const plan = await queryOne<{ uuid: string }>(`SELECT uuid FROM body_plan WHERE uuid = $1`, [plan_uuid]);
    if (!plan) return toolError('NOT_FOUND', `No body_plan with uuid ${plan_uuid}.`);

    const quarter_label = typeof args.quarter_label === 'string' ? args.quarter_label.trim() : '';
    if (!quarter_label) return toolError('INVALID_INPUT', 'quarter_label is required when creating a checkpoint (e.g. "Q3 2026").');

    const checkpoint_target_date = typeof args.target_date === 'string' && DATE_RE.test(args.target_date) ? args.target_date : undefined;
    if (!checkpoint_target_date) return toolError('INVALID_INPUT', 'target_date is required (YYYY-MM-DD) when creating a checkpoint.');

    // Default to 'completed' when review_date set, otherwise scheduled.
    const finalStatus = status ?? (review_date ? 'completed' : 'scheduled');

    const newUuid = genUUID();
    const row = await queryOne(
      `INSERT INTO plan_checkpoint
         (uuid, plan_id, quarter_label, target_date, review_date, status,
          metrics_snapshot, assessment, notes, adjustments_made)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
       RETURNING *`,
      [
        newUuid, plan_uuid, quarter_label, checkpoint_target_date,
        review_date ?? null,
        finalStatus,
        metrics == null ? null : JSON.stringify(metrics),
        assessment ?? null,
        args.notes == null ? null : String(args.notes),
        adjustments ?? [],
      ],
    );
    return toolResult(row);
  }

  // UPDATE branch.
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let p = 0;
  const push = (col: string, val: unknown) => {
    setClauses.push(`${col} = $${++p}`);
    params.push(val);
  };

  if ('quarter_label' in args) {
    if (typeof args.quarter_label !== 'string' || !args.quarter_label.trim()) {
      return toolError('INVALID_INPUT', 'quarter_label must be a non-empty string.');
    }
    push('quarter_label', args.quarter_label.trim());
  }
  if ('target_date' in args) {
    if (typeof args.target_date !== 'string' || !DATE_RE.test(args.target_date)) {
      return toolError('INVALID_INPUT', 'target_date must be YYYY-MM-DD.');
    }
    push('target_date', args.target_date);
  }
  if (review_date !== undefined) push('review_date', review_date);
  if (assessment !== undefined) push('assessment', assessment);
  if ('notes' in args) push('notes', args.notes == null ? null : String(args.notes));
  if (metrics !== undefined) push('metrics_snapshot', metrics == null ? null : JSON.stringify(metrics));
  if (adjustments !== undefined) push('adjustments_made', adjustments);

  // Status: explicit wins; otherwise auto-flip to 'completed' if review_date set.
  if (status !== undefined) {
    push('status', status);
  } else if (review_date) {
    push('status', 'completed');
  }

  if (setClauses.length === 0) {
    return toolError(
      'INVALID_INPUT',
      'No editable fields provided.',
      'Pass any of: review_date, assessment, notes (body_md), metrics_snapshot, adjustments_made, status, quarter_label, target_date.',
    );
  }

  setClauses.push(`updated_at = NOW()`);
  params.push(target.uuid);

  const row = await queryOne(
    `UPDATE plan_checkpoint SET ${setClauses.join(', ')} WHERE uuid = $${++p} RETURNING *`,
    params,
  );
  return toolResult(row);
}

// ─── Tool registry ───────────────────────────────────────────────────────────

export const strategyWriteTools: MCPTool[] = [
  {
    name: 'update_vision',
    description:
      'Upsert the active body Vision (long-arc aesthetic concept). With `uuid`, targets that row; without uuid, targets the active vision (or creates one if none exists — title required in that branch). Whitelisted fields only: title, body_md, summary, principles, build_emphasis, maintain_emphasis, deemphasize, status. Use after get_active_vision so you have the current uuid.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'Optional — defaults to the active vision' },
        title: { type: 'string' },
        body_md: { type: 'string', description: 'Markdown long-form prose — the canonical content' },
        summary: { type: 'string', description: 'Short pull-quote for cards' },
        principles: { type: 'array', items: { type: 'string' } },
        build_emphasis: { type: 'array', items: { type: 'string' } },
        maintain_emphasis: { type: 'array', items: { type: 'string' } },
        deemphasize: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: ['active', 'archived'] },
      },
    },
    execute: updateVision,
  },
  {
    name: 'update_plan',
    description:
      'Update an existing body Plan. With `uuid`, targets that plan; without uuid, targets the active plan. Whitelisted fields: title, summary, body_md, horizon_months, start_date, target_date, north_star_metrics, programming_dose, nutrition_anchors, reevaluation_triggers, status. To create a brand-new plan, use create_plan instead.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'Optional — defaults to the active plan' },
        title: { type: 'string' },
        summary: { type: 'string' },
        body_md: { type: 'string', description: 'Markdown strategy prose' },
        horizon_months: { type: 'number' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        target_date: { type: 'string', description: 'YYYY-MM-DD' },
        north_star_metrics: {
          type: 'array',
          description: 'Array of { metric_key, baseline_value, baseline_date, target_value, target_date, reasoning }',
        },
        programming_dose: { type: 'object' },
        nutrition_anchors: { type: 'object' },
        reevaluation_triggers: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: ['active', 'archived', 'superseded'] },
      },
    },
    execute: updatePlan,
  },
  {
    name: 'create_plan',
    description:
      'Create a brand-new body Plan (e.g. starting a new training block). Requires title, start_date, target_date, horizon_months. vision_id defaults to the active vision. If creating with status=active and another active plan exists, returns CONFLICT — archive the old plan first via update_plan({ uuid, status: "archived" }).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        vision_id: { type: 'string', description: 'Optional — defaults to active vision' },
        summary: { type: 'string' },
        body_md: { type: 'string' },
        horizon_months: { type: 'number' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        target_date: { type: 'string', description: 'YYYY-MM-DD' },
        north_star_metrics: { type: 'array' },
        programming_dose: { type: 'object' },
        nutrition_anchors: { type: 'object' },
        reevaluation_triggers: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: ['active', 'archived', 'superseded'], description: 'Default active' },
      },
      required: ['title', 'start_date', 'target_date', 'horizon_months'],
    },
    execute: createPlan,
  },
  {
    name: 'log_plan_checkpoint',
    description:
      'Fill in (or create) a quarterly plan checkpoint. Two modes: pass `uuid` to update an existing stub (the common case — checkpoints are auto-stubbed at plan-create time), or pass `plan_uuid` + `quarter_label` + `target_date` to create a new one. Setting `review_date` flips status to "completed" automatically. `body_md` is accepted as an alias for `notes`.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'Existing checkpoint uuid (update mode)' },
        plan_uuid: { type: 'string', description: 'For create mode — required if uuid omitted' },
        quarter_label: { type: 'string', description: 'e.g. "Q3 2026" (required when creating)' },
        target_date: { type: 'string', description: 'YYYY-MM-DD — when this review is/was due' },
        review_date: { type: 'string', description: 'YYYY-MM-DD — when the review actually happened. Setting this flips status to completed.' },
        status: { type: 'string', enum: ['scheduled', 'completed'] },
        assessment: { type: 'string', enum: ['on_track', 'ahead', 'behind', 'reset_required'] },
        notes: { type: 'string', description: 'Free-form review write-up (markdown)' },
        body_md: { type: 'string', description: 'Alias for notes' },
        metrics_snapshot: { type: 'object', description: 'Snapshot of north-star metrics at review time' },
        adjustments_made: { type: 'array', items: { type: 'string' } },
      },
    },
    execute: logPlanCheckpoint,
  },
];
