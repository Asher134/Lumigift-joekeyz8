import { refundPayment } from "@/lib/paystack";
import { AppError } from "@/server/errors";
import { cancelGift } from "./gift.service";
import type { Gift, GiftStatus, RefundStatus } from "@/types";

/**
 * Gift cancellation policy (Issue #147).
 *
 * Eligibility mirrors the escrow contract's `cancel` entry point
 * (contracts/escrow/src/lib.rs): the sender may cancel at any time until the
 * escrow is claimed or already cancelled. There is no unlock-time restriction
 * on-chain, so there is none here either. Off-chain-only statuses are mapped
 * to the nearest on-chain equivalent:
 *
 * | Gift status       | Contract state       | Cancellable | Refund       |
 * | ----------------- | -------------------- | ----------- | ------------ |
 * | draft             | not initialised      | yes         | not_required |
 * | pending_payment   | not initialised      | yes         | not_required |
 * | funded            | Locked               | yes         | pending      |
 * | locked            | Locked               | yes         | pending      |
 * | unlocked          | Unlocked             | yes         | pending      |
 * | claimed           | Claimed (terminal)   | no          | —            |
 * | cancelled         | Cancelled (terminal) | no          | —            |
 * | expired           | refunded by cron     | no          | —            |
 *
 * See docs/product/gift-cancellation-policy.md for the user-facing copy.
 */

export const SUPPORT_URL = "/help#cancellation-policy";

/** Statuses from which the sender may cancel. */
export const CANCELLABLE_STATUSES: ReadonlySet<GiftStatus> = new Set<GiftStatus>([
  "draft",
  "pending_payment",
  "funded",
  "locked",
  "unlocked",
]);

/** Statuses where the sender's payment has been captured and must be refunded. */
const PAID_STATUSES: ReadonlySet<GiftStatus> = new Set<GiftStatus>([
  "funded",
  "locked",
  "unlocked",
]);

const INELIGIBLE_REASONS: Partial<Record<GiftStatus, string>> = {
  claimed: "This gift has already been claimed by the recipient.",
  cancelled: "This gift has already been cancelled.",
  expired: "This gift has expired and is refunded automatically.",
};

export interface CancellationEligibility {
  eligible: boolean;
  /** Why the gift cannot be cancelled — present only when `eligible` is false. */
  reason?: string;
  /** Whether a refund will be issued if the sender cancels. */
  refundRequired: boolean;
  /** Plain-language consequences shown in the confirmation dialog. */
  consequences: string[];
  supportUrl: string;
}

/**
 * Describes whether a gift may be cancelled and what will happen if it is.
 * Pure — performs no I/O, so the UI and API share the same rules.
 */
export function getCancellationEligibility(gift: Gift): CancellationEligibility {
  if (!CANCELLABLE_STATUSES.has(gift.status)) {
    return {
      eligible: false,
      reason: INELIGIBLE_REASONS[gift.status] ?? "This gift cannot be cancelled.",
      refundRequired: false,
      consequences: [],
      supportUrl: SUPPORT_URL,
    };
  }

  const refundRequired = PAID_STATUSES.has(gift.status);
  const consequences = [
    `${gift.recipientName} will no longer be able to claim this gift.`,
    "Cancellation is permanent and cannot be undone.",
  ];
  if (refundRequired) {
    consequences.push(
      "Your payment will be refunded to the original payment method. Refunds usually settle within 3–5 business days.",
      "Payment processing fees may not be refundable."
    );
  } else {
    consequences.push("No payment was taken, so there is nothing to refund.");
  }
  if (gift.status === "unlocked") {
    consequences.push("This gift is already unlocked — the recipient may be about to claim it.");
  }

  return { eligible: true, refundRequired, consequences, supportUrl: SUPPORT_URL };
}

/** Maps a Paystack refund status onto our {@link RefundStatus}. */
export function mapProviderRefundStatus(status: string): RefundStatus {
  switch (status) {
    case "processed":
      return "processed";
    case "failed":
    case "needs-attention":
      return "failed";
    default:
      return "pending";
  }
}

/**
 * Cancels a gift on behalf of its sender, refunding the payment if one was
 * captured. Ownership must already have been checked by the caller.
 *
 * The refund is requested *before* the status change: if the provider call
 * throws, the gift stays active so the sender can retry or contact support
 * instead of ending up cancelled with no refund in flight.
 *
 * @throws {@link AppError} `GIFT_NOT_CANCELLABLE` (409) when ineligible.
 * @throws {@link AppError} `REFUND_FAILED` (502) when the provider rejects the refund request.
 */
export async function cancelGiftForSender(gift: Gift): Promise<Gift> {
  const eligibility = getCancellationEligibility(gift);
  if (!eligibility.eligible) {
    throw new AppError("GIFT_NOT_CANCELLABLE", eligibility.reason!, 409);
  }

  let refundStatus: RefundStatus = "not_required";
  if (eligibility.refundRequired) {
    try {
      // Reference convention matches gift creation
      const { status } = await refundPayment(`lumigift_${gift.id}`);
      refundStatus = mapProviderRefundStatus(status);
    } catch (err) {
      throw new AppError(
        "REFUND_FAILED",
        "We couldn't start your refund, so the gift has not been cancelled. Please try again or contact support.",
        502,
        err
      );
    }
  }

  const cancelled = await cancelGift(gift.id, refundStatus);
  if (!cancelled) throw new AppError("GIFT_NOT_FOUND", "Gift not found", 404);
  return cancelled;
}
