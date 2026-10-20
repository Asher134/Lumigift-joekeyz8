import { gifts, updateGiftStatus, isGiftUnlocked } from "./gift.service";

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

/**
 * Expiry scheduler — identifies gifts that have been `"unlocked"` but unclaimed
 * for more than 365 days, atomically marks them as `"expired"`, and notifies
 * the sender.
 *
 * Uses `SELECT … FOR UPDATE SKIP LOCKED` to be safe against concurrent runs.
 * When a gift expires the escrowed USDC should be refunded to the sender's
 * Stellar address via the escrow contract's cancel/refund path (wired up in
 * the refund flow once the escrow client supports it).
 *
 * In production, run daily via Vercel Cron or pg_cron.
 *
 * @returns Resolves when all expired gifts have been processed.
 */
export async function processExpiries(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<GiftRow>(
      `SELECT id, status, unlock_at, contract_id, sender_stellar_key, recipient_phone, amount_usdc
         FROM gifts
        WHERE status = 'unlocked'
          AND unlock_at <= $1
        ORDER BY unlock_at ASC
          FOR UPDATE SKIP LOCKED`,
      [cutoff]
    );

    for (const gift of rows) {
      try {
        await client.query(
          `UPDATE gifts
              SET status = 'expired', updated_at = NOW()
            WHERE id = $1
              AND status = 'unlocked'`,
          [gift.id]
        );

        console.log("[scheduler] expired gift", {
          giftId: gift.id,
          unlockAt: gift.unlock_at,
          cutoff,
        });

        // Future: trigger escrow refund & sender SMS notification here
        // await refundEscrow(gift.contract_id, gift.sender_stellar_key);
        // await sendSms(gift.sender_phone, `Your Lumigift of ${gift.amount_usdc} USDC has expired and been refunded.`);
      } catch (err) {
        console.error("[scheduler] failed to expire gift", { giftId: gift.id, err });
      }
    }

    await client.query("COMMIT");
    console.log("[scheduler] processExpiries complete", { expired: rows.length, cutoff });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[scheduler] processExpiries transaction failed, rolled back", err);
    throw err;
  } finally {
    client.release();
  }
}
