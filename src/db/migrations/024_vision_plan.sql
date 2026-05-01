-- Migration 024: Body Vision + Plan strategic layer.
--
-- Adds three tables that capture the layer above execution:
--   * body_vision      — long-arc aesthetic concept (the "what body am I
--                         building?" answer). Singular active row, prose-
--                         first via body_md.
--   * body_plan        — time-bound strategy executing a Vision (target
--                         metrics, programming dose, triggers). One active
--                         at a time.
--   * plan_checkpoint  — quarterly review records, auto-stubbed at
--                         create_plan time and filled in as reviews happen.
--   * plan_dose_revision — append-only audit log of programming_dose changes
--                         within a plan, so mid-plan tweaks have a trail.
--
-- Existing tables get optional FKs:
--   * inspo_photos.vision_id   — mood board ties to a Vision (local-only
--                                 table, no CDC needed).
--   * training_blocks.plan_id  — blocks execute a Plan.
--   * coaching_notes.plan_id   — notes scoped to a Plan.
--
-- Single-active constraint enforced via partial unique indexes on status.
-- Prose lives in body_md (markdown). Structured fields (principles,
-- build_emphasis, north_star_metrics, programming_dose) are queryable
-- supplements, not the canonical content.

-- ─── body_vision ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS body_vision (
  uuid TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_md TEXT,                                          -- canonical long-form prose
  summary TEXT,                                          -- short pull-quote for cards
  principles TEXT[] NOT NULL DEFAULT '{}',
  build_emphasis TEXT[] NOT NULL DEFAULT '{}',
  maintain_emphasis TEXT[] NOT NULL DEFAULT '{}',
  deemphasize TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active vision allowed. Archived rows can pile up freely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_body_vision_one_active
  ON body_vision (status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_body_vision_updated_at ON body_vision(updated_at);

DROP TRIGGER IF EXISTS body_vision_updated_at ON body_vision;
CREATE TRIGGER body_vision_updated_at BEFORE UPDATE ON body_vision
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS body_vision_change_log ON body_vision;
CREATE TRIGGER body_vision_change_log AFTER INSERT OR UPDATE OR DELETE ON body_vision
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- ─── body_plan ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS body_plan (
  uuid TEXT PRIMARY KEY,
  vision_id TEXT NOT NULL REFERENCES body_vision(uuid) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  summary TEXT,                                          -- short pull-quote
  body_md TEXT,                                          -- canonical strategic prose
  horizon_months INT NOT NULL,
  start_date DATE NOT NULL,
  target_date DATE NOT NULL,
  -- north_star_metrics: array of { metric_key, baseline_value, baseline_date,
  -- target_value, target_date, reasoning }. Source of truth for "what we're
  -- aiming at" — body_goals is left untouched (deprecation deferred).
  north_star_metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- programming_dose: { strength_sessions_per_week: {min,max,rationale},
  -- cardio_floor_minutes_weekly: {target,rationale}, movement_principles[],
  -- add_more_when[] }. Edited in place; history goes to plan_dose_revision.
  programming_dose JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- nutrition_anchors: high-level approach (e.g. {protein_g_per_kg, deficit_approach}).
  -- Detailed plans live in nutrition tables.
  nutrition_anchors JSONB NOT NULL DEFAULT '{}'::jsonb,
  reevaluation_triggers TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (target_date >= start_date),
  CHECK (horizon_months > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_body_plan_one_active
  ON body_plan (status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_body_plan_vision_id ON body_plan(vision_id);
CREATE INDEX IF NOT EXISTS idx_body_plan_updated_at ON body_plan(updated_at);

DROP TRIGGER IF EXISTS body_plan_updated_at ON body_plan;
CREATE TRIGGER body_plan_updated_at BEFORE UPDATE ON body_plan
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS body_plan_change_log ON body_plan;
CREATE TRIGGER body_plan_change_log AFTER INSERT OR UPDATE OR DELETE ON body_plan
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- ─── plan_checkpoint ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plan_checkpoint (
  uuid TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES body_plan(uuid) ON DELETE CASCADE,
  quarter_label TEXT NOT NULL,                           -- e.g. 'Q3 2026'
  target_date DATE NOT NULL,                             -- when this review is due
  review_date DATE,                                      -- null until completed
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed')),
  metrics_snapshot JSONB,
  assessment TEXT CHECK (assessment IS NULL OR assessment IN ('on_track', 'ahead', 'behind', 'reset_required')),
  notes TEXT,
  adjustments_made TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_checkpoint_plan ON plan_checkpoint(plan_id, target_date);
CREATE INDEX IF NOT EXISTS idx_plan_checkpoint_updated_at ON plan_checkpoint(updated_at);

DROP TRIGGER IF EXISTS plan_checkpoint_updated_at ON plan_checkpoint;
CREATE TRIGGER plan_checkpoint_updated_at BEFORE UPDATE ON plan_checkpoint
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS plan_checkpoint_change_log ON plan_checkpoint;
CREATE TRIGGER plan_checkpoint_change_log AFTER INSERT OR UPDATE OR DELETE ON plan_checkpoint
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- ─── plan_dose_revision (server-only audit) ──────────────────────────────────
-- Append-only. Each row captures the programming_dose state at a point in
-- time, with a reason for the change. Not synced to Dexie — read via MCP
-- when needed.

CREATE TABLE IF NOT EXISTS plan_dose_revision (
  uuid TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES body_plan(uuid) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  dose_jsonb JSONB NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_dose_revision_plan ON plan_dose_revision(plan_id, effective_date);

-- ─── FKs on existing tables ──────────────────────────────────────────────────
--
-- inspo_photos: local-only table per migration 019 — server-side table is
-- absent on this DB, so we skip the FK. If/when inspo_photos becomes a server
-- table, add the FK in a follow-up migration.
--
-- training_blocks + coaching_notes: server-side, MCP-only surfaces (no CDC
-- per migration 019). Add the FK; CDC is intentionally not wired so they
-- stay out of the sync stream.

ALTER TABLE training_blocks
  ADD COLUMN IF NOT EXISTS plan_id TEXT REFERENCES body_plan(uuid) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_training_blocks_plan_id ON training_blocks(plan_id);

ALTER TABLE coaching_notes
  ADD COLUMN IF NOT EXISTS plan_id TEXT REFERENCES body_plan(uuid) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coaching_notes_plan_id ON coaching_notes(plan_id);

-- ─── Backfill: active Androgod(ess) Vision + Q2 2026 → Q4 2027 Plan ──────────
--
-- Schema-only seed. Structured fields populated from the spec's stated
-- baselines and programming. body_md / summary left NULL — Lewis fills in
-- the prose via the editor (step 4 of the rollout) or directly. Idempotent:
-- ON CONFLICT DO NOTHING so re-running the migration doesn't clobber edits.

INSERT INTO body_vision (uuid, title, principles, build_emphasis, deemphasize, status)
VALUES (
  'vision-androgodess-001',
  'Androgod(ess)',
  ARRAY['shape over chest development', 'feminine athletic silhouette', 'anti-quad-dominant'],
  ARRAY['shoulder caps', 'glute width', 'back definition', 'hip prominence'],
  ARRAY['traps', 'direct chest work'],
  'active'
)
ON CONFLICT (uuid) DO NOTHING;

INSERT INTO body_plan (
  uuid, vision_id, title, horizon_months, start_date, target_date,
  north_star_metrics, programming_dose, nutrition_anchors, reevaluation_triggers,
  status
)
VALUES (
  'plan-androgodess-2026q2-001',
  'vision-androgodess-001',
  'Androgod(ess) 18-month, Q2 2026 → Q4 2027',
  18,
  '2026-04-15',
  '2027-10-31',
  '[
    {
      "metric_key": "waist_cm",
      "baseline_value": 70.7,
      "baseline_date": "2026-04-15",
      "target_value": 64.0,
      "target_date": "2027-10-31",
      "reasoning": "Drop ~10% via fat loss + HRT redistribution; pairs with hip growth target for WHR shift"
    },
    {
      "metric_key": "hip_cm",
      "baseline_value": 88.7,
      "baseline_date": "2026-04-15",
      "target_value": null,
      "target_date": "2027-10-31",
      "reasoning": "Grow hip circumference via glute training + HRT redistribution. Target value pending."
    },
    {
      "metric_key": "pbf_pct",
      "baseline_value": 29.1,
      "baseline_date": "2026-04-15",
      "target_value": null,
      "target_date": "2027-10-31",
      "reasoning": "Body fat trend marker. Target pending — ranges with HRT-stable lean mass."
    },
    {
      "metric_key": "weight_kg",
      "baseline_value": 56.5,
      "baseline_date": "2026-04-15",
      "target_value": null,
      "target_date": "2027-10-31",
      "reasoning": "Tracked for trend, not as a primary target."
    }
  ]'::jsonb,
  '{
    "strength_sessions_per_week": {"min": 4, "max": 4, "rationale": "Pre-set dose covering full lower + upper coverage with glute-priority"},
    "cardio_floor_minutes_weekly": {"target": 240, "rationale": "CV health floor; HRT-aware baseline"},
    "movement_principles": [
      "lower body 2-3x per week",
      "glute focus on every lower day",
      "anti-quad-dominant exercise selection",
      "shoulder caps + back over chest"
    ],
    "add_more_when": [
      "resting HR creeps up",
      "labs flag CV markers",
      "energy outpaces dose"
    ]
  }'::jsonb,
  '{"protein_g_per_kg": 1.8, "deficit_approach": "moderate"}'::jsonb,
  ARRAY[
    'BF% stalled 8 weeks',
    'lean mass dropping',
    'labs flag CV markers',
    'mood/dysphoria regression sustained 3+ weeks'
  ],
  'active'
)
ON CONFLICT (uuid) DO NOTHING;

-- Auto-stub quarterly checkpoints from start_date through target_date.
-- One row per quarter end that falls inside the plan window.
INSERT INTO plan_checkpoint (uuid, plan_id, quarter_label, target_date, status)
VALUES
  ('chkpt-androgodess-2026q2-001', 'plan-androgodess-2026q2-001', 'Q2 2026', '2026-06-30', 'scheduled'),
  ('chkpt-androgodess-2026q3-001', 'plan-androgodess-2026q2-001', 'Q3 2026', '2026-09-30', 'scheduled'),
  ('chkpt-androgodess-2026q4-001', 'plan-androgodess-2026q2-001', 'Q4 2026', '2026-12-31', 'scheduled'),
  ('chkpt-androgodess-2027q1-001', 'plan-androgodess-2026q2-001', 'Q1 2027', '2027-03-31', 'scheduled'),
  ('chkpt-androgodess-2027q2-001', 'plan-androgodess-2026q2-001', 'Q2 2027', '2027-06-30', 'scheduled'),
  ('chkpt-androgodess-2027q3-001', 'plan-androgodess-2026q2-001', 'Q3 2027', '2027-09-30', 'scheduled'),
  ('chkpt-androgodess-2027q4-001', 'plan-androgodess-2026q2-001', 'Q4 2027', '2027-10-31', 'scheduled')
ON CONFLICT (uuid) DO NOTHING;

-- ─── change_log backfill ─────────────────────────────────────────────────────
-- For the new synced tables, emit synthetic insert entries so a since=0 pull
-- after migration sees every row. Idempotent.

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'body_vision', v.uuid, 'insert', COALESCE(v.updated_at, v.created_at, NOW())
FROM body_vision v
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'body_vision' AND cl.row_uuid = v.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'body_plan', p.uuid, 'insert', COALESCE(p.updated_at, p.created_at, NOW())
FROM body_plan p
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'body_plan' AND cl.row_uuid = p.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'plan_checkpoint', c.uuid, 'insert', COALESCE(c.updated_at, c.created_at, NOW())
FROM plan_checkpoint c
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'plan_checkpoint' AND cl.row_uuid = c.uuid);
