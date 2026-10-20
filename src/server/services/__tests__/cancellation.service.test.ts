/**
 * @jest-environment node
 *
 * Unit tests for src/server/services/cancellation.service.ts (Issue #147).
 */

import type { Gift } from "@/types";

jest.mock("@/lib/paystack", () => ({ refundPayment: jest.fn() }));
jest.mock("../gift.service", () => ({ cancelGift: jest.fn() }));

import {
  cancelGiftForSender,
  getCancellationEligibility,
  mapProviderRefundStatus,
} from "../cancellation.service";
import { refundPayment } from "@/lib/paystack";
import { cancelGift } from "../gift.service";
import { AppError } from "@/server/errors";

const mockRefund = refundPayment as jest.Mock;
const mockCancel = cancelGift as jest.Mock;

function makeGift(overrides: Partial<Gift> = {}): Gift {
  return {
    id: "gift-1",
    senderId: "sender-1",
    recipientPhoneHash: "hash",
    recipientName: "Ada",
    amountNgn: 5000,
    amountUsdc: "3.0000000",
    unlockAt: new Date(Date.now() + 86_400_000),
    status: "locked",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("getCancellationEligibility — mirrors escrow contract cancel()", () => {
  it.each(["draft", "pending_payment", "funded", "locked", "unlocked"] as const)(
    "%s is cancellable",
    (status) => {
      expect(getCancellationEligibility(makeGift({ status })).eligible).toBe(true);
    }
  );

  it("allows cancellation after the unlock time (contract has no time check)", () => {
    const gift = makeGift({ status: "unlocked", unlockAt: new Date(Date.now() - 1000) });
    const result = getCancellationEligibility(gift);
    expect(result.eligible).toBe(true);
    expect(result.consequences.join(" ")).toMatch(/already unlocked/);
  });

  it.each([
    ["claimed", /already been claimed/],
    ["cancelled", /already been cancelled/],
    ["expired", /expired/],
  ] as const)("%s is not cancellable and explains why", (status, reason) => {
    const result = getCancellationEligibility(makeGift({ status }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(reason);
    expect(result.supportUrl).toBeTruthy();
  });

  it("requires a refund only once payment has been captured", () => {
    expect(getCancellationEligibility(makeGift({ status: "pending_payment" })).refundRequired).toBe(
      false
    );
    expect(getCancellationEligibility(makeGift({ status: "funded" })).refundRequired).toBe(true);
  });
});

describe("mapProviderRefundStatus", () => {
  it.each([
    ["processed", "processed"],
    ["failed", "failed"],
    ["needs-attention", "failed"],
    ["pending", "pending"],
    ["processing", "pending"],
  ])("%s → %s", (provider, expected) => {
    expect(mapProviderRefundStatus(provider)).toBe(expected);
  });
});

describe("cancelGiftForSender", () => {
  it("cancels an unpaid gift without calling the payment provider", async () => {
    const gift = makeGift({ status: "pending_payment" });
    mockCancel.mockResolvedValue({ ...gift, status: "cancelled", refundStatus: "not_required" });

    await cancelGiftForSender(gift);

    expect(mockRefund).not.toHaveBeenCalled();
    expect(mockCancel).toHaveBeenCalledWith("gift-1", "not_required");
  });

  it("refunds a paid gift and records the provider's refund status", async () => {
    const gift = makeGift({ status: "locked" });
    mockRefund.mockResolvedValue({ status: "pending" });
    mockCancel.mockResolvedValue({ ...gift, status: "cancelled", refundStatus: "pending" });

    const result = await cancelGiftForSender(gift);

    expect(mockRefund).toHaveBeenCalledWith("lumigift_gift-1");
    expect(mockCancel).toHaveBeenCalledWith("gift-1", "pending");
    expect(result.refundStatus).toBe("pending");
  });

  it("leaves the gift active when the refund request fails", async () => {
    mockRefund.mockRejectedValue(new Error("paystack down"));

    await expect(cancelGiftForSender(makeGift({ status: "funded" }))).rejects.toMatchObject({
      code: "REFUND_FAILED",
      httpStatus: 502,
    });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("rejects ineligible gifts with GIFT_NOT_CANCELLABLE", async () => {
    const err = await cancelGiftForSender(makeGift({ status: "claimed" })).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("GIFT_NOT_CANCELLABLE");
    expect(err.httpStatus).toBe(409);
    expect(mockRefund).not.toHaveBeenCalled();
  });
});
