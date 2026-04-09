-- Migration 010: Add burst_group_id to inspo_photos for burst capture grouping
ALTER TABLE inspo_photos ADD COLUMN IF NOT EXISTS burst_group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_inspo_photos_burst_group_id ON inspo_photos(burst_group_id);
