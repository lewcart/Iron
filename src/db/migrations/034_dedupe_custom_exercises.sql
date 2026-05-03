-- Migration 034: Dedupe duplicate custom exercises + lock the invariant.
--
-- Background. The /exercises/custom list grew duplicate rows over time:
-- 13 case-insensitive title clusters, 28 rows total. Mostly exact-title
-- repeats from re-tapping "Add Custom Exercise" with the same name (each
-- tap mints a fresh uuid via createCustomExercise → no UNIQUE on title to
-- catch it), plus a few case-only typos in warm-up cues
-- ("Banded Glute Bridge (Warm-Up)" vs "(Warm-up)").
--
-- For each cluster:
--   1. Pick the keeper as the row with the most workout history references
--      (workout_exercises + workout_routine_exercises). Tiebreak on oldest
--      created_at, then uuid lex order.
--   2. Smart-merge metadata onto the keeper, never losing information:
--        - description: take the longest non-empty value across the cluster.
--        - primary/secondary_muscles, alias, equipment: union of all rows,
--          preserving the keeper's existing slug order and appending novel
--          slugs from losers.
--        - steps / tips: prefer keeper's if non-empty; else the longest
--          non-empty array from any loser.
--        - movement_pattern, youtube_url: keeper's if set; else first
--          non-null from a loser.
--        - image_count: MAX across cluster (defensive — all are 0 today).
--   3. Repoint workout_exercises, workout_routine_exercises,
--      exercise_image_candidates, and exercise_image_generation_jobs from
--      losers to keeper. (The two image tables have 0 rows for these uuids
--      at audit time but the repoint is cheap and keeps this idempotent
--      against future drift.)
--   4. DELETE losers. The exercises_change_log trigger fires per delete so
--      the sync engine propagates the removal to Dexie on next pull.
--
-- After the dedupe, normalize warm-up casing to canonical "(Warm-Up)" so
-- the four warm-up keepers all use the same convention as the rest of the
-- catalog (e.g. "(Wide Grip)", "(Single Arm)").
--
-- Finally, add a partial UNIQUE index on (LOWER(TRIM(title))) WHERE
-- is_custom = true so a future double-tap of "Add" or another case-typo
-- can't recreate the problem at the database layer. The client UI gets a
-- pre-flight check too (src/lib/mutations-exercises.ts) so the user sees
-- a friendly message instead of a stuck sync queue.
--
-- Single-user app — no concurrent writers. The migrator wraps every file
-- in its own transaction (src/db/migrate.ts → transaction([...statements])),
-- so all of this is atomic. Idempotent on re-run: with no dupes left, the
-- DO block's outer FOR loop produces zero iterations, the warm-up rename
-- matches zero rows, and CREATE UNIQUE INDEX IF NOT EXISTS is a no-op.

DO $$
DECLARE
  cluster_key text;
  keeper_uuid text;

  merged_desc  text;
  merged_prim  jsonb;
  merged_sec   jsonb;
  merged_alias jsonb;
  merged_eq    jsonb;
  merged_steps jsonb;
  merged_tips  jsonb;
  merged_mp    text;
  merged_yt    text;
  merged_ic    integer;
BEGIN
  FOR cluster_key IN
    SELECT LOWER(TRIM(title))
      FROM exercises
     WHERE is_custom = true
     GROUP BY LOWER(TRIM(title))
    HAVING COUNT(*) > 1
  LOOP
    -- Pick the keeper. Most-referenced wins; oldest created_at as tiebreak;
    -- uuid lex as final tiebreak so the choice is fully deterministic.
    SELECT e.uuid INTO keeper_uuid
      FROM exercises e
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS n FROM workout_exercises we
         WHERE we.exercise_uuid = e.uuid
      ) we ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS n FROM workout_routine_exercises wre
         WHERE wre.exercise_uuid = e.uuid
      ) wre ON TRUE
     WHERE e.is_custom = true
       AND LOWER(TRIM(e.title)) = cluster_key
     ORDER BY (we.n + wre.n) DESC,
              e.created_at ASC,
              e.uuid ASC
     LIMIT 1;

    -- description: longest non-empty value across the cluster, keeper's
    -- value preferred at the same length so we don't churn it.
    SELECT description INTO merged_desc
      FROM exercises e
     WHERE e.is_custom = true
       AND LOWER(TRIM(e.title)) = cluster_key
       AND COALESCE(NULLIF(e.description, ''), NULL) IS NOT NULL
     ORDER BY LENGTH(e.description) DESC,
              (e.uuid = keeper_uuid) DESC
     LIMIT 1;

    -- primary_muscles: keeper's array first (preserves prime-mover ordering),
    -- then any slugs from losers that aren't already in it.
    SELECT k.primary_muscles
         || COALESCE((
              SELECT jsonb_agg(elem ORDER BY elem)
                FROM (
                  SELECT DISTINCT jsonb_array_elements_text(e.primary_muscles) AS elem
                    FROM exercises e
                   WHERE e.is_custom = true
                     AND LOWER(TRIM(e.title)) = cluster_key
                     AND e.uuid <> keeper_uuid
                ) loser_elems
               WHERE NOT (k.primary_muscles ? elem)
            ), '[]'::jsonb)
      INTO merged_prim
      FROM exercises k
     WHERE k.uuid = keeper_uuid;

    SELECT k.secondary_muscles
         || COALESCE((
              SELECT jsonb_agg(elem ORDER BY elem)
                FROM (
                  SELECT DISTINCT jsonb_array_elements_text(e.secondary_muscles) AS elem
                    FROM exercises e
                   WHERE e.is_custom = true
                     AND LOWER(TRIM(e.title)) = cluster_key
                     AND e.uuid <> keeper_uuid
                ) loser_elems
               WHERE NOT (k.secondary_muscles ? elem)
            ), '[]'::jsonb)
      INTO merged_sec
      FROM exercises k
     WHERE k.uuid = keeper_uuid;

    SELECT k.alias
         || COALESCE((
              SELECT jsonb_agg(elem ORDER BY elem)
                FROM (
                  SELECT DISTINCT jsonb_array_elements_text(e.alias) AS elem
                    FROM exercises e
                   WHERE e.is_custom = true
                     AND LOWER(TRIM(e.title)) = cluster_key
                     AND e.uuid <> keeper_uuid
                ) loser_elems
               WHERE NOT (k.alias ? elem)
            ), '[]'::jsonb)
      INTO merged_alias
      FROM exercises k
     WHERE k.uuid = keeper_uuid;

    SELECT k.equipment
         || COALESCE((
              SELECT jsonb_agg(elem ORDER BY elem)
                FROM (
                  SELECT DISTINCT jsonb_array_elements_text(e.equipment) AS elem
                    FROM exercises e
                   WHERE e.is_custom = true
                     AND LOWER(TRIM(e.title)) = cluster_key
                     AND e.uuid <> keeper_uuid
                ) loser_elems
               WHERE NOT (k.equipment ? elem)
            ), '[]'::jsonb)
      INTO merged_eq
      FROM exercises k
     WHERE k.uuid = keeper_uuid;

    -- steps / tips: prefer the keeper's array if non-empty (preserves the
    -- order the user wrote them in); otherwise take the longest non-empty
    -- array from a loser. We don't merge the arrays element-by-element here
    -- because steps are an ordered sequence and merging would garble them.
    SELECT steps INTO merged_steps
      FROM exercises e
     WHERE e.is_custom = true
       AND LOWER(TRIM(e.title)) = cluster_key
       AND jsonb_typeof(e.steps) = 'array'
       AND jsonb_array_length(e.steps) > 0
     ORDER BY (e.uuid = keeper_uuid) DESC,
              jsonb_array_length(e.steps) DESC
     LIMIT 1;

    SELECT tips INTO merged_tips
      FROM exercises e
     WHERE e.is_custom = true
       AND LOWER(TRIM(e.title)) = cluster_key
       AND jsonb_typeof(e.tips) = 'array'
       AND jsonb_array_length(e.tips) > 0
     ORDER BY (e.uuid = keeper_uuid) DESC,
              jsonb_array_length(e.tips) DESC
     LIMIT 1;

    SELECT movement_pattern INTO merged_mp
      FROM exercises e
     WHERE e.is_custom = true
       AND LOWER(TRIM(e.title)) = cluster_key
       AND e.movement_pattern IS NOT NULL
     ORDER BY (e.uuid = keeper_uuid) DESC
     LIMIT 1;

    SELECT youtube_url INTO merged_yt
      FROM exercises e
     WHERE e.is_custom = true
       AND LOWER(TRIM(e.title)) = cluster_key
       AND e.youtube_url IS NOT NULL
     ORDER BY (e.uuid = keeper_uuid) DESC
     LIMIT 1;

    SELECT MAX(image_count) INTO merged_ic
      FROM exercises e
     WHERE e.is_custom = true
       AND LOWER(TRIM(e.title)) = cluster_key;

    -- One composite UPDATE per keeper so the change_log trigger fires once,
    -- not ten times. COALESCE preserves the keeper's value when a merged
    -- value is NULL (which happens when no row in the cluster had data
    -- for that field).
    UPDATE exercises k
       SET description       = COALESCE(merged_desc,  k.description),
           primary_muscles   = COALESCE(merged_prim,  k.primary_muscles),
           secondary_muscles = COALESCE(merged_sec,   k.secondary_muscles),
           alias             = COALESCE(merged_alias, k.alias),
           equipment         = COALESCE(merged_eq,    k.equipment),
           steps             = COALESCE(merged_steps, k.steps),
           tips              = COALESCE(merged_tips,  k.tips),
           movement_pattern  = COALESCE(merged_mp,    k.movement_pattern),
           youtube_url       = COALESCE(merged_yt,    k.youtube_url),
           image_count       = COALESCE(merged_ic,    k.image_count),
           updated_at        = NOW()
     WHERE k.uuid = keeper_uuid;

    -- Repoint FKs from every loser in this cluster to the keeper. The
    -- ON DELETE CASCADE on these FKs would otherwise wipe workout history
    -- when we DELETE the losers below — that's exactly what we're
    -- preventing here.
    UPDATE workout_exercises
       SET exercise_uuid = keeper_uuid
     WHERE exercise_uuid IN (
       SELECT e.uuid
         FROM exercises e
        WHERE e.is_custom = true
          AND LOWER(TRIM(e.title)) = cluster_key
          AND e.uuid <> keeper_uuid
     );

    UPDATE workout_routine_exercises
       SET exercise_uuid = keeper_uuid
     WHERE exercise_uuid IN (
       SELECT e.uuid
         FROM exercises e
        WHERE e.is_custom = true
          AND LOWER(TRIM(e.title)) = cluster_key
          AND e.uuid <> keeper_uuid
     );

    UPDATE exercise_image_candidates
       SET exercise_uuid = keeper_uuid
     WHERE exercise_uuid IN (
       SELECT e.uuid
         FROM exercises e
        WHERE e.is_custom = true
          AND LOWER(TRIM(e.title)) = cluster_key
          AND e.uuid <> keeper_uuid
     );

    UPDATE exercise_image_generation_jobs
       SET exercise_uuid = keeper_uuid
     WHERE exercise_uuid IN (
       SELECT e.uuid
         FROM exercises e
        WHERE e.is_custom = true
          AND LOWER(TRIM(e.title)) = cluster_key
          AND e.uuid <> keeper_uuid
     );

    -- Now safe to drop the losers.
    DELETE FROM exercises
     WHERE is_custom = true
       AND LOWER(TRIM(title)) = cluster_key
       AND uuid <> keeper_uuid;

    -- Reset locals so the next iteration starts clean (PL/pgSQL doesn't
    -- automatically null these between iterations).
    merged_desc := NULL; merged_prim := NULL; merged_sec := NULL;
    merged_alias := NULL; merged_eq := NULL; merged_steps := NULL;
    merged_tips := NULL; merged_mp := NULL; merged_yt := NULL; merged_ic := NULL;
  END LOOP;
END $$;

-- Normalize warm-up casing to "(Warm-Up)" across customs. Matches the
-- catalog convention used by other parenthesized modifiers (Wide Grip,
-- Single Arm, Decline, etc).
UPDATE exercises
   SET title = REPLACE(title, '(Warm-up)', '(Warm-Up)'),
       updated_at = NOW()
 WHERE is_custom = true
   AND title LIKE '%(Warm-up)%';

-- Lock the invariant. From now on, attempting to insert a second custom
-- row with the same case-insensitive trimmed title fails fast at the DB
-- with a UNIQUE-violation, regardless of whether the write came from the
-- sync push, the MCP create_exercise path, or hand-rolled SQL.
CREATE UNIQUE INDEX IF NOT EXISTS exercises_custom_lower_title_unique
  ON exercises (LOWER(TRIM(title)))
  WHERE is_custom = true;
