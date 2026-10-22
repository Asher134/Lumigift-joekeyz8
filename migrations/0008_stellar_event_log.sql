-- Migration: persist Stellar event reconciliation records
-- Issue #76: Persist cursor, event identity, and outcome for replay and audit.
--
-- Acceptance Criteria:
--   • Indexer restarts from durable state (cursor stored in DB, not just Redis)
--   • Duplicate ledger events remain idempotent (event_id UNIQUE constraint)
--
-- This table is append-only and provides a full audit trail of every Soroban
-- contract event processed by the event-indexer. It also stores the durable
-- cursor so the indexer survives Redis eviction or pod restarts.

-- ─── stellar_event_log ────────────────────────────────────────────────────────
-- Stores one row per processed Soroban contract event.
--
-- Columns:
--   event_id        — Soroban event cursor id (e.g. "0000000000123456-0000000001")
--                     Used as idempotency key — INSERT ... ON CONFLICT DO NOTHING
--   contract_id     — The escrow contract address that emitted the event
--   ledger          — Stellar ledger sequence number
--   ledger_closed_at — ISO-8601 timestamp from the Stellar network
--   tx_hash         — Stellar transaction hash
--   event_type      — "initialized" | "claimed" | "cancelled" | "upgraded"
--   gift_id         — FK to gifts table (NULL if contract not tracked)
--   outcome         — "applied" | "skipped" | "error"
--   error_message   — Populated when outcome = "error"
--   payload         — Full event payload as JSONB for replay / debugging
--   processed_at    — When this indexer run processed the event

CREATE TABLE IF NOT EXISTS stellar_event_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        TEXT        NOT NULL UNIQUE,
  contract_id     TEXT        NOT NULL,
  ledger          INTEGER     NOT NULL,
  ledger_closed_at TIMESTAMPTZ,
  tx_hash         TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  gift_id         TEXT,
  outcome         TEXT        NOT NULL DEFAULT 'applied',
  error_message   TEXT,
  payload         JSONB,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_stellar_event_log_gift_id
    FOREIGN KEY (gift_id) REFERENCES gifts(id) ON DELETE SET NULL
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_stellar_event_log_contract_id
  ON stellar_event_log(contract_id);

CREATE INDEX IF NOT EXISTS idx_stellar_event_log_ledger
  ON stellar_event_log(ledger);

CREATE INDEX IF NOT EXISTS idx_stellar_event_log_gift_id
  ON stellar_event_log(gift_id);

CREATE INDEX IF NOT EXISTS idx_stellar_event_log_event_type
  ON stellar_event_log(event_type);

CREATE INDEX IF NOT EXISTS idx_stellar_event_log_processed_at
  ON stellar_event_log(processed_at);

-- ─── indexer_cursor ───────────────────────────────────────────────────────────
-- Single-row table holding the durable cursor for the event indexer.
-- This ensures the indexer can restart from the correct ledger even after
-- a Redis eviction (Redis is a write-through cache; DB is the source of truth).
--
-- The table uses a fixed primary key ("escrow") so upserts are idempotent.

CREATE TABLE IF NOT EXISTS indexer_cursor (
  indexer_name  TEXT        PRIMARY KEY,
  cursor        TEXT        NOT NULL,
  last_ledger   INTEGER     NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the escrow indexer cursor with the genesis sentinel
INSERT INTO indexer_cursor (indexer_name, cursor, last_ledger)
VALUES ('escrow', '0000000000000000-0000000000', 0)
ON CONFLICT (indexer_name) DO NOTHING;

-- ─── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON TABLE stellar_event_log IS
  'Append-only audit trail of Soroban escrow contract events processed by the event indexer. '
  'The event_id column (Soroban cursor) provides idempotency — replaying the same event is safe.';

COMMENT ON COLUMN stellar_event_log.event_id IS
  'Soroban event cursor id (format: ledger_sequence-tx_index). '
  'UNIQUE constraint enforces idempotency across indexer restarts.';

COMMENT ON COLUMN stellar_event_log.outcome IS
  'Processing result: "applied" (gift status updated), "skipped" (already in target status or '
  'gift not found), "error" (exception during processing — see error_message).';

COMMENT ON COLUMN stellar_event_log.payload IS
  'Full decoded event payload as JSONB. Amounts are stored as strings to avoid bigint overflow.';

COMMENT ON TABLE indexer_cursor IS
  'Durable cursor storage for the Stellar event indexer. '
  'Redis is used as a fast cache; this table is the source of truth for restarts.';
