'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { uuid as genUUID } from '@/lib/uuid';
import type {
  LocalBodyVision,
  LocalBodyPlan,
  LocalPlanCheckpoint,
  NorthStarMetric,
  ProgrammingDose,
  NutritionAnchors,
} from '@/db/local';

// Mutations for the Strategy page surface:
// - body_vision (the active aesthetic concept; one row at a time)
// - body_plan (the active time-bound strategy; one row at a time)
// - plan_checkpoint (quarterly review stubs filled in over time)
//
// Pattern matches src/lib/mutations-nutrition.ts: write Dexie → flag dirty →
// schedulePush. The sync engine's push handler in src/app/api/sync/push/route.ts
// already speaks INSERT…ON CONFLICT DO UPDATE for these tables, so updates
// flow through identically to inserts.

function now() { return Date.now(); }
function syncMeta() {
  return { _synced: false as const, _updated_at: now(), _deleted: false as const };
}

// ─── Vision ──────────────────────────────────────────────────────────────────

/** Update or upsert the active body_vision row. Pass an existing uuid to
 *  target a specific vision; omit it to update the currently-active one (or
 *  create a new active vision when none exists). */
export async function upsertVision(opts: {
  uuid?: string;
  title?: string;
  body_md?: string | null;
  summary?: string | null;
  principles?: string[];
  build_emphasis?: string[];
  maintain_emphasis?: string[];
  deemphasize?: string[];
  status?: 'active' | 'archived';
  archived_at?: string | null;
}): Promise<string> {
  // Resolve target row.
  let existing: LocalBodyVision | undefined;
  if (opts.uuid) {
    existing = await db.body_vision.get(opts.uuid);
  } else {
    const all = await db.body_vision.filter(v => !v._deleted && v.status === 'active').toArray();
    existing = all[0];
  }

  if (existing) {
    const patch: Partial<LocalBodyVision> = { ...syncMeta() };
    if (opts.title !== undefined) patch.title = opts.title.trim();
    if (opts.body_md !== undefined) patch.body_md = opts.body_md;
    if (opts.summary !== undefined) patch.summary = opts.summary;
    if (opts.principles !== undefined) patch.principles = opts.principles;
    if (opts.build_emphasis !== undefined) patch.build_emphasis = opts.build_emphasis;
    if (opts.maintain_emphasis !== undefined) patch.maintain_emphasis = opts.maintain_emphasis;
    if (opts.deemphasize !== undefined) patch.deemphasize = opts.deemphasize;
    if (opts.status !== undefined) {
      patch.status = opts.status;
      if (opts.status === 'archived' && opts.archived_at === undefined && !existing.archived_at) {
        patch.archived_at = new Date().toISOString();
      }
    }
    if (opts.archived_at !== undefined) patch.archived_at = opts.archived_at;
    await db.body_vision.update(existing.uuid, patch);
    syncEngine.schedulePush();
    return existing.uuid;
  }

  // Create branch — title required.
  if (!opts.title || !opts.title.trim()) {
    throw new Error('upsertVision: title is required to create a new vision');
  }
  const id = opts.uuid ?? genUUID();
  const row: LocalBodyVision = {
    uuid: id,
    title: opts.title.trim(),
    body_md: opts.body_md ?? null,
    summary: opts.summary ?? null,
    principles: opts.principles ?? [],
    build_emphasis: opts.build_emphasis ?? [],
    maintain_emphasis: opts.maintain_emphasis ?? [],
    deemphasize: opts.deemphasize ?? [],
    status: opts.status ?? 'active',
    archived_at: opts.archived_at ?? null,
    ...syncMeta(),
  };
  await db.body_vision.put(row);
  syncEngine.schedulePush();
  return id;
}

// ─── Plan ────────────────────────────────────────────────────────────────────

/** Update an existing body_plan row by uuid (or the active plan if uuid is
 *  omitted). Use `createPlan` to start a new plan from scratch. */
export async function updatePlan(opts: {
  uuid?: string;
  title?: string;
  summary?: string | null;
  body_md?: string | null;
  horizon_months?: number;
  start_date?: string;
  target_date?: string;
  north_star_metrics?: NorthStarMetric[];
  programming_dose?: ProgrammingDose;
  nutrition_anchors?: NutritionAnchors;
  reevaluation_triggers?: string[];
  status?: 'active' | 'archived' | 'superseded';
}): Promise<string> {
  let existing: LocalBodyPlan | undefined;
  if (opts.uuid) {
    existing = await db.body_plan.get(opts.uuid);
  } else {
    const all = await db.body_plan.filter(p => !p._deleted && p.status === 'active').toArray();
    existing = all[0];
  }
  if (!existing) {
    throw new Error('updatePlan: target plan not found (no uuid + no active plan)');
  }

  const patch: Partial<LocalBodyPlan> = { ...syncMeta() };
  if (opts.title !== undefined) patch.title = opts.title.trim();
  if (opts.summary !== undefined) patch.summary = opts.summary;
  if (opts.body_md !== undefined) patch.body_md = opts.body_md;
  if (opts.horizon_months !== undefined) patch.horizon_months = opts.horizon_months;
  if (opts.start_date !== undefined) patch.start_date = opts.start_date;
  if (opts.target_date !== undefined) patch.target_date = opts.target_date;
  if (opts.north_star_metrics !== undefined) patch.north_star_metrics = opts.north_star_metrics;
  if (opts.programming_dose !== undefined) patch.programming_dose = opts.programming_dose;
  if (opts.nutrition_anchors !== undefined) patch.nutrition_anchors = opts.nutrition_anchors;
  if (opts.reevaluation_triggers !== undefined) patch.reevaluation_triggers = opts.reevaluation_triggers;
  if (opts.status !== undefined) patch.status = opts.status;

  await db.body_plan.update(existing.uuid, patch);
  syncEngine.schedulePush();
  return existing.uuid;
}

/** Create a brand-new plan. Caller is responsible for archiving any existing
 *  active plan first if `status` is 'active' (the partial-unique index in
 *  Postgres will reject otherwise on push). */
export async function createPlan(opts: {
  vision_id: string;
  title: string;
  summary?: string | null;
  body_md?: string | null;
  horizon_months: number;
  start_date: string;
  target_date: string;
  north_star_metrics?: NorthStarMetric[];
  programming_dose?: ProgrammingDose;
  nutrition_anchors?: NutritionAnchors;
  reevaluation_triggers?: string[];
  status?: 'active' | 'archived' | 'superseded';
  uuid?: string;
}): Promise<string> {
  const id = opts.uuid ?? genUUID();
  const row: LocalBodyPlan = {
    uuid: id,
    vision_id: opts.vision_id,
    title: opts.title.trim(),
    summary: opts.summary ?? null,
    body_md: opts.body_md ?? null,
    horizon_months: opts.horizon_months,
    start_date: opts.start_date,
    target_date: opts.target_date,
    north_star_metrics: opts.north_star_metrics ?? [],
    programming_dose: opts.programming_dose ?? {},
    nutrition_anchors: opts.nutrition_anchors ?? {},
    reevaluation_triggers: opts.reevaluation_triggers ?? [],
    status: opts.status ?? 'active',
    ...syncMeta(),
  };
  await db.body_plan.put(row);
  syncEngine.schedulePush();
  return id;
}

// ─── Checkpoints ─────────────────────────────────────────────────────────────

/** Update an existing checkpoint stub (the common case — checkpoints are
 *  auto-stubbed at plan creation) or create a new one if `uuid` is omitted. */
export async function logCheckpoint(opts: {
  uuid?: string;
  plan_id?: string;
  quarter_label?: string;
  target_date?: string;
  review_date?: string | null;
  status?: 'scheduled' | 'completed';
  metrics_snapshot?: Record<string, number | null> | null;
  assessment?: 'on_track' | 'ahead' | 'behind' | 'reset_required' | null;
  notes?: string | null;
  adjustments_made?: string[];
}): Promise<string> {
  if (opts.uuid) {
    const existing = await db.plan_checkpoint.get(opts.uuid);
    if (!existing) throw new Error(`logCheckpoint: no checkpoint with uuid ${opts.uuid}`);

    const patch: Partial<LocalPlanCheckpoint> = { ...syncMeta() };
    if (opts.quarter_label !== undefined) patch.quarter_label = opts.quarter_label;
    if (opts.target_date !== undefined) patch.target_date = opts.target_date;
    if (opts.review_date !== undefined) patch.review_date = opts.review_date;
    if (opts.metrics_snapshot !== undefined) patch.metrics_snapshot = opts.metrics_snapshot;
    if (opts.assessment !== undefined) patch.assessment = opts.assessment;
    if (opts.notes !== undefined) patch.notes = opts.notes;
    if (opts.adjustments_made !== undefined) patch.adjustments_made = opts.adjustments_made;

    // Status: explicit wins; otherwise auto-flip to 'completed' when
    // review_date is being set to a non-null value.
    if (opts.status !== undefined) {
      patch.status = opts.status;
    } else if (opts.review_date && opts.review_date !== existing.review_date) {
      patch.status = 'completed';
    }

    await db.plan_checkpoint.update(existing.uuid, patch);
    syncEngine.schedulePush();
    return existing.uuid;
  }

  // Create branch.
  if (!opts.plan_id) throw new Error('logCheckpoint: plan_id is required when creating a new checkpoint');
  if (!opts.quarter_label) throw new Error('logCheckpoint: quarter_label is required when creating a new checkpoint');
  if (!opts.target_date) throw new Error('logCheckpoint: target_date is required when creating a new checkpoint');

  const id = genUUID();
  const finalStatus: LocalPlanCheckpoint['status'] =
    opts.status ?? (opts.review_date ? 'completed' : 'scheduled');
  const row: LocalPlanCheckpoint = {
    uuid: id,
    plan_id: opts.plan_id,
    quarter_label: opts.quarter_label,
    target_date: opts.target_date,
    review_date: opts.review_date ?? null,
    status: finalStatus,
    metrics_snapshot: opts.metrics_snapshot ?? null,
    assessment: opts.assessment ?? null,
    notes: opts.notes ?? null,
    adjustments_made: opts.adjustments_made ?? [],
    ...syncMeta(),
  };
  await db.plan_checkpoint.put(row);
  syncEngine.schedulePush();
  return id;
}
