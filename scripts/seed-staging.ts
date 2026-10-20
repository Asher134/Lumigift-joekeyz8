#!/usr/bin/env ts-node
/**
 * scripts/seed-staging.ts
 *
 * Idempotent seed script for the STAGING environment.
 *
 * Key differences from seed-test-db.ts (local / unit tests):
 *   1. NO real phone numbers — all phones use the +2340000XXXXX range which
 *      is reserved for testing and will never reach a live subscriber.
 *   2. Covers the same full set of gift statuses so QA engineers can explore
 *      every state in the UI without manual setup.
 *   3. Payment references use a "stg-" prefix to distinguish them from
 *      production data in shared payment-provider dashboards.
 *
 * Safety:
 *   - Only deletes rows whose IDs begin with "stgseed-". Production data is
 *     never touched even if run against a shared DB by mistake.
 *   - Never seeded with STAGING_DATABASE_URL pointing to production.
 *     The script refuses to run if DATABASE_URL contains "prod" or "production".
 *
 * Usage (staging CI):
 *   STAGING_DATABASE_URL=postgresql://... npx ts-node scripts/seed-staging.ts
 *
 * Usage (local staging replica):
 *   TEST_DATABASE_URL=postgresql://... SEED_ENV=staging npx ts-node scripts/seed-staging.ts
 *
 * Closes #295
 */
import { Pool } from "pg";
import { createHash } from "crypto";

const DB_URL =
  process.env.STAGING_DATABASE_URL ??
  process.env.TEST_DATABASE_URL ??
  "postgresql://lumigift:lumigift@localhost:5432/lumigift_staging";

// ── Safety guard: refuse to run if connection string looks production-like ────
if (/prod(?:uction)?/i.test(DB_URL)) {
  console.error(
    "⛔  seed-staging.ts: STAGING_DATABASE_URL appears to point to a production database.\n" +
      "    Aborting to protect production data. Verify your environment variables."
  );
  process.exit(1);
}

function hashPhone(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
}

// ─── Staging users (safe / reserved phone range) ─────────────────────────────
// +2340000XXXXX is not allocated to any network and will never SMS a real person.

const USERS = [
  { id: "stgseed-user-1", phone: "+2340000100001", display_name: "Staging User Alpha" },
  { id: "stgseed-user-2", phone: "+2340000100002", display_name: "Staging User Beta" },
  { id: "stgseed-user-3", phone: "+2340000100003", display_name: "Staging User Gamma" },
  { id: "stgseed-user-4", phone: "+2340000100004", display_name: "Staging User Delta" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const now = new Date();
const past = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const future = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();

// ─── Gifts (all statuses) ─────────────────────────────────────────────────────

const GIFTS = [
  {
    id: "stgseed-gift-1",
    sender_id: "stgseed-user-1",
    recipient_phone_hash: hashPhone("+2340000100002"),
    recipient_name: "Staging User Beta",
    amount_ngn: 5000,
    amount_usdc: "3.0000000",
    status: "pending_payment",
    unlock_at: future(7),
    payment_provider: "paystack",
    payment_reference: "stg-pay-pstk-001",
  },
  {
    id: "stgseed-gift-2",
    sender_id: "stgseed-user-1",
    recipient_phone_hash: hashPhone("+2340000100003"),
    recipient_name: "Staging User Gamma",
    amount_ngn: 10000,
    amount_usdc: "6.0000000",
    status: "locked",
    unlock_at: future(30),
    stellar_tx_hash: "stglockedtxhash000000000000000000000000000000000000000000001",
    payment_provider: "stripe",
    payment_reference: "stg-pay-strp-001",
  },
  {
    id: "stgseed-gift-3",
    sender_id: "stgseed-user-2",
    recipient_phone_hash: hashPhone("+2340000100001"),
    recipient_name: "Staging User Alpha",
    amount_ngn: 2500,
    amount_usdc: "1.5000000",
    status: "unlocked",
    unlock_at: past(1),
    stellar_tx_hash: "stgunlockedtxhash00000000000000000000000000000000000000000001",
    payment_provider: "paystack",
    payment_reference: "stg-pay-pstk-002",
  },
  {
    id: "stgseed-gift-4",
    sender_id: "stgseed-user-2",
    recipient_phone_hash: hashPhone("+2340000100001"),
    recipient_name: "Staging User Alpha",
    amount_ngn: 7500,
    amount_usdc: "4.5000000",
    status: "claimed",
    unlock_at: past(10),
    stellar_tx_hash: "stgclaimedtxhash00000000000000000000000000000000000000000001",
    claim_tx_hash: "stgclaimtxhash000000000000000000000000000000000000000000000001",
    payment_provider: "stripe",
    payment_reference: "stg-pay-strp-002",
  },
  {
    id: "stgseed-gift-5",
    sender_id: "stgseed-user-1",
    recipient_phone_hash: hashPhone("+2340000100004"),
    recipient_name: "Staging User Delta",
    amount_ngn: 3000,
    amount_usdc: "1.8000000",
    status: "cancelled",
    unlock_at: future(14),
    payment_provider: "paystack",
    payment_reference: "stg-pay-pstk-003",
  },
  {
    id: "stgseed-gift-6",
    sender_id: "stgseed-user-3",
    recipient_phone_hash: hashPhone("+2340000100002"),
    recipient_name: "Staging User Beta",
    amount_ngn: 1000,
    amount_usdc: "0.6000000",
    status: "expired",
    unlock_at: past(90),
    stellar_tx_hash: "stgexpiredtxhash00000000000000000000000000000000000000000001",
    payment_provider: "stripe",
    payment_reference: "stg-pay-strp-003",
  },
  {
    id: "stgseed-gift-7",
    sender_id: "stgseed-user-4",
    recipient_phone_hash: hashPhone("+2340000100001"),
    recipient_name: "Staging User Alpha",
    amount_ngn: 20000,
    amount_usdc: "12.0000000",
    status: "locked",
    unlock_at: future(45),
    stellar_tx_hash: "stglockedtxhash000000000000000000000000000000000000000000002",
    payment_provider: "paystack",
    payment_reference: "stg-pay-pstk-004",
  },
];

// ─── Gift invitations ─────────────────────────────────────────────────────────

const INVITATIONS = [
  {
    id: "stgseed-inv-1",
    gift_id: "stgseed-gift-3",
    recipient_phone_hash: hashPhone("+2340000100001"),
    recipient_phone: "+2340000100001",
    token: "stg-token-abc123def456ghi789jkl",
    status: "pending",
    expires_at: future(7),
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seed() {
  const pool = new Pool({ connectionString: DB_URL });

  try {
    console.log("🌱 Starting staging seed…");
    console.log(`   DB: ${DB_URL.replace(/:\/\/[^@]+@/, "://<credentials>@")}`);

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
        CONSTRAINT fk_stg_gift_invitations_gift_id FOREIGN KEY (gift_id)
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

    // ── Idempotent wipe of stgseed rows only ─────────────────────────────────
    await pool.query(`DELETE FROM gift_invitations WHERE id LIKE 'stgseed-%'`);
    await pool.query(`DELETE FROM gifts WHERE id LIKE 'stgseed-%'`);
    await pool.query(`DELETE FROM users WHERE id LIKE 'stgseed-%'`);

    // ── Users ─────────────────────────────────────────────────────────────────
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

    // ── Invitations ───────────────────────────────────────────────────────────
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

    console.log(`✓ Staged seed complete:`);
    console.log(`  users:       ${USERS.length} (all use +2340000XXXXX safe range)`);
    console.log(`  gifts:       ${GIFTS.length} (${JSON.stringify(statusCounts)})`);
    console.log(`  invitations: ${INVITATIONS.length}`);
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error("Staging seed failed:", err);
  process.exit(1);
});
