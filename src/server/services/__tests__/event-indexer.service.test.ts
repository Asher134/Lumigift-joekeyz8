/**
 * @jest-environment node
 *
 * Tests for the event-indexer service — issue #76: Persist Stellar event
 * reconciliation records.
 *
 * Acceptance Criteria:
 *   • Indexer restarts from durable state (cursor stored in DB).
 *   • Duplicate ledger events remain idempotent (ON CONFLICT DO NOTHING).
 */

import { indexEscrowEvents } from "../event-indexer.service";

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@/lib/redis", () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock("@/lib/contracts/escrow-events", () => ({
  fetchEscrowEvents: jest.fn(),
  CURSOR_GENESIS: "0000000000000000-0000000000",
}));

jest.mock("../gift.service", () => ({
  getGiftByContractId: jest.fn(),
  updateGiftStatusIdempotent: jest.fn(),
}));

jest.mock("@/server/config", () => ({
  serverConfig: {
    stellar: {
      network: "testnet",
      escrowContractId: "CONTRACT_ID_TEST",
    },
  },
}));

// Mock the DB pool — captures all queries so we can assert on them
jest.mock("@/lib/db", () => ({
  default: {
    query: jest.fn(),
  },
}));

// ─── Imports after mocking ─────────────────────────────────────────────────────

import { redis } from "@/lib/redis";
import { fetchEscrowEvents, CURSOR_GENESIS } from "@/lib/contracts/escrow-events";
import { getGiftByContractId, updateGiftStatusIdempotent } from "../gift.service";
import pool from "@/lib/db";

const mockRedis = redis as jest.Mocked<typeof redis>;
const mockFetch = fetchEscrowEvents as jest.Mock;
const mockGetGift = getGiftByContractId as jest.Mock;
const mockUpdateStatus = updateGiftStatusIdempotent as jest.Mock;
const mockDbQuery = pool.query as jest.Mock;

const CONTRACT_ID = "CONTRACT_ID_TEST";
const GENESIS = "0000000000000000-0000000000";

const baseGift = { id: "gift-1", contractId: CONTRACT_ID, status: "funded" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Make pool.query return empty rows by default (cursor lookup, event log insert) */
function defaultDbMocks() {
  mockDbQuery.mockImplementation((sql: string) => {
    if (sql.includes("SELECT cursor")) {
      return Promise.resolve({ rows: [] });
    }
    // INSERT … ON CONFLICT DO NOTHING for event_log and cursor upsert
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("indexEscrowEvents (issue #76)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");
    mockUpdateStatus.mockResolvedValue({ ...baseGift });
    defaultDbMocks();
  });

  // ── Cursor resolution ─────────────────────────────────────────────────────

  describe("cursor resolution", () => {
    it("uses Redis cursor when available (fast path)", async () => {
      const redisCursor = "0000000000000050-0000000001";
      mockRedis.get.mockResolvedValue(redisCursor);
      mockFetch.mockResolvedValue({ events: [], latestCursor: redisCursor });

      await indexEscrowEvents();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({ startCursor: redisCursor })
      );
      // DB cursor lookup should NOT be called when Redis has the cursor
      expect(mockDbQuery).not.toHaveBeenCalledWith(
        expect.stringContaining("SELECT cursor"),
        expect.anything()
      );
    });

    it("falls back to DB cursor when Redis is empty", async () => {
      const dbCursor = "0000000000000100-0000000001";
      mockRedis.get.mockResolvedValue(null);
      mockDbQuery.mockImplementation((sql: string) => {
        if (sql.includes("SELECT cursor")) {
          return Promise.resolve({ rows: [{ cursor: dbCursor }] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      mockFetch.mockResolvedValue({ events: [], latestCursor: dbCursor });

      await indexEscrowEvents();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({ startCursor: dbCursor })
      );
    });

    it("warms Redis cache after reading cursor from DB", async () => {
      const dbCursor = "0000000000000100-0000000001";
      mockRedis.get.mockResolvedValue(null);
      mockDbQuery.mockImplementation((sql: string) => {
        if (sql.includes("SELECT cursor")) {
          return Promise.resolve({ rows: [{ cursor: dbCursor }] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      mockFetch.mockResolvedValue({ events: [], latestCursor: dbCursor });

      await indexEscrowEvents();

      expect(mockRedis.set).toHaveBeenCalledWith(CURSOR_KEY, dbCursor);
    });

    it("falls back to CURSOR_GENESIS when both Redis and DB are empty", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockFetch.mockResolvedValue({ events: [], latestCursor: GENESIS });

      await indexEscrowEvents();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({ startCursor: GENESIS })
      );
    });
  });

  // ── Cursor persistence ────────────────────────────────────────────────────

  describe("cursor persistence", () => {
    it("persists new cursor to DB (upsert) when cursor advances", async () => {
      const oldCursor = "0000000000000100-0000000001";
      const newCursor = "0000000000000200-0000000001";
      mockRedis.get.mockResolvedValue(oldCursor);
      mockFetch.mockResolvedValue({ events: [], latestCursor: newCursor });

      await indexEscrowEvents();

      // Should call INSERT ... ON CONFLICT ... DO UPDATE for indexer_cursor
      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO indexer_cursor"),
        expect.arrayContaining(["escrow", newCursor])
      );
    });

    it("persists new cursor to Redis when cursor advances", async () => {
      const oldCursor = "0000000000000100-0000000001";
      const newCursor = "0000000000000200-0000000001";
      mockRedis.get.mockResolvedValue(oldCursor);
      mockFetch.mockResolvedValue({ events: [], latestCursor: newCursor });

      await indexEscrowEvents();

      expect(mockRedis.set).toHaveBeenCalledWith(CURSOR_KEY, newCursor);
    });

    it("does NOT write cursor when cursor has not advanced", async () => {
      const cursor = "0000000000000100-0000000001";
      mockRedis.get.mockResolvedValue(cursor);
      mockFetch.mockResolvedValue({ events: [], latestCursor: cursor });

      await indexEscrowEvents();

      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(mockDbQuery).not.toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO indexer_cursor"),
        expect.anything()
      );
    });
  });

  // ── Event log persistence (idempotency) ───────────────────────────────────

  describe("stellar_event_log persistence", () => {
    it("inserts a record into stellar_event_log for each processed event", async () => {
      mockGetGift.mockResolvedValue({ ...baseGift, status: "funded" });
      mockFetch.mockResolvedValue({
        events: [
          {
            type: "initialized",
            contractId: CONTRACT_ID,
            ledger: 100,
            ledgerClosedAt: "2024-01-01T00:00:00Z",
            txHash: "abc123",
            sender: "GSENDER",
            recipient: "GRECIPIENT",
            amount: BigInt(100_000_000),
            unlockTime: BigInt(9_999_999),
          },
        ],
        latestCursor: "0000000000000100-0000000001",
      });

      await indexEscrowEvents();

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO stellar_event_log"),
        expect.arrayContaining(["initialized", "applied"])
      );
    });

    it("uses ON CONFLICT DO NOTHING for idempotency (duplicate events are safe)", async () => {
      mockGetGift.mockResolvedValue({ ...baseGift, status: "funded" });
      mockFetch.mockResolvedValue({
        events: [
          {
            type: "initialized",
            contractId: CONTRACT_ID,
            ledger: 100,
            ledgerClosedAt: "2024-01-01T00:00:00Z",
            txHash: "abc123",
            sender: "GSENDER",
            recipient: "GRECIPIENT",
            amount: BigInt(100_000_000),
            unlockTime: BigInt(9_999_999),
          },
        ],
        latestCursor: "0000000000000100-0000000001",
      });

      await indexEscrowEvents();

      const insertCall = (mockDbQuery as jest.Mock).mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("INSERT INTO stellar_event_log")
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![0]).toContain("ON CONFLICT (event_id) DO NOTHING");
    });

    it("records 'skipped' outcome when gift already in target status", async () => {
      // Gift already locked — replaying initialized event should be skipped
      mockGetGift.mockResolvedValue({ ...baseGift, status: "locked" });
      mockFetch.mockResolvedValue({
        events: [
          {
            type: "initialized",
            contractId: CONTRACT_ID,
            ledger: 100,
            ledgerClosedAt: "2024-01-01T00:00:00Z",
            txHash: "abc123",
            sender: "GSENDER",
            recipient: "GRECIPIENT",
            amount: BigInt(100_000_000),
            unlockTime: BigInt(9_999_999),
          },
        ],
        latestCursor: "0000000000000100-0000000001",
      });

      await indexEscrowEvents();

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO stellar_event_log"),
        expect.arrayContaining(["skipped"])
      );
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

    it("records 'skipped' outcome when gift not in DB", async () => {
      mockGetGift.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        events: [
          {
            type: "claimed",
            contractId: "UNKNOWN_CONTRACT",
            ledger: 200,
            ledgerClosedAt: "2024-01-02T00:00:00Z",
            txHash: "xyz",
            recipient: "GRECIPIENT",
            amount: BigInt(100_000_000),
          },
        ],
        latestCursor: "0000000000000200-0000000001",
      });

      await indexEscrowEvents();

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO stellar_event_log"),
        expect.arrayContaining(["skipped"])
      );
    });
  });

  // ── Event application (existing behavior) ────────────────────────────────

  describe("event application", () => {
    it("applies initialized event → sets gift status to locked", async () => {
      mockGetGift.mockResolvedValue({ ...baseGift, status: "funded" });
      mockFetch.mockResolvedValue({
        events: [
          {
            type: "initialized",
            contractId: CONTRACT_ID,
            ledger: 100,
            ledgerClosedAt: "2024-01-01T00:00:00Z",
            txHash: "abc123",
            sender: "GSENDER",
            recipient: "GRECIPIENT",
            amount: BigInt(100_000_000),
            unlockTime: BigInt(9_999_999),
          },
        ],
        latestCursor: "0000000000000100-0000000001",
      });

      const result = await indexEscrowEvents();

      expect(mockUpdateStatus).toHaveBeenCalledWith("gift-1", "locked");
      expect(result.processed).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it("applies claimed event → sets gift status to claimed", async () => {
      mockGetGift.mockResolvedValue({ ...baseGift, status: "unlocked" });
      mockFetch.mockResolvedValue({
        events: [
          {
            type: "claimed",
            contractId: CONTRACT_ID,
            ledger: 200,
            ledgerClosedAt: "2024-01-02T00:00:00Z",
            txHash: "def456",
            recipient: "GRECIPIENT",
            amount: BigInt(100_000_000),
          },
        ],
        latestCursor: "0000000000000200-0000000001",
      });

      const result = await indexEscrowEvents();

      expect(mockUpdateStatus).toHaveBeenCalledWith("gift-1", "claimed");
      expect(result.processed).toBe(1);
    });

    it("applies cancelled event → sets gift status to cancelled", async () => {
      mockGetGift.mockResolvedValue({ ...baseGift, status: "locked" });
      mockFetch.mockResolvedValue({
        events: [
          {
            type: "cancelled",
            contractId: CONTRACT_ID,
            ledger: 300,
            ledgerClosedAt: "2024-01-03T00:00:00Z",
            txHash: "ghi789",
            sender: "GSENDER",
            amount: BigInt(100_000_000),
          },
        ],
        latestCursor: "0000000000000300-0000000001",
      });

      const result = await indexEscrowEvents();

      expect(mockUpdateStatus).toHaveBeenCalledWith("gift-1", "cancelled");
      expect(result.processed).toBe(1);
    });

    it("is idempotent — skips event if gift already in target status", async () => {
      mockGetGift.mockResolvedValue({ ...baseGift, status: "locked" });
      mockFetch.mockResolvedValue({
        events: [
          {
            type: "initialized",
            contractId: CONTRACT_ID,
            ledger: 100,
            ledgerClosedAt: "2024-01-01T00:00:00Z",
            txHash: "abc123",
            sender: "GSENDER",
            recipient: "GRECIPIENT",
            amount: BigInt(100_000_000),
            unlockTime: BigInt(9_999_999),
          },
        ],
        latestCursor: "0000000000000100-0000000001",
      });

      const result = await indexEscrowEvents();

      expect(mockUpdateStatus).not.toHaveBeenCalled();
      expect(result.processed).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });
});

// Export constant for test assertions
const CURSOR_KEY = "escrow:event:cursor";
