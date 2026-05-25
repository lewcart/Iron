-- Migration 050: per-exercise machine settings.
--
-- Named adjustable machine settings (seat height, chest bar, pad height, etc.)
-- stored as JSONB keyed by setting name, values are numbers. Personal to Lou —
-- saved on the exercise and surfaced as a reminder during workouts so she never
-- has to re-discover the right position.
--
-- NULL = no settings recorded. {} is valid but meaningless — UI ignores empty.
-- No validation on keys: whatever Lou names the knob is the name.

ALTER TABLE exercises
  ADD COLUMN machine_settings JSONB DEFAULT NULL;
