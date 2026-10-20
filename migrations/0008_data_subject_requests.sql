-- Migration: data subject access and deletion workflows
-- Issue #145: Define data deletion and subject-access workflows
--
-- Tracks every export/deletion request so the workflow itself is auditable,
-- and marks deleted accounts so they can be excluded from lookups while the
-- pseudonymised row keeps financial records referentially intact.

CREATE TABLE IF NOT EXISTS data_subject_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT        NOT NULL,
  request_type  TEXT        NOT NULL CHECK (request_type IN ('export', 'deletion')),
  status        TEXT        NOT NULL CHECK (status IN ('completed', 'rejected')),
  -- Why a request was rejected (e.g. active_gifts, verification_failed)
  reason        TEXT,
  ip_address    INET,
  user_agent    TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dsr_user_id ON data_subject_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_dsr_requested_at ON data_subject_requests (requested_at);

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON TABLE data_subject_requests IS
  'Log of data export / deletion requests (Issue #145). See docs/security/data-retention-and-subject-access.md.';
COMMENT ON COLUMN users.deleted_at IS
  'Set when the account was erased on request. PII columns are overwritten; the row is kept so financial records stay linked.';
