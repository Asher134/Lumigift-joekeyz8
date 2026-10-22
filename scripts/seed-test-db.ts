#!/usr/bin/env ts-node
/**
 * scripts/seed-test-db.ts
 *
 * Idempotent seed script for the local development and unit-test database.
 *
 * Covers all gift statuses required by automated tests:
 *   pending_payment, locked, unlocked, claimed, cancelled, expired
 *
 * Also covers:
 *   - Multiple payment provider references (Paystack + Stripe)
 *   - Multiple gifts per sender / recipient pair
 *   - Gift invitations linked to gifts
 *
 * Usage:
 *   TEST_DATABASE_URL=postgresql://... npx ts-node scripts/seed-test-db.ts
 *   # or via npm script:
 *   npm run db:seed:test
 *
 * The script is safe to re-run: it truncates seed rows by their deterministic
 * IDs (prefixed "seed-") before re-inserting, so running it twice does NOT
 * create duplicates.
 *
 * Closes #295
 * See also: scripts/seed-staging.ts (staging-safe variant, no real phone numbers)
 */
import { Pool } from "pg";
import { createHash } from "crypto";

const DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://lumigift:lumigift@localhost:5432/lumigift_test";

function hashPhone(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
}

// ─── Test users ───────────────────────────────────────────────────────────────

const USERS = [
  { id: "seed-user-1", phone: "+2348011111111", display_name: "Alice Obi" },
  { id: "seed-user-2", phone: "+2348022222222", display_name: "Bob Eze" },
  { id: "seed-user-3", phone: "+2348033333333", display_name: "Carol Nwosu" },
  { id: "seed-user-4", phone: "+2348044444444", display_name: "David Chukwu" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const now = new Date();
const past = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const future = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();

// ─── Gifts (all statuses) ─────────────────────────────────────────────────────

const GIFTS = [
  // ── pending_payment: created but payment not confirmed yet ────────────────
  {
    id: "seed-gift-1",
    sender_id: "seed-user-1",
    recipient_phone_hash: hashPhone("+2348022222222"),
    recipient_name: "Bob Eze",
    amount_ngn: 5000,
    amount_usdc: "3.0000000",
    status: "pending_payment",
    unlock_at: future(7),
    payment_provider: "paystack",
    payment_reference: "seed-pay-pstk-001",
  },
  // ── locked: payment confirmed, unlock date in future ─────────────────────
  {
    id: "seed-gift-2",
    sender_id: "seed-user-1",
    recipient_phone_hash: hashPhone("+2348033333333"),
    recipient_name: "Carol Nwosu",
    amount_ngn: 10000,
    amount_usdc: "6.0000000",
    status: "locked",
    unlock_at: future(30),
    stellar_tx_hash: "lockedstellarhash0000000000000000000000000000000000000000001",
    payment_provider: "stripe",
    payment_reference: "seed-pay-strp-001",
  },
  // ── unlocked: payment confirmed, unlock date passed, not yet claimed ──────
  {
    id: "seed-gift-3",
    sender_id: "seed-user-2",
    recipient_phone_hash: hashPhone("+2348011111111"),
    recipient_name: "Alice Obi",
    amount_ngn: 2500,
    amount_usdc: "1.5000000",
    status: "unlocked",
    unlock_at: past(1),
    stellar_tx_hash: "unlockedtxhash0000000000000000000000000000000000000000000001",
    payment_provider: "paystack",
    payment_reference: "seed-pay-pstk-002",
  },
  // ── claimed: gift claimed by recipient ─────────────────────────────────
  {
    id: "seed-gift-4",
    sender_id: "seed-user-2",
    recipient_phone_hash: hashPhone("+2348011111111"),
    recipient_name: "Alice Obi",
    amount_ngn: 7500,
    amount_usdc: "4.5000000",
    status: "claimed",
    unlock_at: past(10),
    stellar_tx_hash: "claimedstellarhash000000000000000000000000000000000000000001",
    claim_tx_hash: "claimtxhash0000000000000000000000000000000000000000000000000001",
    payment_provider: "stripe",
    payment_reference: "seed-pay-strp-002",
  },
  {
    id: "seed-gift-5",
    sender_id: "seed-user-3",
    recipient_phone_hash: hashPhone("+2348044444444"),
    recipient_name: "David Chukwu",
    amount_ngn: 15000,
    amount_usdc: "9.0000000",
    status: "claimed",
    unlock_at: past(5),
    stellar_tx_hash: "claimedstellarhash000000000000000000000000000000000000000002",
    claim_tx_hash: "claimtxhash0000000000000000000000000000000000000000000000000002",
    payment_provider: "paystack",
    payment_reference: "seed-pay-pstk-003",
  },
  // ── cancelled: sender cancelled the gift ──────────────────────────────────
  {
    id: "seed-gift-6",
    sender_id: "seed-user-1",
    recipient_phone_hash: hashPhone("+2348044444444"),
    recipient_name: "David Chukwu",
    amount_ngn: 3000,
    amount_usdc: "1.8000000",
    status: "cancelled",
    unlock_at: future(14),
    payment_provider: "paystack",
    payment_reference: "seed-pay-pstk-004",
  },
  // ── expired: unlock date passed, never claimed, past grace window ─────────
  {
    id: "seed-gift-7",
    sender_id: "seed-user-3",
    recipient_phone_hash: hashPhone("+2348022222222"),
    recipient_name: "Bob Eze",
    amount_ngn: 1000,
    amount_usdc: "0.6000000",
    status: "expired",
    unlock_at: past(90),
    stellar_tx_hash: "expiredtxhash000000000000000000000000000000000000000000000001",
    payment_provider: "stripe",
    payment_reference: "seed-pay-strp-003",
  },
  // ── multiple payment providers for same sender ────────────────────────────
  {
    id: "seed-gift-8",
    sender_id: "seed-user-4",
    recipient_phone_hash: hashPhone("+2348011111111"),
    recipient_name: "Alice Obi",
    amount_ngn: 5000,
    amount_usdc: "3.0000000",
    status: "locked",
    unlock_at: future(21),
    stellar_tx_hash: "lockedstellarhash0000000000000000000000000000000000000000002",
    payment_provider: "paystack",
    payment_reference: "seed-pay-pstk-005",
  },
  {
    id: "seed-gift-9",
    sender_id: "seed-user-4",
    recipient_phone_hash: hashPhone("+2348033333333"),
    recipient_name: "Carol Nwosu",
    amount_ngn: 8000,
    amount_usdc: "4.8000000",
    status: "pending_payment",
    unlock_at: future(60),
    payment_provider: "stripe",
    payment_reference: "seed-pay-strp-004",
  },
];

// ─── Gift invitations ─────────────────────────────────────────────────────────

const INVITATIONS = [
  {
    id: "seed-inv-1",
    gift_id: "seed-gift-3",
    recipient_phone_hash: hashPhone("+2348011111111"),
    recipient_phone: "+2348011111111",
    token: "seed-token-abc123def456ghi789",
    status: "pending",
    expires_at: future(7),
  },
  {
    id: "seed-inv-2",
    gift_id: "seed-gift-4",
    recipient_phone_hash: hashPhone("+2348011111111"),
    recipient_phone: "+2348011111111",
    token: "seed-token-xyz987wvu654tsr321",
    status: "claimed",
    expires_at: past(5),
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seed() {
  const pool = new Pool({ connectionString: DB_URL });

  try {
    console.log("🌱 Starting seed (local/unit-test)…");

    // ── Schema (idempotent) ───────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gifts (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        recipient_phone_hash TEXT NOT NULL,
        recipient_name TEXT NOT NULL,
        amount_ngn NUMERIC NOT NULL,
        amount_usdc TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_payment',
        unlock_at TIMESTAMPTZ NOT NULL,
        stellar_tx_hash TEXT,
        claim_tx_hash TEXT,
        payment_provider TEXT,
        payment_reference TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gift_invitations (
        id TEXT PRIMARY KEY,
        gift_id TEXT NOT NULL,
        recipient_phone_hash TEXT NOT NULL,
        recipient_phone TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_gift_invitations_gift_id FOREIGN KEY (gift_id)
          REFERENCES gifts(id) ON DELETE CASCADE
      )
    `);

    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_gift_invitations_token ON gift_invitations(token)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_gift_invitations_gift_id ON gift_invitations(gift_id)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_gift_invitations_recipient_phone_hash ON gift_invitations(recipient_phone_hash)`
    );

    // ── Idempotent wipe of seed rows only ─────────────────────────────────────
    // We only remove rows with 'seed-' prefix so production data is unaffected
    // if someone accidentally runs this against a shared DB.
    await pool.query(`DELETE FROM gift_invitations WHERE id LIKE 'seed-%'`);
    await pool.query(`DELETE FROM gifts WHERE id LIKE 'seed-%'`);
    await pool.query(`DELETE FROM users WHERE id LIKE 'seed-%'`);

    // ── Users ──────────────────────────────────────────────────────────────────
    for (const u of USERS) {
      await pool.query(
        `INSERT INTO users (id, phone, display_name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           phone = EXCLUDED.phone,
           display_name = EXCLUDED.display_name,
           updated_at = NOW()`,
        [u.id, u.phone, u.display_name]
      );
    }

    // ── Gifts ─────────────────────────────────────────────────────────────────
    for (const g of GIFTS) {
      const row = g as Record<string, unknown>;
      await pool.query(
        `INSERT INTO gifts
           (id, sender_id, recipient_phone_hash, recipient_name, amount_ngn, amount_usdc,
            status, unlock_at, stellar_tx_hash, claim_tx_hash, payment_provider, payment_reference)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
           status             = EXCLUDED.status,
           stellar_tx_hash    = EXCLUDED.stellar_tx_hash,
           claim_tx_hash      = EXCLUDED.claim_tx_hash,
           payment_provider   = EXCLUDED.payment_provider,
           payment_reference  = EXCLUDED.payment_reference,
           updated_at         = NOW()`,
        [
          row.id,
          row.sender_id,
          row.recipient_phone_hash,
          row.recipient_name,
          row.amount_ngn,
          row.amount_usdc,
          row.status,
          row.unlock_at,
          row.stellar_tx_hash ?? null,
          row.claim_tx_hash ?? null,
          row.payment_provider ?? null,
          row.payment_reference ?? null,
        ]
      );
    }

    // ── Gift invitations ──────────────────────────────────────────────────────
    for (const inv of INVITATIONS) {
      await pool.query(
        `INSERT INTO gift_invitations
           (id, gift_id, recipient_phone_hash, recipient_phone, token, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           status     = EXCLUDED.status,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
        [
          inv.id,
          inv.gift_id,
          inv.recipient_phone_hash,
          inv.recipient_phone,
          inv.token,
          inv.status,
          inv.expires_at,
        ]
      );
    }

    const statusCounts = GIFTS.reduce<Record<string, number>>((acc, g) => {
      acc[g.status] = (acc[g.status] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`✓ Seeded test DB:`);
    console.log(`  users:      ${USERS.length}`);
    console.log(`  gifts:      ${GIFTS.length} (${JSON.stringify(statusCounts)})`);
    console.log(`  invitations: ${INVITATIONS.length}`);
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
