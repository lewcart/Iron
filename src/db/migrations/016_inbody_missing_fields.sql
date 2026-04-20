-- Migration 016: Fill InBody schema gaps the MCP caller flagged when trying to
-- round-trip a full scan. All columns are nullable additions to inbody_scans.
--
--   * soft_lean_mass_kg   — total body mass minus fat minus bone mineral (compound)
--   * fat_free_mass_kg    — total body mass minus fat
--   * seg_fat_*_pct       — segmental fat percentage, the analog to seg_lean_*_pct
--                           (5 locations, mirroring the existing seg_fat_*_kg set)
--   * arm_muscle_circumference_cm — research parameter distinct from the raw
--                           circ_right_arm_cm / circ_left_arm_cm measurements

ALTER TABLE inbody_scans ADD COLUMN IF NOT EXISTS soft_lean_mass_kg NUMERIC;
ALTER TABLE inbody_scans ADD COLUMN IF NOT EXISTS fat_free_mass_kg NUMERIC;

ALTER TABLE inbody_scans ADD COLUMN IF NOT EXISTS seg_fat_right_arm_pct NUMERIC;
ALTER TABLE inbody_scans ADD COLUMN IF NOT EXISTS seg_fat_left_arm_pct NUMERIC;
ALTER TABLE inbody_scans ADD COLUMN IF NOT EXISTS seg_fat_trunk_pct NUMERIC;
ALTER TABLE inbody_scans ADD COLUMN IF NOT EXISTS seg_fat_right_leg_pct NUMERIC;
ALTER TABLE inbody_scans ADD COLUMN IF NOT EXISTS seg_fat_left_leg_pct NUMERIC;

ALTER TABLE inbody_scans ADD COLUMN IF NOT EXISTS arm_muscle_circumference_cm NUMERIC;
