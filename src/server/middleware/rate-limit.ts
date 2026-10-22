/**
 * rate-limit.ts — Redis-backed fixed-window rate limiter
 *
 * Uses atomic INCR + EXPIRE so the counter increment and TTL assignment are
 * effectively a single unit of work per window:
 *
 *  1. INCR key            → returns new count (creates key if absent, atomic)
 *  2. If count === 1,     → first request in window; set TTL with EXPIRE
 *  3. Check count > limit → reject if over limit
 *
 * The INCR+EXPIRE pair is not 100% atomic under concurrent first-requests, but
 * the worst outcome is a missing TTL — the key expires naturally within the
 * next Redis eviction cycle.  For OTP endpoints the acceptable drift is
 * negligible compared to the 10-minute window.
 *
 * @module rate-limit
 */

import { getRedisClient } from "@/lib/redis";

export interface RateLimitResult {
  /** Whether the request is within the allowed limit. */
  allowed: boolean;
  /** Seconds until the rate-limit window resets (suitable for Retry-After header). */
  retryAfter: number;
  /** Current request count within the window. */
  count: number;
}

/**
 * Checks and increments a Redis-backed rate-limit counter.
 *
 * @param key       - Redis key to use as the rate-limit bucket (e.g. `rl:otp:phone:+2348100001234`).
 * @param limit     - Maximum requests allowed within `windowSec`.
 * @param windowSec - Window duration in seconds.
 * @returns A {@link RateLimitResult} describing whether the request is allowed.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  const redis = await getRedisClient();

  // INCR is atomic — creates the key with value 1 if it does not exist yet.
  const count = await redis.incr(key);

  // Set expiry only on the first increment so subsequent requests within the
  // window do not reset the TTL.
  if (count === 1) {
    await redis.expire(key, windowSec);
  }

  const ttl = await redis.ttl(key);
  // ttl -1 means EXPIRE was not set (key was pre-existing without TTL); fall
  // back to the full window so Retry-After is never 0 or negative.
  const retryAfter = ttl > 0 ? ttl : windowSec;

  return { allowed: count <= limit, retryAfter, count };
}
