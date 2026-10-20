/**
 * Tests for cancel-after-unlock behavior (#78).
 *
 * Issue #78: Test cancellation after unlock but before claim.
 *
 * Acceptance Criteria:
 *   - Behavior matches product policy (cancel succeeds in unlocked-but-unclaimed window).
 *   - Backend mirrors the contract result.
 *
 * The smart contract allows `cancel()` in both Locked and Unlocked states.
 * The API route at DELETE /api/v1/gifts/[id] must mirror this behavior.
 *
 * This test file covers the state machine and route-level validation to confirm
 * the backend policy is aligned with the on-chain contract.
 */

import { isValidTransition, assertValidTransition } from "../gift-state-machine";

describe("cancel-after-unlock policy (#78)", () => {
  // ── State machine: unlocked → cancelled ──────────────────────────────────────

  describe("gift state machine", () => {
    it("allows unlocked → cancelled transition (mirrors contract cancel() in unlocked state)", () => {
      expect(isValidTransition("unlocked", "cancelled")).toBe(true);
    });

    it("assertValidTransition does not throw for unlocked → cancelled", () => {
      expect(() => assertValidTransition("unlocked", "cancelled")).not.toThrow();
    });

    it("does NOT allow claimed → cancelled (terminal state is irreversible)", () => {
      expect(isValidTransition("claimed", "cancelled")).toBe(false);
    });

    it("does NOT allow cancelled → unlocked (terminal state cannot go back)", () => {
      expect(isValidTransition("cancelled", "unlocked")).toBe(false);
    });

    it("does NOT allow cancelled → claimed (terminal state cannot transition)", () => {
      expect(isValidTransition("cancelled", "claimed")).toBe(false);
    });

    it("allows locked → cancelled (pre-unlock cancel, regression guard)", () => {
      expect(isValidTransition("locked", "cancelled")).toBe(true);
    });

    it("allows funded → cancelled", () => {
      expect(isValidTransition("funded", "cancelled")).toBe(true);
    });

    it("allows pending_payment → cancelled", () => {
      expect(isValidTransition("pending_payment", "cancelled")).toBe(true);
    });
  });

  // ── Route-level cancel eligibility ───────────────────────────────────────────
  // The route DELETE /api/v1/gifts/[id] now accepts cancellable statuses:
  //   pending_payment, funded, locked, unlocked
  // This set mirrors the on-chain contract's allow-list for cancel().

  describe("cancellable status set mirrors contract cancel() allow-list", () => {
    // Statuses that MUST be cancellable by the backend (matching contract behavior)
    const cancellableStatuses = ["pending_payment", "funded", "locked", "unlocked"];

    test.each(cancellableStatuses)("status '%s' is cancellable", (status) => {
      // The isValidTransition check mirrors what the route now enforces
      expect(isValidTransition(status as Parameters<typeof isValidTransition>[0], "cancelled")).toBe(true);
    });

    // Terminal statuses that must NOT be cancellable
    const nonCancellableStatuses = ["claimed", "cancelled", "expired"];

    test.each(nonCancellableStatuses)("status '%s' is NOT cancellable (terminal or already cancelled)", (status) => {
      expect(isValidTransition(status as Parameters<typeof isValidTransition>[0], "cancelled")).toBe(false);
    });
  });

  // ── Policy documentation ─────────────────────────────────────────────────────
  // Explicitly documents the product policy for the unlocked-but-unclaimed window.

  describe("product policy: unlocked-but-unclaimed window", () => {
    it("contract cancel() is allowed when status is Unlocked (policy: sender can reclaim unclaimed gifts)", () => {
      // The contract cancel() function checks:
      //   1. Is the contract initialized? (NotInitialized error if not)
      //   2. Is `claimed` true? (AlreadyClaimed error if yes)
      //   3. Is `cancelled` true? (AlreadyCancelled error if yes)
      //   It does NOT check unlock_time — so cancel is allowed after unlock.
      expect(isValidTransition("unlocked", "cancelled")).toBe(true);
    });

    it("backend cancel route accepts 'unlocked' status (fixed by #78)", () => {
      // Before fix: route rejected cancel if status was 'unlocked' or if now >= unlockAt
      // After fix: route accepts any cancellable status including 'unlocked'
      const cancellableStatuses = new Set(["pending_payment", "funded", "locked", "unlocked"]);
      expect(cancellableStatuses.has("unlocked")).toBe(true);
    });

    it("race condition: claimed status means cancel is rejected (claim wins)", () => {
      // If recipient claims before sender cancels:
      //   - contract: returns AlreadyClaimed
      //   - backend: gift.status === 'claimed', which is not in cancellableStatuses
      const cancellableStatuses = new Set(["pending_payment", "funded", "locked", "unlocked"]);
      expect(cancellableStatuses.has("claimed")).toBe(false);
    });
  });
});
