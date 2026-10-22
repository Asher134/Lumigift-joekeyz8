import { randomUUID } from "crypto";
import pool from "@/lib/db";
import { getRedisClient } from "@/lib/redis";

const LOCK_TTL_MS = 30_000;

/**
 * Unlocks a single gift exactly once, even under concurrent cron runs or retries.
 *
 * Guards (in order):
 *   1. Redis distributed lock (`SET NX PX`) — primary guard across workers.
 *   2. Postgres row-level lock (`SELECT … FOR UPDATE`) — re-checks status inside
 *      a transaction so a lost/expired Redis lock can never double-submit.
 *
 * @param giftId   - Gift to unlock.
 * @param submitTx - Submits the Stellar unlock transaction; returns its hash.
 * @returns `true` if this call performed the unlock, `false` if skipped.
 */
export async function unlockGiftOnce(
  giftId: string,
  submitTx: (_giftId: string) => Promise<string>
): Promise<boolean> {
  const redis = await getRedisClient();
  const lockKey = `lock:gift-unlock:${giftId}`;
  const token = randomUUID();

  const acquired = await redis.set(lockKey, token, { NX: true, PX: LOCK_TTL_MS });
  if (acquired !== "OK") return false;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ status: string }>(
      "SELECT status FROM gifts WHERE id = $1 FOR UPDATE",
      [giftId]
    );
    if (rows[0]?.status !== "locked") {
      await client.query("ROLLBACK");
      return false;
    }

    const txHash = await submitTx(giftId);
    await client.query(
      "UPDATE gifts SET status = 'unlocked', stellar_tx_hash = $2, updated_at = NOW() WHERE id = $1",
      [giftId, txHash]
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    if ((await redis.get(lockKey)) === token) await redis.del(lockKey);
  }
}
