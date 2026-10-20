-- Migration: add payment_references table for gift payment tracking
-- Issue #55: Ensure gift, payment reference, and initial status cannot partially commit

-- Stores one row per payment attempt tied to a gift.
-- This allows partial-commit detection: if the payment provider record exists
-- but the gift row does not (or vice versa), the system can identify and retry
-- or roll back the orphan.

CREATE TABLE IF NOT EXISTS payment_references (
  id           TEXT        PRIMARY KEY,
  gift_id      TEXT        NOT NULL,
  provider     TEXT        NOT NULL,  -- 'paystack' | 'stripe'
  reference    TEXT        NOT NULL UNIQUE,
  status       TEXT        NOT NULL DEFAULT 'pending',  -- pending | success | failed | refunded
  amount_ngn   NUMERIC     NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_payment_references_gift_id
    FOREIGN KEY (gift_id) REFERENCES gifts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payment_references_gift_id   ON payment_references(gift_id);
CREATE INDEX IF NOT EXISTS idx_payment_references_reference  ON payment_references(reference);
CREATE INDEX IF NOT EXISTS idx_payment_references_status     ON payment_references(status);

COMMENT ON TABLE payment_references IS
  'One row per payment attempt. Written inside the same transaction as the gift row so
   the two records are always consistent. A missing payment_reference for a gift row
   (or vice versa) indicates a partial commit and the gift should be treated as retryable.';
COMMENT ON COLUMN payment_references.provider IS 'Payment provider: paystack or stripe';
COMMENT ON COLUMN payment_references.reference IS 'Provider-specific payment reference / intent ID';
COMMENT ON COLUMN payment_references.status IS 'pending | success | failed | refunded';

-- Also add message and recipient_email columns if not already present (added here for issue #55)
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS message            TEXT,
  ADD COLUMN IF NOT EXISTS recipient_email    TEXT,
  ADD COLUMN IF NOT EXISTS recipient_name     TEXT,
  ADD COLUMN IF NOT EXISTS contract_id        TEXT,
  ADD COLUMN IF NOT EXISTS sender_stellar_key TEXT,
  ADD COLUMN IF NOT EXISTS media_url          TEXT;

COMMENT ON COLUMN gifts.message IS 'Optional sanitised gift message (HTML stripped)';
COMMENT ON COLUMN gifts.recipient_email IS 'Optional recipient email for notifications';
COMMENT ON COLUMN gifts.contract_id IS 'Soroban escrow contract ID once funded';
