import type { FeeBumpTransaction, Transaction } from "@stellar/stellar-sdk";
import pool from "@/lib/db";
import { horizonServer } from "@/lib/stellar";
import { logger } from "@/lib/logger";
import { createAuditLog } from "./audit.service";
import type { GiftStatus } from "@/types";

export interface IdempotentSubmissionParams {
  /** Stable key for the logical operation (e.g. `"fund:${giftId}"`). */
  idempotencyKey: string;
  /** Gift the transaction belongs to. */
  giftId: string;
  /** Signed transaction to submit. */
  tx: Transaction | FeeBumpTransaction;
  /** Optional gift status to set atomically alongside the hash. */
  giftStatus?: GiftStatus;
}

export interface IdempotentSubmissionResult {
  hash: string;
  /** `true` when an existing submission was found and nothing was re-submitted. */
  duplicate: boolean;
}

/** Returns `true` for errors where Horizon definitively rejected the transaction. */
function isDefinitiveRejection(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

async function audit(giftId: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    await createAuditLog({ eventType: "stellar_tx_submission", giftId, metadata });
  } catch (err) {
    logger.error({ err, giftId }, "Failed to write Stellar submission audit log");
  }
}

/**
 * Submits a Stellar transaction at most once per `idempotencyKey`.
 *
 * 1. If a non-failed submission exists in `stellar_tx_hash`, its hash is returned.
 * 2. Otherwise the signed hash is recorded atomically with the gift update
 *    (`stellar_tx_hash` + optional status) *before* submission, so a network
 *    timeout followed by a retry cannot produce a duplicate transaction.
 * 3. Every attempt is recorded in the audit log.
 *
 * @throws The underlying Horizon error if the submission fails.
 */
export async function submitTransactionIdempotent(
  params: IdempotentSubmissionParams
): Promise<IdempotentSubmissionResult> {
  const { idempotencyKey, giftId, tx, giftStatus } = params;

  const existing = await pool.query<{ tx_hash: string; status: string }>(
    "SELECT tx_hash, status FROM stellar_tx_hash WHERE idempotency_key = $1 AND status <> 'failed'",
    [idempotencyKey]
  );
  if (existing.rows[0]) {
    const { tx_hash: hash, status } = existing.rows[0];
    await pool.query(
      "UPDATE stellar_tx_hash SET attempts = attempts + 1, updated_at = NOW() WHERE idempotency_key = $1",
      [idempotencyKey]
    );
    await audit(giftId, { idempotencyKey, txHash: hash, outcome: "duplicate", status });
    return { hash, duplicate: true };
  }

  const hash = tx.hash().toString("hex");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ tx_hash: string }>(
      "INSERT INTO stellar_tx_hash (idempotency_key, gift_id, tx_hash, status) VALUES ($1, $2, $3, 'pending') ON CONFLICT (idempotency_key) DO UPDATE SET tx_hash = EXCLUDED.tx_hash, status = 'pending', attempts = stellar_tx_hash.attempts + 1, updated_at = NOW() WHERE stellar_tx_hash.status = 'failed' RETURNING tx_hash",
      [idempotencyKey, giftId, hash]
    );

    if (!inserted.rows[0]) {
      // A concurrent request recorded this submission first.
      await client.query("ROLLBACK");
      const { rows } = await pool.query<{ tx_hash: string }>(
        "SELECT tx_hash FROM stellar_tx_hash WHERE idempotency_key = $1",
        [idempotencyKey]
      );
      await audit(giftId, { idempotencyKey, txHash: rows[0]?.tx_hash, outcome: "duplicate" });
      return { hash: rows[0]?.tx_hash ?? hash, duplicate: true };
    }

    await client.query(
      "UPDATE gifts SET stellar_tx_hash = $2, status = COALESCE($3, status), updated_at = NOW() WHERE id = $1",
      [giftId, hash, giftStatus ?? null]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  try {
    await horizonServer().submitTransaction(tx);
    await pool.query(
      "UPDATE stellar_tx_hash SET status = 'submitted', updated_at = NOW() WHERE idempotency_key = $1",
      [idempotencyKey]
    );
    await audit(giftId, { idempotencyKey, txHash: hash, outcome: "submitted" });
    return { hash, duplicate: false };
  } catch (err) {
    const rejected = isDefinitiveRejection(err);
    if (rejected) {
      await pool.query(
        "UPDATE stellar_tx_hash SET status = 'failed', updated_at = NOW() WHERE idempotency_key = $1",
        [idempotencyKey]
      );
    }
    // Non-definitive errors (timeouts, 5xx) leave the row "pending" so a retry
    // returns the existing hash rather than re-submitting.
    await audit(giftId, {
      idempotencyKey,
      txHash: hash,
      outcome: rejected ? "rejected" : "unknown",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
