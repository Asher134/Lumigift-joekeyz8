-- Migration: 0009_wishlists
-- Issue #339 — Wishlists: recipients request gifts via a shareable link
--
-- A recipient publishes a wish (target amount + unlock date). Anyone with the
-- public link (/wishlist/<slug>) can fulfil it, which creates a gift and marks
-- the wish fulfilled. `gift_id` links the wish to the gift that fulfilled it.

CREATE TABLE IF NOT EXISTS wishlists (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT        NOT NULL UNIQUE,
  owner_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_name    TEXT        NOT NULL,
  recipient_phone   TEXT        NOT NULL,
  title             TEXT        NOT NULL,
  target_amount_ngn INTEGER     NOT NULL CHECK (target_amount_ngn > 0),
  unlock_at         TIMESTAMPTZ NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'fulfilled')),
  gift_id           TEXT,
  fulfilled_by      UUID,
  fulfilled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wishlists_owner_id ON wishlists(owner_id, created_at DESC);
