-- Migration 017: HealthKit integration.
-- 4 tables: daily aggregates, workouts (full records for reconciliation),
-- per-metric sync state (anchor or window_end), and writeback tracking.
--
-- Design notes:
-- * Daily aggregates, NOT raw samples. Raw HR at 1Hz would be millions of rows;
--   coaching uses daily summaries. Workouts get full records since they're sparse.
-- * Quantity metrics (steps, HR, HRV...) use last_window_end — HKStatisticsCollectionQuery
--   has no anchor support, so we re-query a rolling 2-day window.
-- * Sleep and workouts use last_anchor — HKAnchoredObjectQuery gives real
--   incremental delivery including deletions.
-- * healthkit_writeback tracks HK sample UUIDs we authored so meal/scan edits
--   can delete the old samples before writing new ones.

-- ── Daily aggregates (one row per user/metric/date) ──────────────────────────

CREATE TABLE IF NOT EXISTS healthkit_daily (
  metric TEXT NOT NULL,
  -- metric enum: steps, active_energy, basal_energy, heart_rate, hrv,
  -- resting_hr, vo2_max, exercise_minutes,
  -- sleep_asleep, sleep_inbed, sleep_rem, sleep_deep, sleep_core, sleep_awake
  date DATE NOT NULL,
  value_min NUMERIC,           -- metric-appropriate (HR min bpm / unused for steps)
  value_max NUMERIC,           -- metric-appropriate
  value_avg NUMERIC,           -- primary summary for discreteAverage metrics
  value_sum NUMERIC,           -- primary summary for cumulative metrics
  count INTEGER,               -- # underlying samples (confidence signal)
  source_primary TEXT,         -- most-common source bundle id in the window
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (metric, date)
);

CREATE INDEX IF NOT EXISTS idx_healthkit_daily_date ON healthkit_daily(date DESC);
CREATE INDEX IF NOT EXISTS idx_healthkit_daily_metric_date ON healthkit_daily(metric, date DESC);

-- ── HealthKit workouts (full records for reconciliation) ─────────────────────

CREATE TABLE IF NOT EXISTS healthkit_workouts (
  hk_uuid TEXT PRIMARY KEY,
  activity_type TEXT NOT NULL,          -- 'traditional_strength', 'running', 'cycling', ...
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  duration_s INTEGER NOT NULL,
  total_energy_kcal NUMERIC,
  total_distance_m NUMERIC,
  avg_heart_rate INTEGER,
  max_heart_rate INTEGER,
  source_name TEXT,
  source_bundle_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  workout_uuid TEXT,                    -- FK to workouts.uuid if matched
  source TEXT NOT NULL DEFAULT 'hk_only'
    CHECK (source IN ('user_logged', 'hk_only', 'matched')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workout_uuid) REFERENCES workouts(uuid) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_healthkit_workouts_start ON healthkit_workouts(start_at DESC);
CREATE INDEX IF NOT EXISTS idx_healthkit_workouts_source_start
  ON healthkit_workouts(source, start_at DESC);
CREATE INDEX IF NOT EXISTS idx_healthkit_workouts_workout_uuid
  ON healthkit_workouts(workout_uuid);

DROP TRIGGER IF EXISTS healthkit_workouts_updated_at ON healthkit_workouts;
CREATE TRIGGER healthkit_workouts_updated_at
  BEFORE UPDATE ON healthkit_workouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Incremental sync state per metric ────────────────────────────────────────
-- Quantity metrics use last_window_end (rolling re-query, no anchor API).
-- Sleep and workouts use last_anchor (HKAnchoredObjectQuery).

CREATE TABLE IF NOT EXISTS healthkit_sync_state (
  metric TEXT PRIMARY KEY,
  last_anchor BYTEA,                    -- HKQueryAnchor serialized (sleep, workouts only)
  last_window_end TIMESTAMPTZ,          -- for quantity aggregates
  last_sync_at TIMESTAMPTZ,
  last_successful_sync_at TIMESTAMPTZ,
  last_error TEXT,                      -- 'permission_revoked' | 'timeout' | 'invalid_anchor' | ...
  last_error_at TIMESTAMPTZ
);

-- ── Writeback tracking (Rebirth-authored HK samples) ─────────────────────────
-- Remembers the HK sample UUIDs we created so meal/scan edits can delete the
-- old samples cleanly. source_kind + source_uuid + hk_type is unique so each
-- (meal, 'dietary_energy') has exactly one tracked HK UUID at a time.

CREATE TABLE IF NOT EXISTS healthkit_writeback (
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('meal', 'inbody', 'workout')),
  source_uuid TEXT NOT NULL,
  hk_type TEXT NOT NULL,
  hk_uuid TEXT NOT NULL,
  pending_delete BOOLEAN NOT NULL DEFAULT FALSE,
  written_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_kind, source_uuid, hk_type)
);

CREATE INDEX IF NOT EXISTS idx_healthkit_writeback_hk_uuid
  ON healthkit_writeback(hk_uuid);
CREATE INDEX IF NOT EXISTS idx_healthkit_writeback_pending
  ON healthkit_writeback(pending_delete) WHERE pending_delete = TRUE;
