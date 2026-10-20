/**
 * Pact consumer contract tests — /api/v1/gifts
 *
 * Issue #291: Add API contract tests with Pact.io
 *
 * Defines the consumer-side contract for gift-related API calls.
 * The generated pact file is committed to /pacts and verified by the backend.
 */

import path from "path";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";

const { like, eachLike, string, uuid, datetime, integer } = MatchersV3;

const provider = new PactV3({
  consumer: "LumigiftFrontend",
  provider: "LumigiftAPI",
  dir: path.resolve(process.cwd(), "pacts"),
  logLevel: "warn",
});

describe("Gifts API contract (consumer)", () => {
  // ── POST /api/v1/gifts ────────────────────────────────────────────────────
  describe("create gift", () => {
    it("returns the created gift", async () => {
      await provider
        .addInteraction({
          states: [{ description: "user is authenticated" }],
          uponReceiving: "a request to create a gift",
          withRequest: {
            method: "POST",
            path: "/api/v1/gifts",
            headers: {
              "Content-Type": "application/json",
              Authorization: like("Bearer <token>"),
            },
            body: {
              recipientPhone: string("+2348012345678"),
              recipientName: string("Ada"),
              amountNgn: integer(5000),
              message: string("Happy birthday!"),
              unlockAt: string("2026-01-01T00:00:00.000Z"),
            },
          },
          willRespondWith: {
            status: 201,
            headers: { "Content-Type": "application/json" },
            body: {
              success: like(true),
              data: {
                id: uuid(),
                recipientPhone: string("+2348012345678"),
                recipientName: string("Ada"),
                amountNgn: integer(5000),
                amountUsdc: string("3.0000000"),
                message: string("Happy birthday!"),
                status: string("pending_payment"),
                unlockAt: string("2026-01-01T00:00:00.000Z"),
                createdAt: string("2026-01-01T00:00:00.000Z"),
                updatedAt: string("2026-01-01T00:00:00.000Z"),
              },
            },
          },
        })
        .executeTest(async (mockServer) => {
          const res = await fetch(`${mockServer.url}/api/v1/gifts`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer test-token",
            },
            body: JSON.stringify({
              recipientPhone: "+2348012345678",
              recipientName: "Ada",
              amountNgn: 5000,
              message: "Happy birthday!",
              unlockAt: "2026-01-01T00:00:00.000Z",
            }),
          });

          expect(res.status).toBe(201);
          const json = await res.json();
          expect(json.success).toBe(true);
          expect(json.data.id).toBeDefined();
        });
    });
  });

  // ── GET /api/v1/gifts/:id ─────────────────────────────────────────────────
  describe("get gift by id", () => {
    it("returns the gift when it exists", async () => {
      const giftId = "00000000-0000-0000-0000-000000000001";

      await provider
        .addInteraction({
          states: [{ description: `gift ${giftId} exists` }],
          uponReceiving: "a request to get a gift by id",
          withRequest: {
            method: "GET",
            path: `/api/v1/gifts/${giftId}`,
          },
          willRespondWith: {
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: {
              success: like(true),
              data: {
                id: string(giftId),
                status: string("locked"),
                amountNgn: integer(5000),
                amountUsdc: string("3.0000000"),
                message: string("Happy birthday!"),
                unlockAt: string("2026-01-01T00:00:00.000Z"),
              },
            },
          },
        })
        .executeTest(async (mockServer) => {
          const res = await fetch(
            `${mockServer.url}/api/v1/gifts/${giftId}`
          );
          expect(res.status).toBe(200);
          const json = await res.json();
          expect(json.data.id).toBe(giftId);
        });
    });
  });
});
