-- Migration: hash recipient phone numbers in gifts table — Phase 1 & 2 (Expand + Migrate)
-- Issue #93: Storing recipient phone numbers in plaintext creates a PII liability.
-- Issue #304: Refactored to follow the blue-green expand→migrate→contract strategy.
--
-- PHASE 1 — EXPAND: add the new hashed column (backward-compatible).
-- PHASE 2 — MIGRATE: back-fill existing rows with the hash.
--
-- Phase 3 (DROP COLUMN recipient_phone) is in:
--   migrations/0003_hash_recipient_phone_phase3.sql
-- Deploy Phase 3 only after this migration has been stable in production
-- for at least 24 hours and application code no longer reads recipient_phone.

-- 1. Add the hashed column.
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS recipient_phone_hash TEXT;

COMMENT ON COLUMN gifts.recipient_phone_hash IS 'SHA-256 hex digest of the E.164 recipient phone number';

-- 2. Backfill existing rows: hash the plaintext value using pgcrypto.
--    encode(digest(value, 'sha256'), 'hex') requires the pgcrypto extension.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE gifts
SET recipient_phone_hash = encode(digest(recipient_phone, 'sha256'), 'hex')
WHERE recipient_phone IS NOT NULL
  AND recipient_phone_hash IS NULL;

-- 3. Make the hash column NOT NULL once backfilled.
--    Safe to do here because the UPDATE above covers all existing rows.
ALTER TABLE gifts
  ALTER COLUMN recipient_phone_hash SET NOT NULL;

-- 4. Index for fast lookup by hash.
CREATE INDEX IF NOT EXISTS gifts_recipient_phone_hash_idx
  ON gifts (recipient_phone_hash);

-- NOTE: recipient_phone is intentionally kept here.
-- The application must continue to write it (or accept NULL) until Phase 3 is deployed.
-- See migrations/0003_hash_recipient_phone_phase3.sql for the DROP COLUMN step.
