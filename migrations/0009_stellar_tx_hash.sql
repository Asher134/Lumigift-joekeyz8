-- Migration: 0009_stellar_tx_hash
-- Issue #336 — Idempotency for Stellar transaction submissions
--
-- One row per logical submission (idempotency_key). The signed transaction
-- hash is recorded atomically with the gift update *before* the network
-- submission, so a retry after a timeout returns the existing hash instead
-- of submitting a duplicate transaction.
--
-- status: "pending" (recorded, submission in flight or outcome unknown)
--         "submitted" (Horizon accepted the transaction)
--         "failed" (Horizon rejected it — the key may be retried)

CREATE TABLE IF NOT EXISTS stellar_tx_hash (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  TEXT        NOT NULL UNIQUE,
  gift_id          TEXT        REFERENCES gifts(id) ON DELETE SET NULL,
  tx_hash          TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'submitted', 'failed')),
  attempts         INTEGER     NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stellar_tx_hash_gift_id ON stellar_tx_hash(gift_id);
CREATE INDEX IF NOT EXISTS idx_stellar_tx_hash_tx_hash ON stellar_tx_hash(tx_hash);
