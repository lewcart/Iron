-- Migration 044: routine volume fit check (PR1).
--
-- Adds the data the routine projection (PR3) needs to produce honest verdicts
-- against MEV/MAV/frequency without synthesizing green ticks from missing
-- inputs. Five additive changes ship together because the projection layer
-- depends on all of them landing before it can be honest.
--
-- See docs/plans/routine-volume-fit-check.md (PR1 implementation checklist)
-- for the design rationale. /autoplan voices specifically flagged:
--   - target_rir prevents projection's effective_set_count from collapsing
--     to raw set_count via the charitable null-RIR default
--   - cycle_length_days + frequency_per_week disambiguate weekly-cycle
--     routines from cycle-rotated ones (Lou's "as available" pattern)
--   - lateral_emphasis is the v1 lateral-delt sub-muscle resolution
--     (option b — exercise-tag layer, no taxonomy migration)
--   - vision_muscle_overrides lets glutes accept 14-26 without flagging
--     Lou's correct volume as "over" against the default 10-20

-- ── 1. Per-set RIR target on routine sets ───────────────────────────────
ALTER TABLE workout_routine_sets
  ADD COLUMN IF NOT EXISTS target_rir INTEGER
  CHECK (target_rir IS NULL OR (target_rir >= 0 AND target_rir <= 10));

COMMENT ON COLUMN workout_routine_sets.target_rir IS
  'Routine template target RIR (0-10). Null = unspecified; projection treats as low-confidence. Mirrors live workout_sets.rir convention.';

-- ── 2. Cycle metadata on routines ───────────────────────────────────────
ALTER TABLE workout_routines
  ADD COLUMN IF NOT EXISTS cycle_length_days INTEGER
  CHECK (cycle_length_days IS NULL OR cycle_length_days BETWEEN 1 AND 60);

COMMENT ON COLUMN workout_routines.cycle_length_days IS
  'Days in one cycle of the routine (default null = weekly/7-day cycle). A 4-day routine with cycle_length_days=9 delivers ~3.1 days/week effective frequency.';

ALTER TABLE workout_routines
  ADD COLUMN IF NOT EXISTS frequency_per_week NUMERIC(4,2)
  CHECK (frequency_per_week IS NULL OR frequency_per_week BETWEEN 0 AND 14);

COMMENT ON COLUMN workout_routines.frequency_per_week IS
  'Explicit ×/week override. Null = derive from cycle_length_days (or assume weekly). Use for routines where day count does not equal weekly frequency.';

-- ── 3. Lateral-emphasis exercise tag (option b for sub-muscle resolution)
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS lateral_emphasis BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN exercises.lateral_emphasis IS
  'Marks shoulder lateral-head emphasis exercises. Routine projection (PR3) derives a virtual delts_lateral row from sets touching exercises with lateral_emphasis=true. v1 of sub-muscle resolution per /autoplan UC2 option (b).';

-- Tag the canonical lateral-emphasis exercises. Idempotent — safe to re-run.
-- Title-prefix matches handle catalog-name variants (e.g. "Cable Lateral
-- Raise", "Dumbbell Lateral Raise"). Update if the catalog adds new variants
-- and the tag should propagate.
UPDATE exercises SET lateral_emphasis = TRUE
WHERE LOWER(title) LIKE '%lateral raise%'
   OR LOWER(title) LIKE '%cable y raise%'
   OR LOWER(title) LIKE '%cable y-raise%'
   OR LOWER(title) LIKE '%leaning lateral raise%'
   OR LOWER(title) LIKE '%machine lateral raise%';

-- ── 4. Vision-aware MAV / frequency overrides ───────────────────────────
CREATE TABLE IF NOT EXISTS vision_muscle_overrides (
  vision_uuid       TEXT NOT NULL REFERENCES body_vision(uuid) ON DELETE CASCADE,
  muscle_slug       TEXT NOT NULL,
  override_sets_min INTEGER CHECK (override_sets_min IS NULL OR override_sets_min >= 0),
  override_sets_max INTEGER CHECK (override_sets_max IS NULL OR override_sets_max >= 0),
  override_freq_min INTEGER CHECK (override_freq_min IS NULL OR (override_freq_min >= 0 AND override_freq_min <= 7)),
  evidence          TEXT CHECK (evidence IS NULL OR evidence IN ('low','medium','high')),
  notes             TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vision_uuid, muscle_slug)
);

COMMENT ON TABLE vision_muscle_overrides IS
  'Per-vision per-muscle range and frequency overrides. Layered on top of muscles.optimal_sets_min/max + DEFAULT_FREQUENCY_FLOORS. muscle_slug is text (not FK) so virtual sub-muscles like delts_lateral can have overrides without a taxonomy change.';

CREATE INDEX IF NOT EXISTS vision_muscle_overrides_vision_idx
  ON vision_muscle_overrides (vision_uuid);

CREATE INDEX IF NOT EXISTS vision_muscle_overrides_updated_at_idx
  ON vision_muscle_overrides (updated_at);

-- updated_at maintenance trigger (uses the existing update_updated_at()
-- function from migration 019).
DROP TRIGGER IF EXISTS vision_muscle_overrides_updated_at ON vision_muscle_overrides;
CREATE TRIGGER vision_muscle_overrides_updated_at
  BEFORE UPDATE ON vision_muscle_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- CDC trigger — composite key (vision_uuid, muscle_slug). Emit row_uuid as
-- 'vision_uuid|muscle_slug' so /api/sync/changes can split it back when
-- fetching rows. Pattern mirrors record_change_body_goals (custom-key tables).
CREATE OR REPLACE FUNCTION record_change_vision_muscle_overrides()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES ('vision_muscle_overrides', OLD.vision_uuid || '|' || OLD.muscle_slug, 'delete');
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES ('vision_muscle_overrides', NEW.vision_uuid || '|' || NEW.muscle_slug, 'insert');
    RETURN NEW;
  ELSE
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES ('vision_muscle_overrides', NEW.vision_uuid || '|' || NEW.muscle_slug, 'update');
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vision_muscle_overrides_change_log ON vision_muscle_overrides;
CREATE TRIGGER vision_muscle_overrides_change_log
  AFTER INSERT OR UPDATE OR DELETE ON vision_muscle_overrides
  FOR EACH ROW EXECUTE FUNCTION record_change_vision_muscle_overrides();

-- Seed Lou's androgodess vision overrides (TD3 ACCEPTED 2026-05-06).
-- Numbers grounded in /Users/lewis/.claude/skills/androgodess/SKILL.md
-- science cliff-notes. Idempotent — re-running this migration leaves
-- existing rows alone (DO NOTHING). To revise, edit + reseed manually.
INSERT INTO vision_muscle_overrides
  (vision_uuid, muscle_slug, override_sets_min, override_sets_max, override_freq_min, evidence, notes)
SELECT v.uuid, x.muscle_slug, x.sets_min, x.sets_max, x.freq_min, x.evidence, x.notes
FROM body_vision v
CROSS JOIN (VALUES
  ('glutes',         14, 26, 3, NULL,  'Tolerates 24+ at high volume; monitoring-protocol flags <14 or >24'),
  ('delts_lateral',   8, 16, 3, NULL,  '8 sets/wk → 3.3-4.6% growth in 8wk; 12-16 = specialization. Virtual sub-muscle resolved via lateral_emphasis tag.'),
  ('hip_abductors',   8, 16, 2, 'low', 'Literature thin — RP groups under glutes. Numbers extrapolated from glute-medius work.'),
  ('core',            8, 16, 3, NULL,  'Rectus + functional. Plan deliberately suppresses oblique hypertrophy for waist target.')
) AS x(muscle_slug, sets_min, sets_max, freq_min, evidence, notes)
WHERE v.status = 'active'
ON CONFLICT (vision_uuid, muscle_slug) DO NOTHING;
