-- Migration 006: MCP server support
-- Adds is_active flag to workout_plans, training_blocks, and coaching_notes tables

-- ── Active plan flag ──────────────────────────────────────────────────────────
-- Unique partial index enforces at most one active plan per app (no user_id column)
ALTER TABLE workout_plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_plans_is_active ON workout_plans(is_active) WHERE is_active = true;

-- ── Training blocks (periodisation) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_blocks (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal TEXT NOT NULL CHECK(goal IN ('strength', 'hypertrophy', 'endurance', 'cut', 'recomp', 'maintenance')),
  started_at DATE NOT NULL,
  ended_at DATE,
  notes TEXT,
  workout_plan_uuid TEXT REFERENCES workout_plans(uuid) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_blocks_started_at ON training_blocks(started_at DESC);

-- ── Coaching notes ────────────────────────────────────────────────────────────
-- Claude attaches coaching context to any module
CREATE TABLE IF NOT EXISTS coaching_notes (
  uuid TEXT PRIMARY KEY,
  note TEXT NOT NULL,
  context TEXT CHECK(context IS NULL OR context IN ('workout', 'nutrition', 'body_comp', 'general')),
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coaching_notes_created_at ON coaching_notes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coaching_notes_pinned ON coaching_notes(pinned) WHERE pinned = true;
