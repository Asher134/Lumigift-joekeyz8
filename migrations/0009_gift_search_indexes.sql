-- Migration: indexes supporting gift search and filter API
-- Issue #260: GET /api/v1/gifts filters by status, date range and message text

-- Composite index for sender-scoped status + date filtering with cursor ordering.
CREATE INDEX IF NOT EXISTS gifts_sender_status_created_idx
  ON gifts (sender_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS gifts_sender_created_idx
  ON gifts (sender_id, created_at DESC, id DESC);

-- Trigram index so case-insensitive ILIKE '%q%' on message avoids a sequential scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS gifts_message_trgm_idx
  ON gifts USING gin (message gin_trgm_ops);
