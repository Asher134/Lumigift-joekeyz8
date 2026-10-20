/**
 * e2e: Full-page accessibility audit using @axe-core/playwright
 *
 * Issue #293 — Accessibility audit to CI with axe-core
 *
 * This file runs axe-core against every public-facing route in the app to
 * catch accessibility regressions that component-level jest-axe tests cannot
 * catch (e.g. focus-management, dynamic content, iframe issues).
 *
 * CI GATE: Any page that produces a critical or serious axe violation will
 * fail this test. Violations listed in KNOWN_EXCEPTIONS are exempted and
 * must be documented in docs/accessibility/known-violations.md.
 *
 * Routes covered:
 *   /             – Landing page
 *   /auth/login   – Login (phone OTP)
 *   /auth/register – Registration
 *   /help         – Help / FAQ
 *   /send         – Create gift form
 *   /dashboard    – User dashboard (authenticated)
 *   /notifications – Notification centre (authenticated)
 *   /claim        – Gift claim landing
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// ─── Known acceptable violations ─────────────────────────────────────────────
// Each entry MUST have a corresponding entry in
// docs/accessibility/known-violations.md.

const KNOWN_EXCEPTIONS: string[] = [
  // GiftCard: <button> nested inside <article role="button">
  // Tracked: docs/accessibility/known-violations.md
  "nested-interactive",
];

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Run axe on the current page and assert no unexcepted critical/serious
 * violations. Prints a structured summary if the test fails.
 */
async function assertNoViolations(page: import("@playwright/test").Page, route: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const blocking = results.violations.filter(
    (v) => (v.impact === "critical" || v.impact === "serious") && !KNOWN_EXCEPTIONS.includes(v.id)
  );

  if (blocking.length > 0) {
    const summary = blocking
      .map(
        (v) =>
          `  [${v.impact}] ${v.id}: ${v.description}\n` +
          v.nodes
            .slice(0, 2)
            .map((n) => `    → ${n.html}`)
            .join("\n")
      )
      .join("\n\n");

    throw new Error(
      `[${route}] axe found ${blocking.length} critical/serious violation(s):\n${summary}\n\n` +
        `Add rule IDs to KNOWN_EXCEPTIONS if pre-existing, with a docs/accessibility/known-violations.md entry.`
    );
  }

  // Attach full results as an annotation for the HTML report
  test.info().annotations.push({
    type: "axe-violations",
    description: `${route}: ${results.violations.length} total violation(s), ${blocking.length} blocking`,
  });
}

// ─── Unauthenticated public routes ────────────────────────────────────────────

test.describe("axe-core — public routes", () => {
  test("/ (landing page) has no blocking violations", async ({ page }) => {
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    );
    await page.goto("/");
    await assertNoViolations(page, "/");
  });

  test("/auth/login has no blocking violations", async ({ page }) => {
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    );
    await page.goto("/auth/login");
    // Wait for interactive elements to be ready
    await page.waitForLoadState("domcontentloaded");
    await assertNoViolations(page, "/auth/login");
  });

  test("/auth/register has no blocking violations", async ({ page }) => {
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    );
    await page.goto("/auth/register");
    await page.waitForLoadState("domcontentloaded");
    await assertNoViolations(page, "/auth/register");
  });

  test("/help has no blocking violations", async ({ page }) => {
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    );
    await page.goto("/help");
    await page.waitForLoadState("domcontentloaded");
    await assertNoViolations(page, "/help");
  });

  test("/claim has no blocking violations", async ({ page }) => {
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    );
    await page.goto("/claim");
    await page.waitForLoadState("domcontentloaded");
    await assertNoViolations(page, "/claim");
  });
});

// ─── Authenticated routes ─────────────────────────────────────────────────────

test.describe("axe-core — authenticated routes", () => {
  const SESSION_MOCK = {
    user: {
      id: "test-user-axe",
      phone: "+2348099000001",
      name: "Axe Test User",
    },
    expires: "9999-12-31T23:59:59.000Z",
  };

  test.beforeEach(async ({ page }) => {
    // Inject a valid session so authenticated pages render
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SESSION_MOCK),
      })
    );

    // Stub API calls so pages load without a real backend
    await page.route("**/api/v1/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [] }),
      })
    );
  });

  test("/send has no blocking violations", async ({ page }) => {
    await page.goto("/send");
    await page.waitForLoadState("domcontentloaded");
    await assertNoViolations(page, "/send");
  });

  test("/dashboard has no blocking violations", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await assertNoViolations(page, "/dashboard");
  });

  test("/notifications has no blocking violations", async ({ page }) => {
    await page.goto("/notifications");
    await page.waitForLoadState("domcontentloaded");
    await assertNoViolations(page, "/notifications");
  });
});
