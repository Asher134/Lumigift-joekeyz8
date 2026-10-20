/**
 * @jest-environment node
 *
 * Unit tests for src/server/services/claim-discovery.service.ts (Issue #148).
 */

import type { Gift } from "@/types";

jest.mock("@/lib/otp", () => ({ verifyOtp: jest.fn() }));
jest.mock("../gift.service", () => ({ getGiftsByRecipient: jest.fn() }));

import { discoverGiftsForRecipient, VERIFICATION_FAILED_MESSAGE } from "../claim-discovery.service";
import { verifyOtp } from "@/lib/otp";
import { getGiftsByRecipient } from "../gift.service";

const mockVerify = verifyOtp as jest.Mock;
const mockByRecipient = getGiftsByRecipient as jest.Mock;

function makeGift(overrides: Partial<Gift> = {}): Gift {
  return {
    id: "gift-1",
    senderId: "sender-1",
    recipientPhoneHash: "hash",
    recipientName: "Ada",
    amountNgn: 5000,
    amountUsdc: "3.0000000",
    message: "Happy birthday",
    unlockAt: new Date(Date.now() + 86_400_000),
    status: "locked",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("discoverGiftsForRecipient", () => {
  it("requires OTP verification before looking up any gift", async () => {
    mockVerify.mockResolvedValue({ success: false, locked: false, message: "Invalid OTP." });

    await expect(discoverGiftsForRecipient("+2348012345678", "000000")).rejects.toMatchObject({
      code: "VERIFICATION_FAILED",
      httpStatus: 401,
    });
    expect(mockByRecipient).not.toHaveBeenCalled();
  });

  it("returns the same error for wrong code, expired code, and lockout", async () => {
    const failures = [
      { success: false, locked: false, message: "Invalid OTP." },
      {
        success: false,
        locked: false,
        message: "OTP expired or not found. Please request a new one.",
      },
      {
        success: false,
        locked: true,
        message: "Too many failed attempts. Please request a new OTP.",
      },
    ];
    const errors = [];
    for (const f of failures) {
      mockVerify.mockResolvedValueOnce(f);
      errors.push(await discoverGiftsForRecipient("+2348012345678", "123456").catch((e) => e));
    }
    for (const e of errors) {
      expect(e.message).toBe(VERIFICATION_FAILED_MESSAGE);
      expect(e.httpStatus).toBe(401);
    }
  });

  it("returns an empty list (same shape) for a verified number with no gifts", async () => {
    mockVerify.mockResolvedValue({ success: true });
    mockByRecipient.mockResolvedValue([]);

    await expect(discoverGiftsForRecipient("+2348012345678", "123456")).resolves.toEqual([]);
  });

  it("hides unpaid, cancelled and expired gifts and locked amounts", async () => {
    mockVerify.mockResolvedValue({ success: true });
    mockByRecipient.mockResolvedValue([
      makeGift({ id: "locked", status: "locked" }),
      makeGift({ id: "unlocked", status: "unlocked", unlockAt: new Date(Date.now() - 1000) }),
      makeGift({ id: "unpaid", status: "pending_payment" }),
      makeGift({ id: "cancelled", status: "cancelled" }),
      makeGift({ id: "expired", status: "expired" }),
    ]);

    const result = await discoverGiftsForRecipient("+2348012345678", "123456");

    expect(result.map((g) => g.id)).toEqual(["unlocked", "locked"]);
    expect(result.find((g) => g.id === "locked")).not.toHaveProperty("amountNgn");
    expect(result.find((g) => g.id === "unlocked")?.amountNgn).toBe(5000);
    for (const g of result) {
      expect(g).not.toHaveProperty("senderId");
      expect(g).not.toHaveProperty("message");
      expect(g).not.toHaveProperty("recipientPhoneHash");
    }
  });
});
