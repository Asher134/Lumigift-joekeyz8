/**
 * Signed claim tokens for SMS deep links (Issue #366).
 *
 * Format: `base64url(giftId.expiresAtMs).base64url(hmacSha256)` — stateless, so
 * the SMS link `/claim?token=…` can be verified without a database lookup.
 */

import crypto from "crypto";
import { serverConfig } from "@/server/config";

/** Default claim link lifetime — 30 days. */
export const CLAIM_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ClaimTokenResult =
  { valid: true; giftId: string } | { valid: false; reason: "invalid" | "expired" };

function sign(payload: string): string {
  return crypto.createHmac("sha256", serverConfig.auth.secret).update(payload).digest("base64url");
}

/** Create a claim token for `giftId`, used to build the SMS claim link. */
export function createClaimToken(giftId: string, now = Date.now()): string {
  const payload = Buffer.from(`${giftId}.${now + CLAIM_TOKEN_TTL_MS}`).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Verify a claim token's signature and expiry. */
export function verifyClaimToken(token: string, now = Date.now()): ClaimTokenResult {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return { valid: false, reason: "invalid" };

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { valid: false, reason: "invalid" };
  }

  const [giftId, expiresAt] = Buffer.from(payload, "base64url").toString().split(".");
  if (!giftId || !Number(expiresAt)) return { valid: false, reason: "invalid" };
  if (Number(expiresAt) < now) return { valid: false, reason: "expired" };

  return { valid: true, giftId };
}
