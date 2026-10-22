/**
 * @jest-environment node
 *
 * Issue #362 — Phone number de-duplication during registration.
 */

import { NextRequest } from "next/server";

const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

jest.mock("@/server/middleware", () => ({
  withErrorHandler: <T>(handler: T) => handler,
  withCsrf: <T>(handler: T) => handler,
  validateBody: async (req: NextRequest) => ({ success: true, data: await req.json() }),
}));

jest.mock("@/server/services/invitation.service", () => ({
  validateInvitationToken: jest.fn(),
  acceptInvitation: jest.fn(),
}));

import { POST } from "../register/route";

const register = () =>
  POST(
    new NextRequest("http://localhost/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ phone: "+2348012345678", displayName: "Ada" }),
    })
  );

describe("POST /api/v1/auth/register — duplicate phone (#362)", () => {
  beforeEach(() => mockQuery.mockReset());

  it("returns 409 when the phone hash is already registered", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });

    const res = await register();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).not.toMatch(/already registered/i);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("phone_hash"), [
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
  });

  it("returns 409 when a concurrent insert hits the unique index", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "23505" }));

    const res = await register();

    expect(res.status).toBe(409);
  });

  it("returns 201 for a new phone number", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const res = await register();

    expect(res.status).toBe(201);
  });
});
