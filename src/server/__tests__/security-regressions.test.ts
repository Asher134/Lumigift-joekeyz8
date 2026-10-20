/**
 * @jest-environment node
 *
 * Regression tests for the authenticated API penetration test (Issue #146).
 * Each block is named after its finding ID in docs/security/pentest-2026-09.md.
 */

import { createHash } from "crypto";
import { NextRequest } from "next/server";
import type { Gift } from "@/types";

const hash = (p: string) => createHash("sha256").update(p).digest("hex");

jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/csrf", () => ({ withCsrf: (h: unknown) => h }));
jest.mock("@/lib/db", () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock("@sentry/nextjs", () => ({ withScope: jest.fn(), captureException: jest.fn() }));
jest.mock("@/lib/otp", () => ({ verifyOtp: jest.fn() }));
jest.mock("@/server/services/gift.service", () => ({
  getGiftById: jest.fn(),
  getGiftsByRecipient: jest.fn(),
  hashPhone: (p: string) => createHash("sha256").update(p).digest("hex"),
}));
jest.mock("@/server/services/claim.service", () => ({ claimGift: jest.fn() }));
jest.mock("@/server/services/invitation.service", () => ({
  getInvitationByPhoneAndGift: jest.fn(),
  claimInvitation: jest.fn(),
}));
jest.mock("@/server/services/cancellation.service", () => ({ cancelGiftForSender: jest.fn() }));

import { getServerSession } from "next-auth";
import pool from "@/lib/db";
import { verifyOtp } from "@/lib/otp";
import { getGiftById, getGiftsByRecipient } from "@/server/services/gift.service";
import { claimGift } from "@/server/services/claim.service";
import { cancelGiftForSender } from "@/server/services/cancellation.service";
import { isAuthorizedCronRequest } from "@/server/cron-auth";

const mockSession = getServerSession as jest.Mock;
const mockGetGift = getGiftById as jest.Mock;

const RECIPIENT = "+2348012345678";
const STELLAR_KEY = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function makeGift(overrides: Partial<Gift> = {}): Gift {
  return {
    id: "gift-1",
    senderId: "sender-1",
    recipientPhoneHash: hash(RECIPIENT),
    recipientName: "Ada",
    amountNgn: 5000,
    amountUsdc: "3.0000000",
    message: "Surprise!",
    unlockAt: new Date(Date.now() + 86_400_000),
    status: "locked",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function req(
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  return new NextRequest(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

beforeEach(() => jest.clearAllMocks());

// ─── PT-01 ────────────────────────────────────────────────────────────────────
describe("PT-01: claim IDOR when the session has no phone", () => {
  const GIFT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const OTHER_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

  it("returns 404 and never pays out", async () => {
    const { POST } = await import("@/app/api/v1/gifts/[id]/claim/route");
    mockSession.mockResolvedValue({ user: { id: "attacker" } }); // no phone claim
    mockGetGift.mockResolvedValue(makeGift({ status: "unlocked" }));

    const res = await POST(
      req(`/api/v1/gifts/${GIFT_ID}/claim`, {
        method: "POST",
        body: { recipientStellarKey: STELLAR_KEY },
      }),
      { params: { id: GIFT_ID } }
    );

    expect(res.status).toBe(404);
    expect(claimGift).not.toHaveBeenCalled();
  });

  it("returns an identical body for unknown gifts and wrong-phone sessions", async () => {
    const { POST } = await import("@/app/api/v1/gifts/[id]/claim/route");
    const body = { method: "POST", body: { recipientStellarKey: STELLAR_KEY } };

    mockSession.mockResolvedValue({ user: { id: "u", phone: "+2348099999999" } });
    mockGetGift.mockResolvedValue(makeGift({ status: "unlocked" }));
    const wrong = await POST(req(`/api/v1/gifts/${GIFT_ID}/claim`, body), {
      params: { id: GIFT_ID },
    });

    mockGetGift.mockResolvedValue(null);
    const unknown = await POST(req(`/api/v1/gifts/${OTHER_ID}/claim`, body), {
      params: { id: OTHER_ID },
    });

    expect(wrong.status).toBe(404);
    expect(wrong.status).toBe(unknown.status);
    expect(await wrong.json()).toEqual(await unknown.json());
  });
});

// ─── PT-02 ────────────────────────────────────────────────────────────────────
describe("PT-02: phone registration lookup is not an anonymous oracle", () => {
  it("rejects unauthenticated lookups", async () => {
    const { GET } = await import("@/app/api/v1/users/route");
    mockSession.mockResolvedValue(null);

    const res = await GET(req(`/api/v1/users?phone=${encodeURIComponent(RECIPIENT)}`));

    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rate limits bulk lookups per user", async () => {
    const { GET } = await import("@/app/api/v1/users/route");
    mockSession.mockResolvedValue({ user: { id: "enumerator" } });
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await GET(req(`/api/v1/users?phone=${encodeURIComponent(RECIPIENT)}`));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

// ─── PT-03 ────────────────────────────────────────────────────────────────────
describe("PT-03: public gift view does not leak locked gift contents", () => {
  it("omits amount, message and media for a locked gift", async () => {
    const { GET } = await import("@/app/api/v1/gifts/[id]/route");
    mockSession.mockResolvedValue(null);
    mockGetGift.mockResolvedValue(makeGift({ mediaUrl: "https://x/y.png" }));

    const json = await (
      await GET(req("/api/v1/gifts/gift-1"), { params: { id: "gift-1" } })
    ).json();

    expect(json.data).not.toHaveProperty("amountNgn");
    expect(json.data).not.toHaveProperty("message");
    expect(json.data).not.toHaveProperty("mediaUrl");
    expect(json.data).not.toHaveProperty("senderId");
  });

  it("reveals them once unlocked", async () => {
    const { GET } = await import("@/app/api/v1/gifts/[id]/route");
    mockSession.mockResolvedValue(null);
    mockGetGift.mockResolvedValue(makeGift({ status: "unlocked" }));

    const json = await (
      await GET(req("/api/v1/gifts/gift-1"), { params: { id: "gift-1" } })
    ).json();

    expect(json.data.amountNgn).toBe(5000);
  });
});

// ─── PT-04 ────────────────────────────────────────────────────────────────────
describe("PT-04: media upload endpoints require a session", () => {
  it("does not hand out signed upload params anonymously", async () => {
    const { POST } = await import("@/app/api/v1/uploads/sign/route");
    mockSession.mockResolvedValue(null);
    process.env.CLOUDINARY_API_SECRET = "secret";

    const res = await POST(req("/api/v1/uploads/sign", { method: "POST" }));

    expect(res.status).toBe(401);
    expect(await res.json()).not.toHaveProperty("signature");
  });

  it("rejects anonymous uploads through the proxy", async () => {
    const { POST } = await import("@/app/api/v1/uploads/route");
    mockSession.mockResolvedValue(null);

    const res = await POST(req("/api/v1/uploads", { method: "POST" }));

    expect(res.status).toBe(401);
  });
});

// ─── PT-05 ────────────────────────────────────────────────────────────────────
describe("PT-05: cron auth fails closed", () => {
  it("rejects `Bearer undefined` when CRON_SECRET is unset", () => {
    expect(isAuthorizedCronRequest("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer ", "")).toBe(false);
  });

  it("rejects missing or wrong tokens and accepts the right one", () => {
    expect(isAuthorizedCronRequest(null, "s3cret")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer wrong", "s3cret")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer s3cret", "s3cret")).toBe(true);
  });
});

// ─── PT-06 ────────────────────────────────────────────────────────────────────
describe("PT-06: gift discovery does not reveal whether a gift exists", () => {
  it("returns byte-identical responses for unknown phone, wrong code and malformed input", async () => {
    const { POST } = await import("@/app/api/v1/gifts/discover/route");
    (verifyOtp as jest.Mock).mockResolvedValue({ success: false, locked: false, message: "x" });
    (getGiftsByRecipient as jest.Mock).mockResolvedValue([makeGift()]);

    const cases = [
      { phone: "+2348012345678", otp: "111111" }, // has a gift, wrong code
      { phone: "+2348099999999", otp: "111111" }, // unknown number
      { phone: "not-a-phone", otp: "111111" }, // malformed
    ];
    const results = [];
    for (const [i, body] of cases.entries()) {
      const res = await POST(
        req("/api/v1/gifts/discover", {
          method: "POST",
          body,
          headers: { "x-forwarded-for": `10.0.0.${i}` },
        })
      );
      const json = await res.json();
      delete json.correlationId;
      results.push({ status: res.status, json });
    }

    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(results[0].status).toBe(401);
    expect(getGiftsByRecipient).not.toHaveBeenCalled();
  });
});

// ─── PT-07 ────────────────────────────────────────────────────────────────────
describe("PT-07: cancelling someone else's gift looks like a missing gift", () => {
  it("returns 404 (not 403) and does not cancel", async () => {
    const { DELETE } = await import("@/app/api/v1/gifts/[id]/route");
    mockSession.mockResolvedValue({ user: { id: "not-the-sender" } });
    mockGetGift.mockResolvedValue(makeGift());

    const res = await DELETE(req("/api/v1/gifts/gift-1", { method: "DELETE" }), {
      params: { id: "gift-1" },
    });

    expect(res.status).toBe(404);
    expect(cancelGiftForSender).not.toHaveBeenCalled();
  });
});
