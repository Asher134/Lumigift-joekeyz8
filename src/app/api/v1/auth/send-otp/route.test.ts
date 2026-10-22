/**
 * Unit tests for the /api/v1/auth/send-otp rate limiting behaviour.
 *
 * Verifies:
 *  - 3 requests per phone per 10 minutes are allowed
 *  - The 4th request returns HTTP 429 with a Retry-After header
 *  - IP fallback returns 429 when the per-IP limit is exceeded
 */

// ── Mock Redis ─────────────────────────────────────────────────────────────────
const incrMock = jest.fn();
const expireMock = jest.fn();
const ttlMock = jest.fn();
const setMock = jest.fn();
const delMock = jest.fn();

jest.mock("@/lib/redis", () => ({
  getRedisClient: jest.fn().mockResolvedValue({
    incr: incrMock,
    expire: expireMock,
    ttl: ttlMock,
    set: setMock,
    del: delMock,
    get: jest.fn(),
  }),
}));

// ── Mock SMS / OTP so no real network calls are made ──────────────────────────
jest.mock("@/lib/sms", () => ({ sendOtp: jest.fn().mockResolvedValue("123456") }));
jest.mock("@/lib/otp", () => ({ storeOtp: jest.fn() }));

// ── Mock CSRF + error handler (pass-through wrappers) ────────────────────────
jest.mock("@/lib/csrf", () => ({
  withCsrf: (handler: (...args: unknown[]) => unknown) => handler,
}));
jest.mock("@/lib/logger", () => ({
  requestLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
  getCorrelationId: () => "test-correlation-id",
  serviceLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
}));
jest.mock("@sentry/nextjs", () => ({
  withScope: jest.fn(),
  captureException: jest.fn(),
}));
jest.mock("@/server/errors", () => ({
  mapError: (err: unknown) => ({
    status: 500,
    publicMessage: "Internal server error",
    code: "INTERNAL_ERROR",
  }),
  AppError: class AppError extends Error {},
  ERROR_CODES: {},
}));

// ── Mock next/server ──────────────────────────────────────────────────────────
jest.mock("next/server", () => {
  class MockHeaders extends Map<string, string> {
    set(key: string, value: string) {
      super.set(key, value);
      return this;
    }
    get(key: string) {
      return super.get(key) ?? null;
    }
  }

  class MockNextResponse {
    public status: number;
    public body: unknown;
    public headers: MockHeaders;

    constructor(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new MockHeaders(Object.entries(init?.headers ?? {}));
    }

    static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      return new MockNextResponse(body, init);
    }
  }

  return { NextResponse: MockNextResponse };
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRequest(phone = "+2348100001234", ip = "1.2.3.4") {
  return {
    json: jest.fn().mockResolvedValue({ phone }),
    headers: {
      get: (header: string) => (header === "x-forwarded-for" ? ip : null),
    },
    nextUrl: { pathname: "/api/v1/auth/send-otp" },
  } as unknown as import("next/server").NextRequest;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/v1/auth/send-otp — rate limiting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ttlMock.mockResolvedValue(580);
    expireMock.mockResolvedValue(1);
    setMock.mockResolvedValue("OK");
    delMock.mockResolvedValue(1);
  });

  it("allows the first 3 requests for a phone number", async () => {
    // Requests 1-3 are within the phone rate limit; IP limit is not breached.
    for (let attempt = 1; attempt <= 3; attempt++) {
      incrMock
        .mockResolvedValueOnce(attempt) // phone counter
        .mockResolvedValueOnce(attempt); // IP counter

      const { POST } = await import("@/app/api/v1/auth/send-otp/route");
      const res = await POST(makeRequest(), undefined);

      expect((res as unknown as { status: number }).status).not.toBe(429);
    }
  });

  it("returns 429 with Retry-After on the 4th OTP request for the same phone", async () => {
    // Phone counter returns 4 (over the limit of 3); IP counter is fine.
    incrMock
      .mockResolvedValueOnce(4) // phone counter = 4 → over limit
      .mockResolvedValueOnce(1); // IP counter (not reached)
    ttlMock.mockResolvedValue(540);

    const { POST } = await import("@/app/api/v1/auth/send-otp/route");
    const res = await POST(makeRequest(), undefined);
    const response = res as unknown as {
      status: number;
      headers: Map<string, string>;
      body: { success: boolean; error: string };
    };

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeDefined();
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(response.body).toMatchObject({ success: false });
  });

  it("returns 429 when IP limit is exceeded even if phone limit is not", async () => {
    // Phone counter is fine (1), but IP counter exceeds 10.
    incrMock
      .mockResolvedValueOnce(1) // phone counter = 1 → allowed
      .mockResolvedValueOnce(11); // IP counter = 11 → over limit of 10
    ttlMock.mockResolvedValue(45);

    const { POST } = await import("@/app/api/v1/auth/send-otp/route");
    const res = await POST(makeRequest(), undefined);
    const response = res as unknown as {
      status: number;
      headers: Map<string, string>;
      body: { success: boolean; error: string };
    };

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeDefined();
  });

  it("returns 400 for an invalid phone number", async () => {
    const { POST } = await import("@/app/api/v1/auth/send-otp/route");
    const req = makeRequest("not-a-phone");
    const res = await POST(req, undefined);
    expect((res as unknown as { status: number }).status).toBe(400);
  });
});
