import { verifyOtp } from "@/lib/otp";
import { AppError } from "@/server/errors";
import { getGiftsByRecipient } from "./gift.service";
import type { GiftStatus } from "@/types";

/**
 * Recipient claim discovery (Issue #148).
 *
 * Lets a recipient find gifts addressed to their phone number without the
 * endpoint becoming an oracle for "does a gift exist for number X?":
 *
 *  - Nothing is returned until the caller proves control of the phone with a
 *    one-time password.
 *  - Every verification failure (wrong code, expired code, no code ever issued,
 *    too many attempts, malformed phone) produces the *same* error, so a caller
 *    cannot tell an unknown number from a wrong one.
 *  - A verified number with no gifts gets the same success shape as one with
 *    gifts — just an empty list.
 *  - Only funded, claimable-lifecycle gifts are listed, and locked amounts stay
 *    hidden, matching the recipient view in GiftCard.
 */

export const VERIFICATION_FAILED_MESSAGE =
  "We couldn't verify that code. Check the number and code, then try again.";

/** Gift statuses a recipient can see — unpaid, cancelled and expired gifts are never revealed. */
const DISCOVERABLE_STATUSES: ReadonlySet<GiftStatus> = new Set<GiftStatus>([
  "funded",
  "locked",
  "unlocked",
]);

/** The minimal, recipient-safe projection of a gift. */
export interface DiscoveredGift {
  id: string;
  recipientName: string;
  status: GiftStatus;
  unlockAt: Date;
  /** Omitted while the gift is still locked to preserve the surprise. */
  amountNgn?: number;
}

export function verificationFailed(): AppError {
  return new AppError("VERIFICATION_FAILED", VERIFICATION_FAILED_MESSAGE, 401);
}

/**
 * Verifies the OTP for `phone` and returns the gifts waiting for it.
 *
 * @param phone - E.164 phone number (already normalised by the caller).
 * @param otp - The code sent to `phone` via `POST /api/v1/auth/send-otp`.
 * @throws {@link AppError} `VERIFICATION_FAILED` (401) on any verification failure.
 */
export async function discoverGiftsForRecipient(
  phone: string,
  otp: string
): Promise<DiscoveredGift[]> {
  const result = await verifyOtp(phone, otp);
  if (!result.success) throw verificationFailed();

  const gifts = await getGiftsByRecipient(phone);
  return gifts
    .filter((g) => DISCOVERABLE_STATUSES.has(g.status))
    .sort((a, b) => a.unlockAt.getTime() - b.unlockAt.getTime())
    .map((g) => ({
      id: g.id,
      recipientName: g.recipientName,
      status: g.status,
      unlockAt: g.unlockAt,
      ...(g.status === "unlocked" ? { amountNgn: g.amountNgn } : {}),
    }));
}
