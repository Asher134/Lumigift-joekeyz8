/**
 * @jest-environment node
 *
 * Unit tests for stellar-submission.service.ts (Issue #336)
 *
 * Simulates a network timeout on the first submission and verifies the retry
 * returns the recorded hash without submitting a duplicate transaction.
 */

type Row = { tx_hash: string; status: string };
const table = new Map<string, Row>();

function query(sql: string, params: unknown[] = []) {
  const key = params[0] as string;
  if (sql.startsWith("SELECT tx_hash, status")) {
    const row = table.get(key);
    return { rows: row && row.status !== "failed" ? [row] : [] };
  }
  if (sql.includes("INSERT INTO stellar_tx_hash")) {
    const row = table.get(key);
    if (row && row.status !== "failed") return { rows: [] };
    const created = { tx_hash: params[2] as string, status: "pending" };
    table.set(key, created);
    return { rows: [created] };
  }
  if (sql.includes("status = 'submitted'")) table.get(key)!.status = "submitted";
  if (sql.includes("status = 'failed'")) table.get(key)!.status = "failed";
  return { rows: [] };
}

jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: {
    query: jest.fn((sql: string, params: unknown[]) => Promise.resolve(query(sql, params))),
    connect: jest.fn(() =>
      Promise.resolve({
        query: jest.fn((sql: string, params: unknown[]) => Promise.resolve(query(sql, params))),
        release: jest.fn(),
      })
    ),
  },
}));

const submitTransaction = jest.fn();
jest.mock("@/lib/stellar", () => ({ horizonServer: () => ({ submitTransaction }) }));
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), info: jest.fn() } }));

const createAuditLog = jest.fn().mockResolvedValue("audit-id");
jest.mock("../audit.service", () => ({
  createAuditLog: (...args: unknown[]) => createAuditLog(...args),
}));

import type { Transaction } from "@stellar/stellar-sdk";
import { submitTransactionIdempotent } from "../stellar-submission.service";

const tx = { hash: () => Buffer.from("abc123", "hex") } as unknown as Transaction;
const params = { idempotencyKey: "fund:gift-1", giftId: "gift-1", tx };

beforeEach(() => {
  table.clear();
  jest.clearAllMocks();
});

describe("submitTransactionIdempotent", () => {
  it("does not resubmit after a network timeout", async () => {
    submitTransaction.mockRejectedValueOnce(new Error("timeout of 30000ms exceeded"));

    await expect(submitTransactionIdempotent(params)).rejects.toThrow("timeout");
    const retry = await submitTransactionIdempotent(params);

    expect(retry).toEqual({ hash: "abc123", duplicate: true });
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect(createAuditLog).toHaveBeenCalledTimes(2);
    expect(createAuditLog.mock.calls[0][0].metadata.outcome).toBe("unknown");
    expect(createAuditLog.mock.calls[1][0].metadata.outcome).toBe("duplicate");
  });

  it("returns the existing hash for a duplicate after success", async () => {
    submitTransaction.mockResolvedValue({ hash: "abc123" });

    expect(await submitTransactionIdempotent(params)).toEqual({ hash: "abc123", duplicate: false });
    expect(await submitTransactionIdempotent(params)).toEqual({ hash: "abc123", duplicate: true });
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("allows a retry after a definitive Horizon rejection", async () => {
    submitTransaction
      .mockRejectedValueOnce(Object.assign(new Error("tx_bad_seq"), { response: { status: 400 } }))
      .mockResolvedValueOnce({ hash: "abc123" });

    await expect(submitTransactionIdempotent(params)).rejects.toThrow("tx_bad_seq");
    expect(await submitTransactionIdempotent(params)).toEqual({ hash: "abc123", duplicate: false });
    expect(submitTransaction).toHaveBeenCalledTimes(2);
  });
});
