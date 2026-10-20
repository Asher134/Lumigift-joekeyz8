/**
 * @jest-environment node
 *
 * Unit tests for timestamp boundary semantics parity across Smart Contract and Backend.
 *
 * Acceptance Criteria:
 * - Boundary behavior is documented
 * - Backend uses the same inclusive rule: claim is valid exactly at unlockAt (now >= unlockAt)
 */

import { isGiftUnlocked, gifts, createGift } from "../gift.service";
import { processUnlocks } from "../scheduler.service";
import type { Gift } from "@/types";

describe("Timestamp Boundary Semantics", () => {
  const baseTime = new Date("2026-10-01T12:00:00.000Z").getTime();
  const unlockAt = new Date("2026-10-01T12:00:00.000Z");

  describe("isGiftUnlocked (Canonical Inclusive Boundary Rule)", () => {
    it("returns false when now is 1 millisecond before unlockAt (now < unlockAt)", () => {
      const now = new Date(baseTime - 1);
      expect(isGiftUnlocked({ unlockAt }, now)).toBe(false);
    });

    it("returns false when now is 1 second before unlockAt (now < unlockAt)", () => {
      const now = new Date(baseTime - 1000);
      expect(isGiftUnlocked({ unlockAt }, now)).toBe(false);
    });

    it("returns TRUE when now is EXACTLY at unlockAt (now == unlockAt) — inclusive boundary", () => {
      const now = new Date(baseTime);
      expect(isGiftUnlocked({ unlockAt }, now)).toBe(true);
    });

    it("returns true when now is 1 millisecond after unlockAt (now > unlockAt)", () => {
      const now = new Date(baseTime + 1);
      expect(isGiftUnlocked({ unlockAt }, now)).toBe(true);
    });

    it("returns true when now is 1 second after unlockAt (now > unlockAt)", () => {
      const now = new Date(baseTime + 1000);
      expect(isGiftUnlocked({ unlockAt }, now)).toBe(true);
    });

    it("supports ISO string dates as unlockAt input", () => {
      const gift = { unlockAt: "2026-10-01T12:00:00.000Z" };
      expect(isGiftUnlocked(gift, new Date(baseTime - 1))).toBe(false);
      expect(isGiftUnlocked(gift, new Date(baseTime))).toBe(true);
      expect(isGiftUnlocked(gift, new Date(baseTime + 1))).toBe(true);
    });

    it("supports numeric epoch millisecond timestamps", () => {
      const gift = { unlockAt: baseTime };
      expect(isGiftUnlocked(gift, baseTime - 1)).toBe(false);
      expect(isGiftUnlocked(gift, baseTime)).toBe(true);
      expect(isGiftUnlocked(gift, baseTime + 1)).toBe(true);
    });
  });

  describe("Scheduler processUnlocks with Boundary Semantics", () => {
    beforeEach(() => {
      gifts.clear();
    });

    it("does not unlock gifts when scheduler runs 1ms before unlockAt", async () => {
      const giftId = "gift-boundary-1";
      const gift: Gift = {
        id: giftId,
        senderId: "user-1",
        recipientPhoneHash: "hash123",
        recipientName: "Test User",
        amountNgn: 5000,
        amountUsdc: "3.0000000",
        unlockAt,
        status: "locked",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      gifts.set(giftId, gift);

      const count = await processUnlocks(new Date(baseTime - 1));
      expect(count).toBe(0);
      expect(gifts.get(giftId)?.status).toBe("locked");
    });

    it("unlocks gifts when scheduler runs EXACTLY at unlockAt (inclusive)", async () => {
      const giftId = "gift-boundary-2";
      const gift: Gift = {
        id: giftId,
        senderId: "user-1",
        recipientPhoneHash: "hash123",
        recipientName: "Test User",
        amountNgn: 5000,
        amountUsdc: "3.0000000",
        unlockAt,
        status: "locked",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      gifts.set(giftId, gift);

      const count = await processUnlocks(new Date(baseTime));
      expect(count).toBe(1);
      expect(gifts.get(giftId)?.status).toBe("unlocked");
    });

    it("unlocks gifts when scheduler runs after unlockAt", async () => {
      const giftId = "gift-boundary-3";
      const gift: Gift = {
        id: giftId,
        senderId: "user-1",
        recipientPhoneHash: "hash123",
        recipientName: "Test User",
        amountNgn: 5000,
        amountUsdc: "3.0000000",
        unlockAt,
        status: "locked",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      gifts.set(giftId, gift);

      const count = await processUnlocks(new Date(baseTime + 1000));
      expect(count).toBe(1);
      expect(gifts.get(giftId)?.status).toBe("unlocked");
    });
  });
});
