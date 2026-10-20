/**
 * gift.db.ts — Database-transactional gift persistence layer
 *
 * Issue #55: Ensure gift row, payment reference, and initial status are written
 * atomically so a partial failure never leaves orphaned records.
 *
 * All public functions here use a single PostgreSQL client acquired from the
 * connection pool, wrap their writes in BEGIN/COMMIT, and roll back on any
 * error so the database is always left in a consistent state.
 *
 * Callers (gift.service.ts) call persistGiftWithPaymentRef() instead of
 * writing directly to the in-memory Map for anything that touches real data.
 */

import { randomUUID } from "crypto";
import pool from "@/lib/db";
import type { Gift, GiftStatus } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateGiftDbInput {
  id: string;
  senderId: string;
  recipientPhoneHash: string;
  recipientName: string;
  recipientEmail?: string;
  amountNgn: number;
  amountUsdc: string;
  message?: string;
  mediaUrl?: string;
  unlockAt: Date;
  /** Payment provider used for this gift */
  provider?: "paystack" | "stripe";
  /** Provider-specific payment reference (e.g. Paystack reference) */
  paymentReference: string;
}

export interface GiftDbRow {
  id: string;
  sender_id: string;
  recipient_phone_hash: string;
  recipient_name: string;
  recipient_email: string | null;
  amount_ngn: string;
  amount_usdc: string;
  message: string | null;
  media_url: string | null;
  unlock_at: Date;
  status: GiftStatus;
  contract_id: string | null;
  stellar_tx_hash: string | null;
  claim_tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

// ─── Row → Domain mapper ──────────────────────────────────────────────────────

export function rowToGift(row: GiftDbRow): Gift {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientPhoneHash: row.recipient_phone_hash,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email ?? undefined,
    amountNgn: Number(row.amount_ngn),
    amountUsdc: row.amount_usdc,
    message: row.message ?? undefined,
    mediaUrl: row.media_url ?? undefined,
    unlockAt: new Date(row.unlock_at),
    status: row.status,
    contractId: row.contract_id ?? undefined,
    stellarTxHash: row.stellar_tx_hash ?? undefined,
    claimTxHash: row.claim_tx_hash ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ─── Transactional writes ─────────────────────────────────────────────────────

/**
 * Atomically inserts a gift row **and** a corresponding payment_references row
 * inside a single PostgreSQL transaction.
 *
 * If either INSERT fails the whole transaction is rolled back, so there is no
 * risk of a gift row without a payment record or vice versa.
 *
 * A failed side effect (invitation, email) that is called *after* this function
 * returns has no impact on the persisted gift/payment records — the DB is
 * already committed and the gift is safely retryable.
 *
 * @returns The persisted {@link Gift} domain object.
 * @throws If the transaction cannot be committed.
 */
export async function persistGiftWithPaymentRef(input: CreateGiftDbInput): Promise<Gift> {
  const paymentRefId = randomUUID();
  const provider = input.provider ?? "paystack";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Insert the gift row at status = 'pending_payment'
    const { rows } = await client.query<GiftDbRow>(
      `INSERT INTO gifts (
          id, sender_id, recipient_phone_hash, recipient_name, recipient_email,
          amount_ngn, amount_usdc, message, media_url, unlock_at,
          status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          'pending_payment', NOW(), NOW()
        )
        RETURNING *`,
      [
        input.id,
        input.senderId,
        input.recipientPhoneHash,
        input.recipientName,
        input.recipientEmail ?? null,
        input.amountNgn,
        input.amountUsdc,
        input.message ?? null,
        input.mediaUrl ?? null,
        input.unlockAt,
      ]
    );

    // 2. Insert the payment reference row in the same transaction
    await client.query(
      `INSERT INTO payment_references (
          id, gift_id, provider, reference, status, amount_ngn, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, 'pending', $5, NOW(), NOW()
        )`,
      [paymentRefId, input.id, provider, input.paymentReference, input.amountNgn]
    );

    await client.query("COMMIT");

    return rowToGift(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[gift.db] persistGiftWithPaymentRef transaction rolled back", {
      giftId: input.id,
      err,
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Atomically transitions a gift's status and updates the associated
 * payment_references row, all inside a single transaction.
 *
 * A status guard (`AND status = $2`) prevents double-transitions:
 * if another process already moved the gift forward, the UPDATE returns 0 rows
 * and this call returns `null` (treated as a no-op by callers).
 *
 * @param id - Gift UUID.
 * @param fromStatus - The expected current status (optimistic lock guard).
 * @param toStatus - The desired target status.
 * @param paymentStatus - Optional payment_references status update.
 * @returns The updated {@link Gift}, or `null` if the guard failed.
 */
export async function transitionGiftStatus(
  id: string,
  fromStatus: GiftStatus,
  toStatus: GiftStatus,
  paymentStatus?: "success" | "failed" | "refunded"
): Promise<Gift | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Status-guarded UPDATE — no-op if the gift is already in a different state
    const { rows } = await client.query<GiftDbRow>(
      `UPDATE gifts
          SET status = $1, updated_at = NOW()
        WHERE id = $2
          AND status = $3
        RETURNING *`,
      [toStatus, id, fromStatus]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    if (paymentStatus) {
      await client.query(
        `UPDATE payment_references
            SET status = $1, updated_at = NOW()
          WHERE gift_id = $2`,
        [paymentStatus, id]
      );
    }

    await client.query("COMMIT");
    return rowToGift(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[gift.db] transitionGiftStatus transaction rolled back", { id, err });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Looks up a gift row by ID.
 *
 * @param id - Gift UUID.
 * @returns The {@link Gift} domain object, or `null` if not found.
 */
export async function findGiftById(id: string): Promise<Gift | null> {
  const { rows } = await pool.query<GiftDbRow>(`SELECT * FROM gifts WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ? rowToGift(rows[0]) : null;
}

/**
 * Looks up all gifts for a given sender, newest first.
 *
 * @param senderId - User ID of the sender.
 * @returns Array of {@link Gift} domain objects (may be empty).
 */
export async function findGiftsBySender(senderId: string): Promise<Gift[]> {
  const { rows } = await pool.query<GiftDbRow>(
    `SELECT * FROM gifts WHERE sender_id = $1 ORDER BY created_at DESC`,
    [senderId]
  );
  return rows.map(rowToGift);
}

/**
 * Looks up all gifts where the recipient's phone hash matches.
 *
 * @param recipientPhoneHash - SHA-256 hash of the E.164 phone number.
 * @returns Array of {@link Gift} domain objects (may be empty).
 */
export async function findGiftsByRecipientHash(recipientPhoneHash: string): Promise<Gift[]> {
  const { rows } = await pool.query<GiftDbRow>(
    `SELECT * FROM gifts WHERE recipient_phone_hash = $1 ORDER BY created_at DESC`,
    [recipientPhoneHash]
  );
  return rows.map(rowToGift);
}
