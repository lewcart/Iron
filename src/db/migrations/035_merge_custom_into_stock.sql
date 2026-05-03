-- Migration 035: Merge orphaned custom rows into their stock catalog twins.
--
-- Context. After 034 deduped within-custom collisions, two cross-type pairs
-- remained — same title, one is_custom=true row, one is_custom=false row:
--
--   Cable Hip Adduction
--     custom 'db62e882-bcd9-4344-aaa7-9a25acb4b5c9' — 1 routine ref, no data
--     stock  '52977031-70a7-4e08-98a1-4871b614b9fb' — 4 workout refs, full data
--
--   Cable Kickback
--     custom 'db4a51cf-9c46-41d4-854d-cdeb6eb91009' — 0 refs, 2 unique aliases
--     stock  '6b849257-f025-473c-bb69-232e58dd7f66' — 2 workout refs + 1 routine ref, full data
--
-- The stock rows are the source of truth (canonical iron catalog ids 135
-- and 112, with steps/description/image_count populated by the seed). The
-- custom rows are accidental duplicates created via "+ Add" before the
-- catalog hydrate caught up.
--
-- Cross-type case isn't covered by the partial UNIQUE index added in 034
-- (WHERE is_custom = true), so this migration handles it data-side only.
-- Keeper rule: stock wins — we never want to demote an iron catalog row
-- to is_custom=true. Custom contributes only what stock lacks (the two
-- alias strings on Cable Kickback). Cable Hip Adduction's custom row has
-- nothing worth merging.
--
-- Wrapped in the migrator's outer transaction. Idempotent: the UPDATEs
-- and DELETEs are no-ops once the custom rows are gone.

-- 1. Repoint Cable Hip Adduction's routine ref from custom → stock.
UPDATE workout_routine_exercises
   SET exercise_uuid = '52977031-70a7-4e08-98a1-4871b614b9fb'
 WHERE exercise_uuid = 'db62e882-bcd9-4344-aaa7-9a25acb4b5c9';

-- (No workout_exercises refs on the custom row, but cover defensively.)
UPDATE workout_exercises
   SET exercise_uuid = '52977031-70a7-4e08-98a1-4871b614b9fb'
 WHERE exercise_uuid = 'db62e882-bcd9-4344-aaa7-9a25acb4b5c9';

UPDATE exercise_image_candidates
   SET exercise_uuid = '52977031-70a7-4e08-98a1-4871b614b9fb'
 WHERE exercise_uuid = 'db62e882-bcd9-4344-aaa7-9a25acb4b5c9';

UPDATE exercise_image_generation_jobs
   SET exercise_uuid = '52977031-70a7-4e08-98a1-4871b614b9fb'
 WHERE exercise_uuid = 'db62e882-bcd9-4344-aaa7-9a25acb4b5c9';

-- 2. Drop the custom Cable Hip Adduction row. Triggers the change_log
--    delete that propagates to Dexie on next pull.
DELETE FROM exercises
 WHERE uuid = 'db62e882-bcd9-4344-aaa7-9a25acb4b5c9';

-- 3. Cable Kickback. Merge the two unique aliases ("Cable Glute Kickback",
--    "Kickback") into stock's alias array, then drop custom. Use a
--    DISTINCT-aware union so re-running this migration is a no-op even if
--    the alias list already has the merged values.
UPDATE exercises k
   SET alias = k.alias
            || COALESCE((
                 SELECT jsonb_agg(elem ORDER BY elem)
                   FROM (
                     SELECT DISTINCT jsonb_array_elements_text(c.alias) AS elem
                       FROM exercises c
                      WHERE c.uuid = 'db4a51cf-9c46-41d4-854d-cdeb6eb91009'
                   ) custom_aliases
                  WHERE NOT (k.alias ? elem)
               ), '[]'::jsonb),
       updated_at = NOW()
 WHERE k.uuid = '6b849257-f025-473c-bb69-232e58dd7f66'
   AND EXISTS (
     SELECT 1 FROM exercises c
      WHERE c.uuid = 'db4a51cf-9c46-41d4-854d-cdeb6eb91009'
   );

-- (Custom Cable Kickback has zero FK refs at audit time, but cover
-- defensively in case anything got attached between dry-run and apply.)
UPDATE workout_exercises
   SET exercise_uuid = '6b849257-f025-473c-bb69-232e58dd7f66'
 WHERE exercise_uuid = 'db4a51cf-9c46-41d4-854d-cdeb6eb91009';

UPDATE workout_routine_exercises
   SET exercise_uuid = '6b849257-f025-473c-bb69-232e58dd7f66'
 WHERE exercise_uuid = 'db4a51cf-9c46-41d4-854d-cdeb6eb91009';

UPDATE exercise_image_candidates
   SET exercise_uuid = '6b849257-f025-473c-bb69-232e58dd7f66'
 WHERE exercise_uuid = 'db4a51cf-9c46-41d4-854d-cdeb6eb91009';

UPDATE exercise_image_generation_jobs
   SET exercise_uuid = '6b849257-f025-473c-bb69-232e58dd7f66'
 WHERE exercise_uuid = 'db4a51cf-9c46-41d4-854d-cdeb6eb91009';

DELETE FROM exercises
 WHERE uuid = 'db4a51cf-9c46-41d4-854d-cdeb6eb91009';
