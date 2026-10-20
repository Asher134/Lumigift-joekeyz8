/**
 * @jest-environment node
 *
 * Unit tests for src/server/services/privacy.service.ts (Issue #145).
 */

import type { Gift } from "@/types";

const mockClient = { query: jest.fn(), release: jest.fn() };

jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));
jest.mock("@/lib/otp", () => ({ verifyOtp: jest.fn() }));
jest.mock("../audit.service", () => ({ createAuditLog: jest.fn() }));
jest.mock("../gift.service", () => ({
  getGiftsBySender: jest.fn(),
  getGiftsByRecipient: jest.fn(),
  hashPhone: (p: string) => `hash(${p})`,
  redactGiftsForErasedSender: jest.fn().mockResolvedValue(2),
}));

import pool from "@/lib/db";
import { verifyOtp } from "@/lib/otp";
import { createAuditLog } from "../audit.service";
import { getGiftsBySender, getGiftsByRecipient, redactGiftsForErasedSender } from "../gift.service";
import { deleteUserData, exportUserData } from "../privacy.service";

const mockQuery = pool.query as jest.Mock;
const mockConnect = pool.connect as jest.Mock;
const mockVerify = verifyOtp as jest.Mock;
const mockAudit = createAuditLog as jest.Mock;
const mockBySender = getGiftsBySender as jest.Mock;
const mockByRecipient = getGiftsByRecipient as jest.Mock;

const CTX = { userId: "user-1", phone: "+2348012345678", ipAddress: "1.2.3.4", userAgent: "jest" };

function makeGift(overrides: Partial<Gift> = {}): Gift {
  return {
    id: "gift-1",
    senderId: "user-1",
    recipientPhoneHash: "hash",
    recipientName: "Ada",
    amountNgn: 5000,
    amountUsdc: "3.0000000",
    unlockAt: new Date(),
    status: "claimed",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function auditEvents(): string[] {
  return mockAudit.mock.calls.map(([e]) => e.eventType);
}

function dsrInserts(): unknown[][] {
  return mockQuery.mock.calls
    .filter(([sql]) => String(sql).includes("INSERT INTO data_subject_requests"))
    .map(([, params]) => params);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  mockConnect.mockResolvedValue(mockClient);
  mockClient.query.mockResolvedValue({ rows: [] });
  mockBySender.mockResolvedValue([]);
  mockByRecipient.mockResolvedValue([]);
});

describe("exportUserData", () => {
  it("returns the user's data, strips other people's identifiers, and audits the request", async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes("FROM users") ? { rows: [{ id: "user-1", phone: CTX.phone }] } : { rows: [] }
    );
    mockBySender.mockResolvedValue([makeGift()]);
    mockByRecipient.mockResolvedValue([makeGift({ id: "gift-2", senderId: "someone-else" })]);

    const data = await exportUserData(CTX);

    expect(data.profile).toEqual({ id: "user-1", phone: CTX.phone });
    expect(data.giftsSent).toHaveLength(1);
    expect(data.giftsReceived[0]).not.toHaveProperty("senderId");
    expect(data.giftsReceived[0]).not.toHaveProperty("recipientPhoneHash");
    expect(auditEvents()).toEqual(["data_export_requested"]);
    expect(dsrInserts()[0]).toEqual(["user-1", "export", "completed", null, "1.2.3.4", "jest"]);
  });

  it("only ever queries by the caller's own user ID", async () => {
    await exportUserData(CTX);
    for (const [, params] of mockQuery.mock.calls) {
      if (params) expect(params[0]).toBe("user-1");
    }
  });
});

describe("deleteUserData", () => {
  it("rejects and audits when the OTP is wrong, without touching data", async () => {
    mockVerify.mockResolvedValue({ success: false, locked: false, message: "Invalid OTP." });

    await expect(deleteUserData(CTX, "000000")).rejects.toMatchObject({
      code: "VERIFICATION_FAILED",
    });
    expect(mockConnect).not.toHaveBeenCalled();
    expect(auditEvents()).toEqual(["data_deletion_requested", "data_deletion_rejected"]);
    expect(dsrInserts()[0]).toEqual(
      expect.arrayContaining(["deletion", "rejected", "verification_failed"])
    );
  });

  it("refuses while sent gifts still have money in flight", async () => {
    mockVerify.mockResolvedValue({ success: true });
    mockBySender.mockResolvedValue([makeGift({ status: "locked" })]);

    await expect(deleteUserData(CTX, "123456")).rejects.toMatchObject({
      code: "ACCOUNT_HAS_ACTIVE_GIFTS",
      httpStatus: 409,
    });
    expect(mockConnect).not.toHaveBeenCalled();
    expect(dsrInserts()[0]).toEqual(expect.arrayContaining(["rejected", "active_gifts"]));
  });

  it("erases PII in a transaction but never deletes audit logs or gifts", async () => {
    mockVerify.mockResolvedValue({ success: true });
    mockBySender.mockResolvedValue([makeGift({ status: "claimed" })]);

    await deleteUserData(CTX, "123456");

    const sql = mockClient.query.mock.calls.map(([s]) => String(s));
    expect(sql[0]).toBe("BEGIN");
    expect(sql[sql.length - 1]).toBe("COMMIT");
    expect(sql.some((s) => s.includes("UPDATE users"))).toBe(true);
    expect(sql.some((s) => /DELETE FROM (audit_logs|gifts)\b/.test(s))).toBe(false);
    expect(redactGiftsForErasedSender).toHaveBeenCalledWith("user-1");
    expect(auditEvents()).toEqual(["data_deletion_requested", "data_deletion_completed"]);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("rolls back when a statement fails", async () => {
    mockVerify.mockResolvedValue({ success: true });
    mockClient.query.mockImplementation(async (s: string) => {
      if (s.includes("UPDATE users")) throw new Error("db down");
      return { rows: [] };
    });

    await expect(deleteUserData(CTX, "123456")).rejects.toThrow("db down");
    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(auditEvents()).not.toContain("data_deletion_completed");
  });
});
