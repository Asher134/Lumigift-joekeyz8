/**
 * Pact consumer contract tests — /api/v1/auth
 *
 * Issue #291: Add API contract tests with Pact.io
 */

import path from "path";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";

const { like, string } = MatchersV3;

const provider = new PactV3({
  consumer: "LumigiftFrontend",
  provider: "LumigiftAPI",
  dir: path.resolve(process.cwd(), "pacts"),
  logLevel: "warn",
});

describe("Auth API contract (consumer)", () => {
  // ── POST /api/v1/auth/send-otp ────────────────────────────────────────────
  describe("send OTP", () => {
    it("returns success when phone is valid", async () => {
      await provider
        .addInteraction({
          states: [{ description: "phone number is valid and unblocked" }],
          uponReceiving: "a request to send an OTP",
          withRequest: {
            method: "POST",
            path: "/api/v1/auth/send-otp",
            headers: { "Content-Type": "application/json" },
            body: { phone: string("+2348012345678") },
          },
          willRespondWith: {
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: { success: like(true) },
          },
        })
        .executeTest(async (mockServer) => {
          const res = await fetch(`${mockServer.url}/api/v1/auth/send-otp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: "+2348012345678" }),
          });
          expect(res.status).toBe(200);
          const json = await res.json();
          expect(json.success).toBe(true);
        });
    });
  });

  // ── POST /api/v1/auth/verify-otp ─────────────────────────────────────────
  describe("verify OTP", () => {
    it("returns a session token on correct OTP", async () => {
      await provider
        .addInteraction({
          states: [{ description: "a pending OTP exists for the phone number" }],
          uponReceiving: "a request to verify an OTP",
          withRequest: {
            method: "POST",
            path: "/api/v1/auth/verify-otp",
            headers: { "Content-Type": "application/json" },
            body: {
              phone: string("+2348012345678"),
              otp: string("123456"),
            },
          },
          willRespondWith: {
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: {
              success: like(true),
              token: string("jwt-token"),
            },
          },
        })
        .executeTest(async (mockServer) => {
          const res = await fetch(
            `${mockServer.url}/api/v1/auth/verify-otp`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                phone: "+2348012345678",
                otp: "123456",
              }),
            }
          );
          expect(res.status).toBe(200);
          const json = await res.json();
          expect(json.success).toBe(true);
          expect(json.token).toBeDefined();
        });
    });
  });
});
