-- Migration 019: Local-first sync layer
--
-- Adds change-data-capture (CDC) infrastructure so the Capacitor client can
-- pull a single monotonic stream of changes across all domain tables instead
-- of per-table timestamp cursors (which suffer same-millisecond races and
-- parent/child cursor skew).
--
-- See: src/lib/sync.ts (client-side consumer)
--      docs deferred — design captured in /plan-eng-review on 2026-04-30
--
-- Tables covered: workout_plans, workout_routines, workout_routine_exercises,
-- workout_routine_sets, body_spec_logs, measurement_logs, nutrition_logs,
-- nutrition_week_meals, nutrition_day_notes, nutrition_targets, hrt_protocols,
-- hrt_logs, wellbeing_logs, dysphoria_logs, clothes_test_logs, inspo_photos,
-- progress_photos, inbody_scans, body_goals. Plus the already-CDC-ready
-- workouts/workout_exercises/workout_sets/bodyweight_logs/exercises (just
-- adding the change_log trigger on top of their existing updated_at trigger).
--
-- Tables intentionally NOT included: body_norm_ranges (reference data, not
-- per-user-mutable), fitbee_import_batches (import state), nutrition_food_entries
-- (write-once import detail), activity_logs (legacy unused), training_blocks /
-- coaching_notes (MCP-only surfaces, not driven from the app), healthkit_*
-- (already have their own sync mechanism via healthkit_sync_state).

-- ─── change_log table ────────────────────────────────────────────────────────
--
-- Single source of truth for "what changed across all domain tables." Client
-- pulls SELECT * FROM change_log WHERE seq > last_seq ORDER BY seq, then
-- fetches actual row data from per-table read endpoints. Atomic seq cursor
-- means no missed same-millisecond writes and no parent/child skew.

CREATE TABLE IF NOT EXISTS change_log (
  seq BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_uuid TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_change_log_seq ON change_log(seq);
CREATE INDEX IF NOT EXISTS idx_change_log_table_uuid ON change_log(table_name, row_uuid);

COMMENT ON TABLE change_log IS
  'Monotonic CDC stream feeding sync/pull. Append-only via per-table triggers. '
  'Retention TODO: prune entries older than 90 days via Vercel cron once added.';

-- ─── Generic CDC trigger function ────────────────────────────────────────────
--
-- Works for any table whose primary key is a TEXT column named "uuid". For
-- nutrition_targets (singleton row keyed by id=1) we use a different function
-- below.

CREATE OR REPLACE FUNCTION record_change_uuid()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES (TG_TABLE_NAME, OLD.uuid, 'delete');
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES (TG_TABLE_NAME, NEW.uuid, 'insert');
    RETURN NEW;
  ELSE
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES (TG_TABLE_NAME, NEW.uuid, 'update');
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- nutrition_targets is keyed by integer id (singleton id=1), not uuid. Custom
-- trigger emits row_uuid='1' so the client can treat it identically.
CREATE OR REPLACE FUNCTION record_change_nutrition_targets()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES ('nutrition_targets', OLD.id::TEXT, 'delete');
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES ('nutrition_targets', NEW.id::TEXT, 'insert');
    RETURN NEW;
  ELSE
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES ('nutrition_targets', NEW.id::TEXT, 'update');
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- body_goals is keyed by metric_key (TEXT PK, not uuid). Custom trigger maps
-- metric_key → row_uuid in the change log so the client sees a uniform shape.
CREATE OR REPLACE FUNCTION record_change_body_goals()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES ('body_goals', OLD.metric_key, 'delete');
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES ('body_goals', NEW.metric_key, 'insert');
    RETURN NEW;
  ELSE
    INSERT INTO change_log (table_name, row_uuid, op)
    VALUES ('body_goals', NEW.metric_key, 'update');
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─── Per-table sync layer additions ──────────────────────────────────────────
--
-- For each table missing updated_at: add column, backfill, add UPDATE trigger,
-- add CDC trigger, add index.
-- For each table that already has updated_at + UPDATE trigger: just add CDC
-- trigger.

-- workout_plans
ALTER TABLE workout_plans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE workout_plans SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS workout_plans_updated_at ON workout_plans;
CREATE TRIGGER workout_plans_updated_at BEFORE UPDATE ON workout_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_workout_plans_updated_at ON workout_plans(updated_at);
DROP TRIGGER IF EXISTS workout_plans_change_log ON workout_plans;
CREATE TRIGGER workout_plans_change_log AFTER INSERT OR UPDATE OR DELETE ON workout_plans
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- workout_routines
ALTER TABLE workout_routines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE workout_routines SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS workout_routines_updated_at ON workout_routines;
CREATE TRIGGER workout_routines_updated_at BEFORE UPDATE ON workout_routines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_workout_routines_updated_at ON workout_routines(updated_at);
DROP TRIGGER IF EXISTS workout_routines_change_log ON workout_routines;
CREATE TRIGGER workout_routines_change_log AFTER INSERT OR UPDATE OR DELETE ON workout_routines
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- workout_routine_exercises
ALTER TABLE workout_routine_exercises ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE workout_routine_exercises SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS workout_routine_exercises_updated_at ON workout_routine_exercises;
CREATE TRIGGER workout_routine_exercises_updated_at BEFORE UPDATE ON workout_routine_exercises
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_workout_routine_exercises_updated_at ON workout_routine_exercises(updated_at);
DROP TRIGGER IF EXISTS workout_routine_exercises_change_log ON workout_routine_exercises;
CREATE TRIGGER workout_routine_exercises_change_log AFTER INSERT OR UPDATE OR DELETE ON workout_routine_exercises
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- workout_routine_sets
ALTER TABLE workout_routine_sets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE workout_routine_sets SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS workout_routine_sets_updated_at ON workout_routine_sets;
CREATE TRIGGER workout_routine_sets_updated_at BEFORE UPDATE ON workout_routine_sets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_workout_routine_sets_updated_at ON workout_routine_sets(updated_at);
DROP TRIGGER IF EXISTS workout_routine_sets_change_log ON workout_routine_sets;
CREATE TRIGGER workout_routine_sets_change_log AFTER INSERT OR UPDATE OR DELETE ON workout_routine_sets
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- body_spec_logs
ALTER TABLE body_spec_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE body_spec_logs SET updated_at = COALESCE(measured_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS body_spec_logs_updated_at ON body_spec_logs;
CREATE TRIGGER body_spec_logs_updated_at BEFORE UPDATE ON body_spec_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_body_spec_logs_updated_at ON body_spec_logs(updated_at);
DROP TRIGGER IF EXISTS body_spec_logs_change_log ON body_spec_logs;
CREATE TRIGGER body_spec_logs_change_log AFTER INSERT OR UPDATE OR DELETE ON body_spec_logs
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- measurement_logs
ALTER TABLE measurement_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE measurement_logs SET updated_at = COALESCE(measured_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS measurement_logs_updated_at ON measurement_logs;
CREATE TRIGGER measurement_logs_updated_at BEFORE UPDATE ON measurement_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_measurement_logs_updated_at ON measurement_logs(updated_at);
DROP TRIGGER IF EXISTS measurement_logs_change_log ON measurement_logs;
CREATE TRIGGER measurement_logs_change_log AFTER INSERT OR UPDATE OR DELETE ON measurement_logs
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- nutrition_logs
ALTER TABLE nutrition_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE nutrition_logs SET updated_at = COALESCE(logged_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS nutrition_logs_updated_at ON nutrition_logs;
CREATE TRIGGER nutrition_logs_updated_at BEFORE UPDATE ON nutrition_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_nutrition_logs_updated_at ON nutrition_logs(updated_at);
DROP TRIGGER IF EXISTS nutrition_logs_change_log ON nutrition_logs;
CREATE TRIGGER nutrition_logs_change_log AFTER INSERT OR UPDATE OR DELETE ON nutrition_logs
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- nutrition_week_meals
ALTER TABLE nutrition_week_meals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE nutrition_week_meals SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS nutrition_week_meals_updated_at ON nutrition_week_meals;
CREATE TRIGGER nutrition_week_meals_updated_at BEFORE UPDATE ON nutrition_week_meals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_nutrition_week_meals_updated_at ON nutrition_week_meals(updated_at);
DROP TRIGGER IF EXISTS nutrition_week_meals_change_log ON nutrition_week_meals;
CREATE TRIGGER nutrition_week_meals_change_log AFTER INSERT OR UPDATE OR DELETE ON nutrition_week_meals
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- nutrition_day_notes (already has updated_at column, missing trigger + CDC)
DROP TRIGGER IF EXISTS nutrition_day_notes_updated_at ON nutrition_day_notes;
CREATE TRIGGER nutrition_day_notes_updated_at BEFORE UPDATE ON nutrition_day_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_nutrition_day_notes_updated_at ON nutrition_day_notes(updated_at);
DROP TRIGGER IF EXISTS nutrition_day_notes_change_log ON nutrition_day_notes;
CREATE TRIGGER nutrition_day_notes_change_log AFTER INSERT OR UPDATE OR DELETE ON nutrition_day_notes
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- nutrition_targets (already has updated_at + trigger, just add CDC)
DROP TRIGGER IF EXISTS nutrition_targets_change_log ON nutrition_targets;
CREATE TRIGGER nutrition_targets_change_log AFTER INSERT OR UPDATE OR DELETE ON nutrition_targets
  FOR EACH ROW EXECUTE FUNCTION record_change_nutrition_targets();

-- hrt_protocols
ALTER TABLE hrt_protocols ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE hrt_protocols SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS hrt_protocols_updated_at ON hrt_protocols;
CREATE TRIGGER hrt_protocols_updated_at BEFORE UPDATE ON hrt_protocols
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_hrt_protocols_updated_at ON hrt_protocols(updated_at);
DROP TRIGGER IF EXISTS hrt_protocols_change_log ON hrt_protocols;
CREATE TRIGGER hrt_protocols_change_log AFTER INSERT OR UPDATE OR DELETE ON hrt_protocols
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- hrt_logs
ALTER TABLE hrt_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE hrt_logs SET updated_at = COALESCE(logged_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS hrt_logs_updated_at ON hrt_logs;
CREATE TRIGGER hrt_logs_updated_at BEFORE UPDATE ON hrt_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_hrt_logs_updated_at ON hrt_logs(updated_at);
DROP TRIGGER IF EXISTS hrt_logs_change_log ON hrt_logs;
CREATE TRIGGER hrt_logs_change_log AFTER INSERT OR UPDATE OR DELETE ON hrt_logs
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- wellbeing_logs
ALTER TABLE wellbeing_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE wellbeing_logs SET updated_at = COALESCE(logged_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS wellbeing_logs_updated_at ON wellbeing_logs;
CREATE TRIGGER wellbeing_logs_updated_at BEFORE UPDATE ON wellbeing_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_wellbeing_logs_updated_at ON wellbeing_logs(updated_at);
DROP TRIGGER IF EXISTS wellbeing_logs_change_log ON wellbeing_logs;
CREATE TRIGGER wellbeing_logs_change_log AFTER INSERT OR UPDATE OR DELETE ON wellbeing_logs
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- dysphoria_logs
ALTER TABLE dysphoria_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE dysphoria_logs SET updated_at = COALESCE(logged_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS dysphoria_logs_updated_at ON dysphoria_logs;
CREATE TRIGGER dysphoria_logs_updated_at BEFORE UPDATE ON dysphoria_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_dysphoria_logs_updated_at ON dysphoria_logs(updated_at);
DROP TRIGGER IF EXISTS dysphoria_logs_change_log ON dysphoria_logs;
CREATE TRIGGER dysphoria_logs_change_log AFTER INSERT OR UPDATE OR DELETE ON dysphoria_logs
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- clothes_test_logs
ALTER TABLE clothes_test_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE clothes_test_logs SET updated_at = COALESCE(logged_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS clothes_test_logs_updated_at ON clothes_test_logs;
CREATE TRIGGER clothes_test_logs_updated_at BEFORE UPDATE ON clothes_test_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_clothes_test_logs_updated_at ON clothes_test_logs(updated_at);
DROP TRIGGER IF EXISTS clothes_test_logs_change_log ON clothes_test_logs;
CREATE TRIGGER clothes_test_logs_change_log AFTER INSERT OR UPDATE OR DELETE ON clothes_test_logs
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- inspo_photos: not present on this DB (local-only table, never synced
-- server-side). Skipping CDC wiring. If inspo_photos ever gets a server
-- table, add a follow-up migration with the same trigger pattern.

-- progress_photos
ALTER TABLE progress_photos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE progress_photos SET updated_at = COALESCE(taken_at, NOW()) WHERE updated_at IS NULL;
DROP TRIGGER IF EXISTS progress_photos_updated_at ON progress_photos;
CREATE TRIGGER progress_photos_updated_at BEFORE UPDATE ON progress_photos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_progress_photos_updated_at ON progress_photos(updated_at);
DROP TRIGGER IF EXISTS progress_photos_change_log ON progress_photos;
CREATE TRIGGER progress_photos_change_log AFTER INSERT OR UPDATE OR DELETE ON progress_photos
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- inbody_scans (has updated_at + trigger from migration 012, just add CDC)
DROP TRIGGER IF EXISTS inbody_scans_change_log ON inbody_scans;
CREATE TRIGGER inbody_scans_change_log AFTER INSERT OR UPDATE OR DELETE ON inbody_scans
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- body_goals (has updated_at + trigger, CDC uses metric_key as row_uuid)
DROP TRIGGER IF EXISTS body_goals_change_log ON body_goals;
CREATE TRIGGER body_goals_change_log AFTER INSERT OR UPDATE OR DELETE ON body_goals
  FOR EACH ROW EXECUTE FUNCTION record_change_body_goals();

-- ─── CDC triggers on already-synced workout tables ───────────────────────────
--
-- workouts, workout_exercises, workout_sets, bodyweight_logs, exercises all
-- already have updated_at + UPDATE trigger from migrations 005 and 018. We
-- just add the change_log trigger so they participate in the unified stream.

DROP TRIGGER IF EXISTS workouts_change_log ON workouts;
CREATE TRIGGER workouts_change_log AFTER INSERT OR UPDATE OR DELETE ON workouts
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

DROP TRIGGER IF EXISTS workout_exercises_change_log ON workout_exercises;
CREATE TRIGGER workout_exercises_change_log AFTER INSERT OR UPDATE OR DELETE ON workout_exercises
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

DROP TRIGGER IF EXISTS workout_sets_change_log ON workout_sets;
CREATE TRIGGER workout_sets_change_log AFTER INSERT OR UPDATE OR DELETE ON workout_sets
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

DROP TRIGGER IF EXISTS bodyweight_logs_change_log ON bodyweight_logs;
CREATE TRIGGER bodyweight_logs_change_log AFTER INSERT OR UPDATE OR DELETE ON bodyweight_logs
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

DROP TRIGGER IF EXISTS exercises_change_log ON exercises;
CREATE TRIGGER exercises_change_log AFTER INSERT OR UPDATE OR DELETE ON exercises
  FOR EACH ROW EXECUTE FUNCTION record_change_uuid();

-- ─── Backfill change_log so first post-migration pull is consistent ──────────
--
-- For each existing row, emit one synthetic 'insert' change_log entry so a
-- client doing a `since=0` pull after migration sees every row. Without this,
-- existing rows that have never been touched since migration would be
-- invisible to the new sync engine.
--
-- Idempotent: only inserts if no change_log entry exists for (table, uuid).

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'workouts', w.uuid, 'insert', COALESCE(w.updated_at, w.created_at, NOW())
FROM workouts w
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'workouts' AND cl.row_uuid = w.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'workout_exercises', we.uuid, 'insert', COALESCE(we.updated_at, we.created_at, NOW())
FROM workout_exercises we
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'workout_exercises' AND cl.row_uuid = we.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'workout_sets', ws.uuid, 'insert', COALESCE(ws.updated_at, ws.created_at, NOW())
FROM workout_sets ws
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'workout_sets' AND cl.row_uuid = ws.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'bodyweight_logs', b.uuid, 'insert', COALESCE(b.updated_at, b.logged_at, NOW())
FROM bodyweight_logs b
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'bodyweight_logs' AND cl.row_uuid = b.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'exercises', e.uuid, 'insert', COALESCE(e.updated_at, e.created_at, NOW())
FROM exercises e
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'exercises' AND cl.row_uuid = e.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'workout_plans', p.uuid, 'insert', COALESCE(p.updated_at, p.created_at, NOW())
FROM workout_plans p
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'workout_plans' AND cl.row_uuid = p.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'workout_routines', r.uuid, 'insert', COALESCE(r.updated_at, r.created_at, NOW())
FROM workout_routines r
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'workout_routines' AND cl.row_uuid = r.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'workout_routine_exercises', re.uuid, 'insert', COALESCE(re.updated_at, re.created_at, NOW())
FROM workout_routine_exercises re
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'workout_routine_exercises' AND cl.row_uuid = re.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'workout_routine_sets', rs.uuid, 'insert', COALESCE(rs.updated_at, rs.created_at, NOW())
FROM workout_routine_sets rs
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'workout_routine_sets' AND cl.row_uuid = rs.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'body_spec_logs', b.uuid, 'insert', COALESCE(b.updated_at, b.measured_at, NOW())
FROM body_spec_logs b
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'body_spec_logs' AND cl.row_uuid = b.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'measurement_logs', m.uuid, 'insert', COALESCE(m.updated_at, m.measured_at, NOW())
FROM measurement_logs m
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'measurement_logs' AND cl.row_uuid = m.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'nutrition_logs', n.uuid, 'insert', COALESCE(n.updated_at, n.logged_at, NOW())
FROM nutrition_logs n
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'nutrition_logs' AND cl.row_uuid = n.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'nutrition_week_meals', nw.uuid, 'insert', COALESCE(nw.updated_at, nw.created_at, NOW())
FROM nutrition_week_meals nw
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'nutrition_week_meals' AND cl.row_uuid = nw.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'nutrition_day_notes', nd.uuid, 'insert', COALESCE(nd.updated_at, NOW())
FROM nutrition_day_notes nd
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'nutrition_day_notes' AND cl.row_uuid = nd.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'nutrition_targets', nt.id::TEXT, 'insert', COALESCE(nt.updated_at, NOW())
FROM nutrition_targets nt
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'nutrition_targets' AND cl.row_uuid = nt.id::TEXT);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'hrt_protocols', hp.uuid, 'insert', COALESCE(hp.updated_at, hp.created_at, NOW())
FROM hrt_protocols hp
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'hrt_protocols' AND cl.row_uuid = hp.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'hrt_logs', hl.uuid, 'insert', COALESCE(hl.updated_at, hl.logged_at, NOW())
FROM hrt_logs hl
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'hrt_logs' AND cl.row_uuid = hl.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'wellbeing_logs', wl.uuid, 'insert', COALESCE(wl.updated_at, wl.logged_at, NOW())
FROM wellbeing_logs wl
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'wellbeing_logs' AND cl.row_uuid = wl.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'dysphoria_logs', dl.uuid, 'insert', COALESCE(dl.updated_at, dl.logged_at, NOW())
FROM dysphoria_logs dl
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'dysphoria_logs' AND cl.row_uuid = dl.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'clothes_test_logs', ct.uuid, 'insert', COALESCE(ct.updated_at, ct.logged_at, NOW())
FROM clothes_test_logs ct
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'clothes_test_logs' AND cl.row_uuid = ct.uuid);

-- inspo_photos backfill skipped: table not present on this DB (local-only).

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'progress_photos', pp.uuid, 'insert', COALESCE(pp.updated_at, pp.taken_at, NOW())
FROM progress_photos pp
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'progress_photos' AND cl.row_uuid = pp.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'inbody_scans', ib.uuid, 'insert', COALESCE(ib.updated_at, ib.scanned_at, NOW())
FROM inbody_scans ib
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'inbody_scans' AND cl.row_uuid = ib.uuid);

INSERT INTO change_log (table_name, row_uuid, op, created_at)
SELECT 'body_goals', bg.metric_key, 'insert', COALESCE(bg.updated_at, NOW())
FROM body_goals bg
WHERE NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.table_name = 'body_goals' AND cl.row_uuid = bg.metric_key);
