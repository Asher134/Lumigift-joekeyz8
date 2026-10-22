/**
 * Concurrent gift unlock race conditions (#360).
 *
 * Fires 5 concurrent unlock attempts for the same gift and asserts that only
 * one Stellar transaction is submitted and the status is updated exactly once.
 */

const redisStore = new Map<string, string>();
const mockRedis = {
  set: jest.fn(async (key: string, value: string, opts?: { NX?: boolean }) => {
    if (opts?.NX && redisStore.has(key)) return null;
    redisStore.set(key, value);
    return "OK";
  }),
  get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
  del: jest.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0)),
};

jest.mock("@/lib/redis", () => ({
  getRedisClient: jest.fn(async () => mockRedis),
}));

let giftStatus = "locked";
const mockQuery = jest.fn(async (sql: string) => {
  if (sql.startsWith("SELECT")) return { rows: [{ status: giftStatus }] };
  if (sql.startsWith("UPDATE")) giftStatus = "unlocked";
  return { rows: [] };
});

jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { connect: jest.fn(async () => ({ query: mockQuery, release: jest.fn() })) },
}));

import { unlockGiftOnce } from "../unlock-lock.service";

const updateCalls = () => mockQuery.mock.calls.filter(([sql]) => sql.startsWith("UPDATE"));

describe("unlockGiftOnce — concurrent unlock (#360)", () => {
  beforeEach(() => {
    redisStore.clear();
    giftStatus = "locked";
    jest.clearAllMocks();
  });

  it("submits exactly one Stellar transaction for 5 concurrent requests", async () => {
    const submitTx = jest.fn(async () => "tx-hash");

    const results = await Promise.all(
      Array.from({ length: 5 }, () => unlockGiftOnce("gift-1", submitTx))
    );

    expect(submitTx).toHaveBeenCalledTimes(1);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(updateCalls()).toHaveLength(1);
    expect(giftStatus).toBe("unlocked");
  });

  it("uses the Redis distributed lock as the primary guard", async () => {
    const submitTx = jest.fn(async () => "tx-hash");

    await Promise.all(Array.from({ length: 5 }, () => unlockGiftOnce("gift-1", submitTx)));

    expect(mockRedis.set).toHaveBeenCalledWith(
      "lock:gift-unlock:gift-1",
      expect.any(String),
      expect.objectContaining({ NX: true })
    );
    expect(redisStore.has("lock:gift-unlock:gift-1")).toBe(false);
  });

  it("falls back to SELECT FOR UPDATE when the Redis lock was lost", async () => {
    const submitTx = jest.fn(async () => "tx-hash");

    await unlockGiftOnce("gift-1", submitTx);
    // Second sequential attempt acquires Redis but the row is no longer locked.
    await unlockGiftOnce("gift-1", submitTx);

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), ["gift-1"]);
    expect(submitTx).toHaveBeenCalledTimes(1);
    expect(updateCalls()).toHaveLength(1);
  });
});
