-- Migration 028: Collapse case-duplicate exercise rows into the lowercase variant
--
-- Background. The legacy iron-app catalog seeded exercises.uuid as uppercase
-- GUIDs. The bundled-catalog hydration in src/db/local.ts (added in 022/023)
-- normalizes uuid → lowercase before putting into Dexie, and the sync engine
-- now lowercases on both push (api/sync/push) and pull (lib/sync.ts L329).
-- During the transition window, syncing a freshly-seeded Dexie produced a
-- second, lowercase exercise row in Postgres alongside each pre-existing
-- uppercase one — without an ON CONFLICT path that recognized the case
-- collision. Result: 159 case-duplicate pairs, with workout_exercises rows
-- pointing at whichever variant happened to be live when the FK was first
-- written.
--
-- Symptom for the user: the in-workout [i] modal pulled the uppercase row
-- (image_count=0, no image_urls) instead of the lowercase row (image_count=2,
-- bundled demo frames). The catalog page worked fine because it routes by
-- the lowercase URL parameter.
--
-- Fix.
--   1. Repoint workout_exercises.exercise_uuid          → LOWER(...)
--   2. Repoint workout_routine_exercises.exercise_uuid  → LOWER(...)
--   3. Delete the uppercase exercise rows. The lowercase counterpart already
--      exists with the latest data (images, audited muscle taxonomy).
--   4. Add CHECK (uuid = LOWER(uuid)) so the invariant can't drift again.
--
-- The lowercase row wins on every field because:
--   - Text fields (description/steps/tips/equipment) match exactly between
--     pairs; the lc row was created by hydrate copying from the uc row.
--   - image_count / image_urls live ONLY on the lc row (see scripts/db-apply-
--     image-counts.mjs which UPDATEs WHERE uuid = LOWER(...)).
--   - For the 6 pairs where primary/secondary muscle arrays diverge, the lc
--     row carries the audited canonical-taxonomy values from migration 027.
--
-- Single-user app — no concurrent writers. The migrator wraps every file in
-- its own transaction (see src/db/migrate.ts → transaction([...statements])),
-- so no explicit BEGIN/COMMIT here. Idempotent on re-run: every predicate
-- evaluates to false once the data is clean.

-- 1. Repoint FKs to the lowercase exercise_uuid. Both target rows already
--    exist (the lc exercise row is present for every uc row), so the FK
--    constraints stay satisfied throughout.
UPDATE workout_exercises
   SET exercise_uuid = LOWER(exercise_uuid)
 WHERE exercise_uuid != LOWER(exercise_uuid)
   AND EXISTS (SELECT 1 FROM exercises e WHERE e.uuid = LOWER(workout_exercises.exercise_uuid));

UPDATE workout_routine_exercises
   SET exercise_uuid = LOWER(exercise_uuid)
 WHERE exercise_uuid != LOWER(exercise_uuid)
   AND EXISTS (SELECT 1 FROM exercises e WHERE e.uuid = LOWER(workout_routine_exercises.exercise_uuid));

-- 2. Delete the uppercase exercise rows. After the repoint above, no row
--    in any FK table still references them, so the DELETE proceeds cleanly.
--    The trigger writes a `delete` change_log entry keyed by the uppercase
--    UUID; sync pull's bulkDelete([uppercase]) is a no-op against the
--    lowercase-keyed Dexie table, so the lc row in Dexie is preserved.
DELETE FROM exercises e
 WHERE e.uuid != LOWER(e.uuid)
   AND EXISTS (SELECT 1 FROM exercises l WHERE l.uuid = LOWER(e.uuid));

-- 3. Lock in the invariant. From now on any attempted INSERT of a non-
--    lowercase uuid fails fast at the DB layer, regardless of whether it
--    came from the sync push, the MCP create_exercise path, or hand-rolled
--    SQL. Naming it lets future migrations DROP it explicitly if needed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exercises_uuid_lowercase'
  ) THEN
    ALTER TABLE exercises
      ADD CONSTRAINT exercises_uuid_lowercase CHECK (uuid = LOWER(uuid));
  END IF;
END $$;
