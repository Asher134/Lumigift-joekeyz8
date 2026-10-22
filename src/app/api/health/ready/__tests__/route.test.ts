/**
 * @jest-environment node
 *
 * Unit tests for GET /api/health/ready
 */

const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockPing = jest.fn();
jest.mock("@/lib/redis", () => ({
  getRedisClient: () => Promise.resolve({ ping: (...args: unknown[]) => mockPing(...args) }),
}));

jest.mock("@/server/config", () => ({
  serverConfig: { stellar: { horizonUrl: "https://horizon.test" } },
}));

import { GET } from "../route";

describe("GET /api/health/ready", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
    mockPing.mockResolvedValue("PONG");
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });

  it("returns 200 when Postgres and Redis are healthy", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ postgres: "ok", redis: "ok" });
  });

  it("returns 503 when Redis is unreachable", async () => {
    mockPing.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body).toMatchObject({ postgres: "ok", redis: "error" });
  });

  it("returns 503 when Redis ping exceeds the 500 ms timeout", async () => {
    jest.useFakeTimers();
    mockPing.mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await jest.advanceTimersByTimeAsync(500);
    const res = await pending;
    jest.useRealTimers();
    expect(res.status).toBe(503);
    expect((await res.json()).redis).toBe("error");
  });
});
