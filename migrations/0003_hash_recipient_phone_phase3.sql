-- Migration: hash recipient phone numbers — Phase 3 (Contract)
-- Issue #93 / Issue #304
--
-- PREREQUISITE: migrations/0003_hash_recipient_phone.sql must have been
-- deployed and the application must no longer read or write recipient_phone.
--
-- Deploy this migration at least 24 hours after Phase 1+2, in a separate deploy
-- from any application code change, following the blue-green migration strategy
-- documented in docs/ops/blue-green-migrations.md.
--
-- rollback: ALTER TABLE gifts ADD COLUMN IF NOT EXISTS recipient_phone TEXT;

-- 5. Drop the plaintext column (Phase 3 — destructive, separate deploy).
ALTER TABLE gifts
  DROP COLUMN IF EXISTS recipient_phone;
