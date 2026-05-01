-- Migration 023: Per-night sleep records.
--
-- Adds healthkit_sleep_nights for the bedtime/waketime envelope plus the stage
-- minutes the existing healthkit_daily rows already capture. This lets us
-- compute consistency score (circular stdev of bedtime/waketime) which the
-- daily aggregates can't support — they only store stage totals, not when.
--
-- Why a new table, not extra columns on healthkit_daily?
--   healthkit_daily is one row per (metric, date). Bedtime is a property of
--   the *night*, not of any single stage metric. Jamming bedtime onto the
--   sleep_inbed row would force NULLs on every other stage row. A separate
--   per-night table mirrors how healthkit_workouts works for workouts.
--
-- Why PK = wake_date alone (no source_key)?
--   The native HealthKit plugin already groups multiple HK samples (Apple
--   Watch + Eight Sleep, etc) into one derived SleepNight per wake_date.
--   We get one SleepNight per night from native, so PK = wake_date is correct
--   today. If the plugin ever emits per-source nights, this becomes
--   (wake_date, source_key) and existing rows backfill source_key='merged'.
--
-- See:
--   - src/db/migrations/017_healthkit.sql (parent HK schema)
--   - src/lib/healthkit.ts:69 (SleepNight already has start_at, end_at)
--   - src/features/health/healthSync.ts:142-156 (sync flow)
--   - src/app/api/healthkit/sync/route.ts (writes both daily and nights)

CREATE TABLE IF NOT EXISTS healthkit_sleep_nights (
  wake_date DATE PRIMARY KEY,                   -- date of waketime (Europe/London)
  start_at TIMESTAMPTZ,                         -- in-bed onset (NULLABLE — historical samples may lack)
  end_at TIMESTAMPTZ,                           -- in-bed end   (NULLABLE — historical samples may lack)
  asleep_min NUMERIC NOT NULL DEFAULT 0,
  rem_min NUMERIC NOT NULL DEFAULT 0,
  deep_min NUMERIC NOT NULL DEFAULT 0,
  core_min NUMERIC NOT NULL DEFAULT 0,
  awake_min NUMERIC NOT NULL DEFAULT 0,
  in_bed_min NUMERIC NOT NULL DEFAULT 0,
  is_main BOOLEAN NOT NULL DEFAULT TRUE,        -- false = nap (filtered out of aggregates)
  source_primary TEXT,                          -- best-effort source name from HK
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_healthkit_sleep_nights_wake_date
  ON healthkit_sleep_nights(wake_date DESC);

-- Common query: main nights only, newest first.
CREATE INDEX IF NOT EXISTS idx_healthkit_sleep_nights_main
  ON healthkit_sleep_nights(wake_date DESC) WHERE is_main = TRUE;

DROP TRIGGER IF EXISTS healthkit_sleep_nights_updated_at ON healthkit_sleep_nights;
CREATE TRIGGER healthkit_sleep_nights_updated_at
  BEFORE UPDATE ON healthkit_sleep_nights
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Backfill: clear the sleep anchor so the next sync re-pulls the last 90 days
-- of nights into the new table. Without this, the table sits empty until a
-- HK sample is edited and the anchor naturally re-fires that wake_date.
UPDATE healthkit_sync_state SET last_anchor = NULL WHERE metric = 'sleep';
