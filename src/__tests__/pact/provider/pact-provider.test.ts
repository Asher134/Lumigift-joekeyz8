/**
 * Pact provider verification — LumigiftAPI
 *
 * Issue #291: Add API contract tests with Pact.io
 *
 * Run after consumer tests have generated pact files in /pacts.
 * Verifies that the real API satisfies all consumer contracts.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 npx jest src/__tests__/pact/provider
 */

import path from "path";
import { Verifier } from "@pact-foundation/pact";

describe("Pact provider verification (LumigiftAPI)", () => {
  it("satisfies all consumer contracts", async () => {
    const opts = {
      provider: "LumigiftAPI",
      providerBaseUrl:
        process.env.BASE_URL || "http://localhost:3000",
      pactUrls: [
        path.resolve(
          process.cwd(),
          "pacts",
          "LumigiftFrontend-LumigiftAPI.json"
        ),
      ],
      publishVerificationResult: process.env.CI === "true",
      providerVersion: process.env.GITHUB_SHA || "local",
      logLevel: "warn" as const,
    };

    await new Verifier(opts).verifyProvider();
  }, 60_000);
});
