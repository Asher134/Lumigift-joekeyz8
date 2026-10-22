-- Migration: business/corporate gifting tier — issue #345

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'personal';

ALTER TABLE users
  ADD CONSTRAINT users_account_type_check CHECK (account_type IN ('personal', 'business'));

-- One row per bulk upload. All recipients are paid for with a single charge
-- identified by payment_reference; items holds the validated CSV rows.
CREATE TABLE IF NOT EXISTS bulk_gift_orders (
  id                TEXT        PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT        NOT NULL DEFAULT 'paystack',
  payment_reference TEXT        NOT NULL UNIQUE,
  total_ngn         NUMERIC     NOT NULL,
  items             JSONB       NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending_payment',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bulk_gift_orders_user_id ON bulk_gift_orders(user_id);
