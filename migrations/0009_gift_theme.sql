-- Migration: store the selected background theme on each gift
-- Issue #348: visual gift card designer with background themes

ALTER TABLE gifts ADD COLUMN IF NOT EXISTS theme_id TEXT;
