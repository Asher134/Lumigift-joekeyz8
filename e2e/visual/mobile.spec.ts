/**
 * Mobile visual regression tests — Issue #299
 *
 * Captures screenshots at the three most common iPhone viewport widths:
 *   • 375 px  — iPhone SE / iPhone 8 / iPhone 12 mini
 *   • 390 px  — iPhone 14 / 15 / 16 (standard)
 *   • 428 px  — iPhone 14 Plus / 15 Plus / 16 Plus
 *
 * All five key pages are covered:
 *   landing (/), send (/send), dashboard (/dashboard), claim (/gifts/:id), login (/auth/login)
 *
 * SNAPSHOT STABILITY
 * ──────────────────
 * - All timestamps come from VISUAL_SEED_EPOCH (2024-01-15T10:00:00Z) — never use Date.now().
 * - Authenticated pages mock the NextAuth session and gift API routes.
 * - Snapshots are stored in e2e/visual/__snapshots__/ (same dir as desktop snapshots).
 * - CI fails on pixel diff > 0.5 % (maxDiffPixelRatio: 0.005).
 *
 * UPDATE SNAPSHOTS
 * ────────────────
 *   npm run test:visual:update -- --project=mobile-375 --project=mobile-390 --project=mobile-428
 *
 * Flaky test policy: see CONTRIBUTING.md §"Flaky screenshot tests".
 *
 * Closes #299
 */

import { test, expect, type Page } from "@playwright/test";
import {
  GIFT_LOCKED,
  GIFT_UNLOCKED,
  GIFT_CLAIMED,
  ALL_GIFT_FIXTURES,
  giftApiResponse,
  giftsListApiResponse,
  VISUAL_SEED_EPOCH,
  VISUAL_USERS,
} from "./fixtures";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Freeze `Date.now()` and `new Date()` in the page to the seed epoch so
 * "time ago" / "time until" labels never change between CI runs.
 */
async function freezeClock(page: Page): Promise<void> {
  await page.addInitScript((epoch: number) => {
    const OriginalDate = Date;
    const frozenNow = epoch;

    class FrozenDate extends OriginalDate {
      constructor(...args: ConstructorParameters<typeof OriginalDate>) {
        if (args.length === 0) {
          super(frozenNow);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          super(...(args as [any]));
        }
      }
      static now(): number {
        return frozenNow;
      }
    }

    // @ts-expect-error — intentional runtime override for test determinism
    globalThis.Date = FrozenDate;
  }, VISUAL_SEED_EPOCH);
}

/** Mock the NextAuth session as VISUAL_USERS.alice. */
async function mockSession(page: Page): Promise<void> {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: VISUAL_USERS.alice.id,
          phone: VISUAL_USERS.alice.phone,
          name: VISUAL_USERS.alice.displayName,
        },
        expires: new Date(VISUAL_SEED_EPOCH + 86_400_000).toISOString(),
      }),
    })
  );
}

/** Mock all gift API routes used by dashboard and claim pages. */
async function mockGiftRoutes(page: Page): Promise<void> {
  // List endpoint for dashboard
  await page.route("**/api/v1/gifts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(giftsListApiResponse(ALL_GIFT_FIXTURES)),
    })
  );

  // Individual gift endpoints for claim/detail pages
  for (const gift of ALL_GIFT_FIXTURES) {
    const fixture = gift; // capture for closure
    await page.route(`**/api/v1/gifts/${fixture.id}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(giftApiResponse(fixture)),
      })
    );
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────
//
// Playwright projects for mobile-375, mobile-390, and mobile-428 are defined
// in playwright.visual.config.ts. Each project sets a different viewport
// width; the same spec file runs once per project, producing separate snapshots
// named e.g. "landing-375px.png", "landing-390px.png", "landing-428px.png".
//
// Snapshot names encode the viewport so all three widths coexist in
// __snapshots__/ without collision.

/** Returns "375", "390", or "428" from the Playwright project name. */
function viewportLabel(projectName: string): string {
  const match = projectName.match(/(\d+)/);
  return match ? `${match[1]}px` : projectName;
}

// ─── Landing page ──────────────────────────────────────────────────────────────

test("mobile — landing page", async ({ page }, testInfo) => {
  const vp = viewportLabel(testInfo.project.name);
  await freezeClock(page);
  await page.goto("/");
  // Wait for above-the-fold content to settle
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot(`landing-${vp}.png`);
});

// ─── Send (gift creation) page ─────────────────────────────────────────────────

test("mobile — send page", async ({ page }, testInfo) => {
  const vp = viewportLabel(testInfo.project.name);
  await freezeClock(page);
  await mockSession(page);
  await page.goto("/send");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot(`send-${vp}.png`);
});

// ─── Dashboard ─────────────────────────────────────────────────────────────────

test("mobile — dashboard", async ({ page }, testInfo) => {
  const vp = viewportLabel(testInfo.project.name);
  await freezeClock(page);
  await mockSession(page);
  await mockGiftRoutes(page);
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot(`dashboard-${vp}.png`);
});

// ─── Claim / gift detail (locked gift) ────────────────────────────────────────

test("mobile — claim page (locked gift)", async ({ page }, testInfo) => {
  const vp = viewportLabel(testInfo.project.name);
  await freezeClock(page);
  await mockSession(page);
  await page.route(`**/api/v1/gifts/${GIFT_LOCKED.id}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(giftApiResponse(GIFT_LOCKED)),
    })
  );
  await page.goto(`/gifts/${GIFT_LOCKED.id}`);
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot(`claim-locked-${vp}.png`);
});

test("mobile — claim page (unlocked gift)", async ({ page }, testInfo) => {
  const vp = viewportLabel(testInfo.project.name);
  await freezeClock(page);
  await mockSession(page);
  await page.route(`**/api/v1/gifts/${GIFT_UNLOCKED.id}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(giftApiResponse(GIFT_UNLOCKED)),
    })
  );
  await page.goto(`/gifts/${GIFT_UNLOCKED.id}`);
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot(`claim-unlocked-${vp}.png`);
});

test("mobile — claim page (claimed gift)", async ({ page }, testInfo) => {
  const vp = viewportLabel(testInfo.project.name);
  await freezeClock(page);
  await mockSession(page);
  await page.route(`**/api/v1/gifts/${GIFT_CLAIMED.id}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(giftApiResponse(GIFT_CLAIMED)),
    })
  );
  await page.goto(`/gifts/${GIFT_CLAIMED.id}`);
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot(`claim-claimed-${vp}.png`);
});

// ─── Login page ────────────────────────────────────────────────────────────────

test("mobile — login page", async ({ page }, testInfo) => {
  const vp = viewportLabel(testInfo.project.name);
  await freezeClock(page);
  // No session mock — login page must render unauthenticated
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  );
  await page.goto("/auth/login");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot(`login-${vp}.png`);
});
