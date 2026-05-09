-- Migration 045: per-exercise secondary muscle weights (v1.1).
--
-- Replaces the flat 0.5 secondary credit (RP/Helms convention) with audited,
-- per-(exercise, muscle) values 0.0-1.0. Solves Lou's "is the 25 sets accurate"
-- forcing question by encoding the SME-grounded credit each compound actually
-- delivers to its secondary muscles (e.g., bench press → lateral delts ≈ 0.1
-- not 0.5; Bulgarian split squat → glutes ≈ 0.7 not 0.5).
--
-- See docs/plans/routine-volume-drilldown-and-weights.md for the SME table
-- and the gate-locked v1.1 scope. The audit script
-- (scripts/audit-exercise-secondary-weights.ts) seeds the catalog from the
-- /autoplan SME run; new exercises ship with secondary_weights=NULL and use
-- the legacy 0.5 default until manually weighted.
--
-- Math hookup: src/lib/training/volume-math.ts looks up
-- `exercise.secondary_weights[muscle_slug] ?? 0.5`. SQL aggregation in
-- src/db/queries.ts:1481 uses the same fallback expression. Conformance test
-- (TS ≡ SQL) extended with a per-exercise-weight fixture.

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS secondary_weights JSONB;

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS weight_source TEXT
  CHECK (weight_source IS NULL OR weight_source IN ('audited', 'inferred', 'default', 'manual-override'));

COMMENT ON COLUMN exercises.secondary_weights IS
  'Per-(secondary muscle) credit weight 0.0-1.0 keyed by canonical muscle slug. Null = no audit, falls back to 0.5 in volume-math. Primary muscles always count as 1.0 — this column only governs secondary credit.';

COMMENT ON COLUMN exercises.weight_source IS
  'Provenance for secondary_weights: audited (SME-grounded from EMG / Schoenfeld / RP / biomechanics), inferred (rule-based from biomechanics tags), default (no weights), manual-override (MCP write or future UI edit). Surfaced on the exercise page so Lou can see which weights are reliable.';

-- Validate weight values when present. Postgres can't easily validate JSONB
-- value ranges in CHECK; instead the application layer (TS + audit script)
-- enforces 0.0-1.0. This trigger catches the obviously-bad case of non-object
-- payloads slipping through.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exercises_secondary_weights_object_check') THEN
    ALTER TABLE exercises
      ADD CONSTRAINT exercises_secondary_weights_object_check
      CHECK (secondary_weights IS NULL OR jsonb_typeof(secondary_weights) = 'object');
  END IF;
END$$;
