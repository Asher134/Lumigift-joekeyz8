import { timingSafeEqual } from "crypto";

/**
 * Returns `true` only when `authorizationHeader` is exactly `Bearer <CRON_SECRET>`.
 *
 * Fails closed: if `CRON_SECRET` is unset or empty, every request is rejected.
 * The previous inline check compared against the string `Bearer undefined`, so
 * a deployment missing the variable accepted that literal header
 * (pentest finding PT-05). Comparison is constant-time.
 */
export function isAuthorizedCronRequest(
  authorizationHeader: string | null,
  secret: string | undefined = process.env.CRON_SECRET
): boolean {
  if (!secret || !authorizationHeader) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorizationHeader);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
