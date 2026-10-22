-- Migration: add soft-delete support to gifts table
-- Issue #262: Gift deletion should set deleted_at; financial records are preserved
-- for audit and potential refund processing. Hard-deletes are forbidden.

-- ── 1. Add deleted_at column to gifts ────────────────────────────────────────
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index to make filtered queries efficient (WHERE deleted_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_gifts_deleted_at ON gifts(deleted_at)
  WHERE deleted_at IS NULL;

-- ── 2. Composite index for sender queries that already filter by sender_id ───
CREATE INDEX IF NOT EXISTS idx_gifts_sender_not_deleted
  ON gifts(sender_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ── 3. Prevent physical DELETE on gifts (audit requirement) ──────────────────
-- Any DELETE statement on gifts is silently converted to a no-op.
-- Callers must use UPDATE gifts SET deleted_at = NOW() instead.
CREATE OR REPLACE RULE gifts_no_delete AS
  ON DELETE TO gifts
  DO INSTEAD NOTHING;

COMMENT ON COLUMN gifts.deleted_at IS
  'Soft-delete timestamp. NULL = active. Non-NULL = logically deleted. '
  'Rows are never physically removed; hard-delete is handled by the '
  'retention cron job after the data-retention window expires.';
