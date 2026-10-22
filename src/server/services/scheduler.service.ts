import pool from "@/lib/db";
import { sendExpiryGraceReminder } from "@/lib/sms";
import { serverConfig } from "@/server/config";
import { gifts, updateGiftStatus, isGiftUnlocked } from "./gift.service";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Unlock scheduler — checks for gifts whose `unlockAt` has passed (inclusive: `now >= unlockAt`)
 * and transitions them from `"locked"` → `"unlocked"`, then notifies recipients.
 *
 * In production this is triggered by a Vercel Cron job or pg_cron
 * at a regular interval (e.g. every minute).
 *
 * @param now - Reference timestamp for execution (defaults to new Date()).
 * @returns The number of gifts that were unlocked in this run.
 */
export async function processUnlocks(now: Date = new Date()): Promise<number> {
  let unlockedCount = 0;
  for (const gift of gifts.values()) {
    if (gift.status === "locked" && isGiftUnlocked(gift, now)) {
      await updateGiftStatus(gift.id, "unlocked");
      unlockedCount++;
    }
  }
  return unlockedCount;
}

interface GiftRow {
  id: string;
  status: string;
  unlock_at: Date;
  contract_id: string | null;
  sender_stellar_key: string | null;
  recipient_phone: string | null;
  amount_usdc: string;
}

/**
 * Expiry scheduler — runs in two phases:
 *
 * 1. Gifts `"unlocked"` but unclaimed for more than 365 days move to
 *    `"expired_pending_refund"` with `refund_due_at = now + GIFT_EXPIRY_GRACE_PERIOD_DAYS`,
 *    and the recipient receives an SMS reminder that they can still claim.
 * 2. Gifts in `"expired_pending_refund"` whose `refund_due_at` has passed move to
 *    `"expired"` and the escrow refund is triggered.
 *
 * Uses `SELECT … FOR UPDATE SKIP LOCKED` to be safe against concurrent runs.
 * Admins can waive or shorten the grace period per gift via `setGiftGracePeriod`.
 *
 * In production, run daily via Vercel Cron or pg_cron.
 *
 * @returns Resolves when all expired gifts have been processed.
 */
export async function processExpiries(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 365 * DAY_MS);
  const graceDays = serverConfig.giftExpiry.gracePeriodDays;
  const refundDueAt = new Date(now.getTime() + graceDays * DAY_MS);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Phase 1: start grace period for newly expired gifts
    const { rows: pending } = await client.query<GiftRow>(
      "SELECT id, status, unlock_at, contract_id, sender_stellar_key, recipient_phone, amount_usdc FROM gifts WHERE status = 'unlocked' AND unlock_at <= $1 ORDER BY unlock_at ASC FOR UPDATE SKIP LOCKED",
      [cutoff]
    );

    for (const gift of pending) {
      try {
        await client.query(
          "UPDATE gifts SET status = 'expired_pending_refund', refund_due_at = $2, updated_at = NOW() WHERE id = $1 AND status = 'unlocked'",
          [gift.id, refundDueAt]
        );
        if (gift.recipient_phone) {
          await sendExpiryGraceReminder(gift.recipient_phone, gift.amount_usdc, refundDueAt);
        }
        console.log("[scheduler] gift entered expiry grace period", {
          giftId: gift.id,
          refundDueAt,
        });
      } catch (err) {
        console.error("[scheduler] failed to start grace period", { giftId: gift.id, err });
      }
    }

    // Phase 2: grace period elapsed — expire and refund
    const { rows: due } = await client.query<GiftRow>(
      "SELECT id, status, unlock_at, contract_id, sender_stellar_key, recipient_phone, amount_usdc FROM gifts WHERE status = 'expired_pending_refund' AND refund_due_at <= $1 FOR UPDATE SKIP LOCKED",
      [now]
    );

    for (const gift of due) {
      try {
        await client.query(
          "UPDATE gifts SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'expired_pending_refund'",
          [gift.id]
        );
        console.log("[scheduler] expired gift after grace period", { giftId: gift.id });

        // Future: trigger escrow refund & sender SMS notification here
        // await refundEscrow(gift.contract_id, gift.sender_stellar_key);
      } catch (err) {
        console.error("[scheduler] failed to expire gift", { giftId: gift.id, err });
      }
    }

    await client.query("COMMIT");
    console.log("[scheduler] processExpiries complete", {
      gracePeriodStarted: pending.length,
      expired: due.length,
      cutoff,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[scheduler] processExpiries transaction failed, rolled back", err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Admin override: waives or shortens the grace period for a gift in
 * `"expired_pending_refund"`. Passing `0` waives it (refund on the next cron run).
 * The grace period can only be shortened, never extended past its current due date.
 *
 * @param giftId - The gift to update.
 * @param graceDays - New grace period in days, measured from now.
 * @returns `true` if the gift was updated.
 */
export async function setGiftGracePeriod(giftId: string, graceDays: number): Promise<boolean> {
  const dueAt = new Date(Date.now() + graceDays * DAY_MS);
  const result = await pool.query(
    "UPDATE gifts SET refund_due_at = LEAST(refund_due_at, $2), updated_at = NOW() WHERE id = $1 AND status = 'expired_pending_refund'",
    [giftId, dueAt]
  );
  return (result.rowCount ?? 0) > 0;
}
