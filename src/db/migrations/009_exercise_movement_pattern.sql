-- Migration 009: Add movement_pattern to exercises
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS movement_pattern TEXT;
