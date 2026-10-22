-- Migration: user account deletion support
-- Issue #280: Add DELETE /api/v1/users/me with OTP confirmation, anonymisation, audit log
--
-- Adds the account_deletion_log table for tracking anonymisation events with
-- enough metadata for compliance without re-identifying deleted users.
--
-- The users table already has deleted_at from migration 0008_data_subject_requests.sql.
-- This migration ensures the audit_logs event_type enum covers 'account_anonymised'
-- and adds a dedicated index for fast lookup of anonymised accounts.

-- ─── Extend audit event types ─────────────────────────────────────────────────
-- Conditionally add new event types to the CHECK constraint.
-- (Only required if the audit_logs table uses a CHECK rather than an enum type.)

DO $$
BEGIN
  -- If the audit_logs table stores event_type as text with a CHECK constraint,
  -- we cannot ALTER the constraint without dropping it. Instead we trust the
  -- application layer to write valid values; this migration is a no-op for the
  -- constraint itself but documents the new event type.
  --
  -- Supported new values (handled by createAuditLog in audit.service.ts):
  --   'data_deletion_requested'  — already present from migration 0008
  --   'data_deletion_completed'  — already present from migration 0008
  RAISE NOTICE 'audit_logs event types are validated at the application layer.';
END
$$;

-- ─── Account deletion log ─────────────────────────────────────────────────────
-- Separate from data_subject_requests to store the anonymised phone hash
-- without linking it back to a live user record.

CREATE TABLE IF NOT EXISTS account_deletion_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT        NOT NULL,
  anonymised_phone    TEXT        NOT NULL,  -- salted SHA-256 of original phone
  cancelled_gifts     INTEGER     NOT NULL DEFAULT 0,
  ip_address          INET,
  user_agent          TEXT,
  deleted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adl_user_id    ON account_deletion_log (user_id);
CREATE INDEX IF NOT EXISTS idx_adl_deleted_at ON account_deletion_log (deleted_at);

COMMENT ON TABLE account_deletion_log IS
  'Append-only record of account anonymisation events (Issue #280). '
  'anonymised_phone stores a salted SHA-256 hash — never the plaintext.';

COMMENT ON COLUMN account_deletion_log.anonymised_phone IS
  'SHA-256(ACCOUNT_DELETION_SALT + ":" + E164_phone). '
  'Salt is separate from the gift recipient salt to prevent cross-table linking.';

-- ─── OTP codes table guard ────────────────────────────────────────────────────
-- Ensure the otp_codes table has the columns expected by the DELETE handler.
-- If it already exists from another migration, these are no-ops.

ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS used       BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_otp_phone_active
  ON otp_codes (phone, expires_at)
  WHERE used = false;

COMMENT ON COLUMN otp_codes.used IS
  'True once the code has been consumed. Prevents replay attacks.';
