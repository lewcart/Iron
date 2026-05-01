-- Migration 026: Canonical muscle taxonomy
--
-- Establishes a slug-based taxonomy of 17 canonical muscles, a synonym map for
-- legacy values (Latin Everkinetic + English custom), and a trigger that
-- enforces slug-only writes on exercises.{primary,secondary}_muscles.
--
-- Background: pre-023 the catalog had two competing taxonomies:
--   Everkinetic (Latin): pectoralis major, latissimus dorsi, glutaeus maximus,
--                        ischiocrural muscles, gastrocnemius, soleus,
--                        trapezius, deltoid, biceps brachii, triceps brachii,
--                        quadriceps, abdominals, obliques, erector spinae,
--                        hip adductors, forearm/forerm (typo)
--   Custom (English):    hamstrings, glutes, hip abductors, lower back,
--                        tensor fasciae latae, forearms
--
-- Per /autoplan review: in-place UPDATE with synonym lookup, then CREATE
-- TRIGGER last so the UPDATE itself does not trip the validator.
--
-- Optimal-set ranges seeded per Schoenfeld 2021 (10–20 sets/muscle/week for
-- major movers). Stabilizers/auxiliaries (rotator_cuff, forearms) start with
-- a tighter band.
--
-- Companion: src/lib/muscles.ts mirrors the canonical slugs as a TS union.

BEGIN;

-- ─── Canonical muscles table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS muscles (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  parent_group TEXT NOT NULL,
  optimal_sets_min INT NOT NULL CHECK (optimal_sets_min >= 0),
  optimal_sets_max INT NOT NULL CHECK (optimal_sets_max >= optimal_sets_min),
  display_order INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_muscles_display_order ON muscles(display_order);
CREATE INDEX IF NOT EXISTS idx_muscles_parent_group ON muscles(parent_group);

DROP TRIGGER IF EXISTS muscles_updated_at ON muscles;
CREATE TRIGGER muscles_updated_at BEFORE UPDATE ON muscles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE muscles IS
  'Canonical muscle taxonomy. exercises.primary_muscles and secondary_muscles '
  'must reference muscles.slug values exactly (enforced via trigger). Synonym '
  'translation lives in muscle_synonyms.';

-- muscles uses slug as primary key, not uuid. record_change_uuid() would try
-- to dereference NEW.uuid (doesn't exist), so use a slug-based variant.
CREATE OR REPLACE FUNCTION record_change_muscles()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES ('muscles', OLD.slug, 'delete');
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES ('muscles', NEW.slug, 'insert');
    RETURN NEW;
  ELSE
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES ('muscles', NEW.slug, 'update');
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER muscles_change_log AFTER INSERT OR UPDATE OR DELETE ON muscles
  FOR EACH ROW EXECUTE FUNCTION record_change_muscles();

-- ─── Seed: 17 canonical muscles ──────────────────────────────────────────────
-- display_order groups anatomically: chest → back → shoulders → arms → core → legs

INSERT INTO muscles (slug, display_name, parent_group, optimal_sets_min, optimal_sets_max, display_order) VALUES
  ('chest',          'Chest',          'chest',     10, 20,  10),
  ('lats',           'Lats',           'back',      10, 20,  20),
  ('rhomboids',      'Rhomboids',      'back',      10, 20,  30),
  ('mid_traps',      'Mid Traps',      'back',      10, 20,  40),
  ('lower_traps',    'Lower Traps',    'back',      10, 20,  50),
  ('erectors',       'Erectors',       'back',      10, 20,  60),
  ('delts',          'Delts',          'shoulders', 10, 20,  70),
  ('rotator_cuff',   'Rotator Cuff',   'shoulders',  2,  8,  80),
  ('biceps',         'Biceps',         'arms',      10, 20,  90),
  ('triceps',        'Triceps',        'arms',      10, 20, 100),
  ('forearms',       'Forearms',       'arms',       4, 10, 110),
  ('core',           'Core',           'core',      10, 20, 120),
  ('glutes',         'Glutes',         'legs',      10, 20, 130),
  ('quads',          'Quads',          'legs',      10, 20, 140),
  ('hamstrings',     'Hamstrings',     'legs',      10, 20, 150),
  ('hip_abductors',  'Hip Abductors',  'legs',      10, 20, 160),
  ('hip_adductors',  'Hip Adductors',  'legs',      10, 20, 170),
  ('calves',         'Calves',         'legs',      10, 20, 180)
ON CONFLICT (slug) DO NOTHING;

-- 18 canonical muscles. rotator_cuff and forearms get tighter bands;
-- everything else 10–20 per Schoenfeld 2021. Lewis can tune per-row later.

-- ─── Synonym map ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS muscle_synonyms (
  synonym TEXT PRIMARY KEY,
  muscle_slug TEXT NOT NULL REFERENCES muscles(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_muscle_synonyms_muscle_slug
  ON muscle_synonyms(muscle_slug);

COMMENT ON TABLE muscle_synonyms IS
  'Legacy → canonical muscle name mapping. Used by the in-place UPDATE in this '
  'migration and by find_exercises (forgiving muscle_group filter). Synonyms '
  'include the canonical slug itself so a forgiving lookup always resolves.';

-- Seed synonyms. The canonical slug self-maps so lookups can be uniform.
INSERT INTO muscle_synonyms (synonym, muscle_slug) VALUES
  -- chest
  ('chest',                  'chest'),
  ('pectoralis major',       'chest'),
  ('pectorals',              'chest'),
  ('pecs',                   'chest'),
  -- lats
  ('lats',                   'lats'),
  ('latissimus dorsi',       'lats'),
  ('latissimus',             'lats'),
  -- rhomboids (no legacy synonyms in current data; canonical only)
  ('rhomboids',              'rhomboids'),
  -- mid/lower traps. trapezius (current Everkinetic value) defaults to
  -- mid_traps; audit pass (Phase 1 step 6) refines per-exercise.
  ('mid_traps',              'mid_traps'),
  ('mid traps',              'mid_traps'),
  ('trapezius',              'mid_traps'),
  ('lower_traps',            'lower_traps'),
  ('lower traps',            'lower_traps'),
  -- erectors
  ('erectors',               'erectors'),
  ('erector spinae',         'erectors'),
  ('lower back',             'erectors'),
  -- delts
  ('delts',                  'delts'),
  ('deltoid',                'delts'),
  ('deltoids',               'delts'),
  ('shoulders',              'delts'),
  -- rotator cuff (no legacy synonyms; canonical only)
  ('rotator_cuff',           'rotator_cuff'),
  ('rotator cuff',           'rotator_cuff'),
  -- biceps
  ('biceps',                 'biceps'),
  ('biceps brachii',         'biceps'),
  -- triceps
  ('triceps',                'triceps'),
  ('triceps brachii',        'triceps'),
  -- forearms
  ('forearms',               'forearms'),
  ('forearm',                'forearms'),
  ('forerm',                 'forearms'),  -- typo present in seed data
  -- core
  ('core',                   'core'),
  ('abdominals',             'core'),
  ('abs',                    'core'),
  ('obliques',               'core'),
  -- glutes
  ('glutes',                 'glutes'),
  ('glutaeus maximus',       'glutes'),
  ('gluteus maximus',        'glutes'),
  -- quads
  ('quads',                  'quads'),
  ('quadriceps',             'quads'),
  -- hamstrings
  ('hamstrings',             'hamstrings'),
  ('ischiocrural muscles',   'hamstrings'),
  -- hip_abductors / adductors. tensor fasciae latae lives at the boundary;
  -- mapping it to hip_abductors matches its functional role.
  ('hip_abductors',          'hip_abductors'),
  ('hip abductors',          'hip_abductors'),
  ('tensor fasciae latae',   'hip_abductors'),
  ('hip_adductors',          'hip_adductors'),
  ('hip adductors',          'hip_adductors'),
  -- calves: gastrocnemius and soleus collapse together
  ('calves',                 'calves'),
  ('gastrocnemius',          'calves'),
  ('soleus',                 'calves')
ON CONFLICT (synonym) DO NOTHING;

-- ─── Preflight: every existing muscle value must be in muscle_synonyms ───────
--
-- The UPDATE below uses INNER JOIN against muscle_synonyms, which would
-- silently drop unmapped values. This preflight aborts the migration if any
-- such values exist, with a list of offenders so the synonym table can be
-- extended before retrying.

DO $$
DECLARE
  unmapped TEXT[];
BEGIN
  SELECT array_agg(DISTINCT v.value) INTO unmapped
  FROM exercises e,
       jsonb_array_elements_text(
         COALESCE(e.primary_muscles, '[]'::jsonb)
         || COALESCE(e.secondary_muscles, '[]'::jsonb)
       ) v(value)
  WHERE NOT EXISTS (SELECT 1 FROM muscle_synonyms s WHERE s.synonym = v.value);

  IF unmapped IS NOT NULL AND array_length(unmapped, 1) > 0 THEN
    RAISE EXCEPTION
      'Migration 026 preflight: % muscle value(s) have no synonym mapping: %. '
      'Add them to the muscle_synonyms seed in this migration before retrying.',
      array_length(unmapped, 1), unmapped;
  END IF;
END $$;

-- ─── In-place UPDATE: rewrite existing exercises to canonical slugs ──────────
--
-- Trigger does not exist yet, so this UPDATE is unguarded. INNER JOIN against
-- muscle_synonyms is safe because preflight above asserts every value maps.

UPDATE exercises SET
  primary_muscles = (
    SELECT COALESCE(jsonb_agg(DISTINCT s.muscle_slug ORDER BY s.muscle_slug), '[]'::jsonb)
    FROM jsonb_array_elements_text(primary_muscles) v(value)
    JOIN muscle_synonyms s ON s.synonym = v.value
  ),
  secondary_muscles = (
    SELECT COALESCE(jsonb_agg(DISTINCT s.muscle_slug ORDER BY s.muscle_slug), '[]'::jsonb)
    FROM jsonb_array_elements_text(secondary_muscles) v(value)
    JOIN muscle_synonyms s ON s.synonym = v.value
  )
WHERE primary_muscles != '[]'::jsonb OR secondary_muscles != '[]'::jsonb;

-- ─── Post-flight verification (defense in depth) ─────────────────────────────

DO $$
DECLARE bad_count INT;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM exercises e,
       jsonb_array_elements_text(
         COALESCE(e.primary_muscles, '[]'::jsonb)
         || COALESCE(e.secondary_muscles, '[]'::jsonb)
       ) v(value)
  WHERE NOT EXISTS (SELECT 1 FROM muscles WHERE slug = v.value);

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Migration 026 post-flight: % exercise muscle reference(s) are not '
      'canonical slugs after the UPDATE. This should be impossible given the '
      'preflight; aborting.',
      bad_count;
  END IF;
END $$;

-- Verify primary_muscles is non-empty for every exercise (catalog invariant).
-- A primary-empty exercise is unusable for sets-per-muscle aggregation.
DO $$
DECLARE empty_count INT;
BEGIN
  SELECT COUNT(*) INTO empty_count
  FROM exercises
  WHERE primary_muscles = '[]'::jsonb;

  IF empty_count > 0 THEN
    RAISE WARNING
      'Migration 026: % exercise(s) have empty primary_muscles after canonicalization. '
      'These will not contribute to any muscle aggregation. Run the audit pass '
      '(scripts/audit-exercise-muscles.mjs) to populate them.',
      empty_count;
  END IF;
END $$;

-- ─── Validation trigger on exercises ─────────────────────────────────────────
--
-- Goes on AFTER the UPDATE+verify so the migration itself doesn't trip it.
-- All future INSERT/UPDATE on exercises must use canonical slugs.

CREATE OR REPLACE FUNCTION validate_exercise_muscles()
RETURNS TRIGGER AS $$
DECLARE m TEXT;
BEGIN
  FOR m IN SELECT jsonb_array_elements_text(
    COALESCE(NEW.primary_muscles, '[]'::jsonb)
    || COALESCE(NEW.secondary_muscles, '[]'::jsonb)
  )
  LOOP
    IF NOT EXISTS (SELECT 1 FROM muscles WHERE slug = m) THEN
      RAISE EXCEPTION 'unknown muscle slug: % (use list_muscles to see canonical values)', m;
    END IF;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS exercises_validate_muscles ON exercises;
CREATE TRIGGER exercises_validate_muscles BEFORE INSERT OR UPDATE OF primary_muscles, secondary_muscles ON exercises
  FOR EACH ROW EXECUTE FUNCTION validate_exercise_muscles();

-- ─── change_log seed for muscles table ───────────────────────────────────────
-- Mirrors the pattern in 019: emit synthetic 'insert' events so a fresh client
-- pulling since=0 sees the seeded muscles rows.

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'muscles', m.slug, 'insert', NOW()
FROM muscles m
WHERE NOT EXISTS (
  SELECT 1 FROM change_log cl
  WHERE cl.table_name = 'muscles' AND cl.row_uuid = m.slug
);

COMMIT;
