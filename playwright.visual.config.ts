import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for visual regression (snapshot) tests.
 *
 * Desktop:
 *   npm run test:visual
 *   npm run test:visual:update
 *
 * Mobile:
 *   npx playwright test --config playwright.visual.config.ts --project mobile-375
 *   npx playwright test --config playwright.visual.config.ts --project mobile-390
 *   npx playwright test --config playwright.visual.config.ts --project mobile-428
 *
 * Update all mobile baselines at once:
 *   npm run test:visual:update -- --project=mobile-375 --project=mobile-390 --project=mobile-428
 *
 * Pixel-diff threshold: 0.5% (maxDiffPixelRatio: 0.005).
 * CI fails if any snapshot exceeds this threshold.
 *
 * Flaky tests: quarantine per CONTRIBUTING.md §"Flaky screenshot tests".
 * New or updated snapshots in e2e/visual/__snapshots__/ require PR review
 * (enforced via CODEOWNERS).
 *
 * Closes #107, #299
 */
export default defineConfig({
  testDir: "./e2e/visual",
  snapshotDir: "./e2e/visual/__snapshots__",
  timeout: 30_000,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  expect: {
    toHaveScreenshot: {
      // CI requires strict 0.5% tolerance to catch real layout regressions
      // while avoiding false positives from sub-pixel anti-aliasing.
      maxDiffPixelRatio: 0.005,
    },
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "off",
  },
  projects: [
    // ── Desktop ──────────────────────────────────────────────────────────────
    {
      name: "chromium",
      testMatch: /components\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },

    // ── Mobile viewports (Issue #299) ─────────────────────────────────────────
    // Three most common iPhone widths: SE/8/12mini, 14/15/16, 14+/15+/16+.
    // The mobile.spec.ts test file reads the project name to derive the
    // viewport label appended to every snapshot filename.
    {
      name: "mobile-375",
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices["iPhone SE"],
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-390",
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices["iPhone 14"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-428",
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices["iPhone 14 Plus"],
        viewport: { width: 428, height: 926 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
