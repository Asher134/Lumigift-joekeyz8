-- Issue #362: Prevent duplicate registrations for the same phone number.
-- Requires pgcrypto (enabled in 0003_hash_recipient_phone.sql).

-- 1. Add the hashed phone column and backfill it from the E.164 phone.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_hash TEXT;

UPDATE users
SET phone_hash = encode(digest(phone, 'sha256'), 'hex')
WHERE phone IS NOT NULL
  AND phone_hash IS NULL;

-- 2. Resolve existing duplicates: keep the oldest active account per phone and
--    soft-delete the rest so they are excluded from the unique index.
UPDATE users u
SET deleted_at = NOW()
FROM (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY phone_hash ORDER BY created_at ASC, id ASC) AS rn
  FROM users
  WHERE phone_hash IS NOT NULL
    AND deleted_at IS NULL
) d
WHERE u.id = d.id
  AND d.rn > 1;

-- 3. Enforce uniqueness for active accounts.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_hash_unique_idx
  ON users (phone_hash)
  WHERE deleted_at IS NULL;
