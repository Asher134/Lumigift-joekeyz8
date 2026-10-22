/**
 * E2E: Full gift send and claim journey
 *
 * Issue #287: Add end-to-end test for the full gift send and claim flow
 *
 * Covers the complete happy path:
 *   register user A → create gift → pay via Paystack mock
 *   → fast-forward time past unlock date → claim as user B
 *
 * All external services (OTP, Paystack, Stellar) are intercepted via
 * Playwright route mocks — no real network calls leave the browser.
 *
 * Runs on Chromium, Firefox, and WebKit (configured in playwright.config.ts).
 */

import { test, expect, type Page } from "@playwright/test";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const USER_A_PHONE = "+2348011111111";
const USER_B_PHONE = "+2348022222222";
const TEST_OTP = "123456";
const GIFT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PAYSTACK_REF = `lumigift_e2e_${Date.now()}`;
const STELLAR_KEY = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const TX_HASH =
  "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

// Unlock date in the past so the gift is immediately claimable after the
// time-manipulation step (we update the mock to reflect an unlocked state).
const PAST_UNLOCK = new Date(Date.now() - 1000).toISOString();
const FUTURE_UNLOCK = new Date(Date.now() + 86_400_000 * 7).toISOString();

// ─── Mock helpers ─────────────────────────────────────────────────────────────

async function mockOtp(page: Page) {
  await page.route("**/api/auth/send-otp", (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ success: true }) })
  );
  await page.route("**/api/auth/signin/credentials", (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({ url: "/dashboard" }),
    })
  );
  // NextAuth session endpoint
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "user-a-id", phone: USER_A_PHONE },
        expires: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    })
  );
}

async function mockGiftCreation(page: Page) {
  await page.route("**/api/v1/gifts", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            id: GIFT_ID,
            senderId: "user-a-id",
            recipientPhone: USER_B_PHONE,
            recipientName: "User B",
            amountNgn: 5000,
            amountUsdc: "3.0000000",
            message: "E2E test gift",
            unlockAt: FUTURE_UNLOCK,
            status: "pending_payment",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
      });
    }
    return route.continue();
  });
}

async function mockPaystackPayment(page: Page) {
  // Paystack initialisation
  await page.route("**/api/payments/initialize", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        authorizationUrl: `/api/payments/callback?reference=${PAYSTACK_REF}&giftId=${GIFT_ID}`,
        reference: PAYSTACK_REF,
      }),
    })
  );
  // Paystack callback — marks gift as paid/locked
  await page.route(
    `**/api/payments/callback*reference=${PAYSTACK_REF}*`,
    (route) =>
      route.fulfill({
        status: 302,
        headers: { Location: `/gifts/${GIFT_ID}?paid=1` },
      })
  );
}

async function mockGiftUnlocked(page: Page) {
  // After time fast-forward, gift is unlocked and claimable
  await page.route(`**/api/v1/gifts/${GIFT_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          id: GIFT_ID,
          recipientName: "User B",
          amountNgn: 5000,
          amountUsdc: "3.0000000",
          message: "E2E test gift",
          status: "unlocked",
          unlockAt: PAST_UNLOCK,
        },
      }),
    })
  );
  await page.route(`**/api/v1/gifts/${GIFT_ID}/claim`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        txHash: TX_HASH,
        amountUsdc: "3.0000000",
      }),
    })
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loginAs(page: Page, phone: string) {
  await page.goto("/auth/login");

  // Enter phone number
  const phoneInput = page.getByLabel(/phone/i).or(page.locator('input[type="tel"]')).first();
  await phoneInput.fill(phone);
  await page.getByRole("button", { name: /send.*otp|get.*code/i }).click();

  // Enter OTP
  const otpInput = page.getByLabel(/otp|code|pin/i).or(page.locator('input[inputmode="numeric"]')).first();
  await otpInput.fill(TEST_OTP);
  await page.getByRole("button", { name: /verify|confirm|login|sign in/i }).click();

  // Wait for redirect to dashboard or home
  await page.waitForURL(/dashboard|\/$/i, { timeout: 15_000 });
}

async function createGift(page: Page) {
  await page.goto("/send");

  await page.getByLabel(/recipient.*name/i).or(page.locator('[name="recipientName"]')).fill("User B");
  await page.getByLabel(/phone/i).or(page.locator('[name="recipientPhone"]')).fill(USER_B_PHONE);
  await page.getByLabel(/amount/i).or(page.locator('[name="amountNgn"]')).fill("5000");
  await page.getByLabel(/message/i).or(page.locator('[name="message"]')).fill("E2E test gift");

  // Unlock date — 7 days from now (ISO format for cross-browser compat)
  const unlockInput = page.getByLabel(/unlock.*date|date.*unlock/i).or(page.locator('[name="unlockAt"]')).first();
  const futureDate = new Date(Date.now() + 86_400_000 * 7).toISOString().slice(0, 16);
  await unlockInput.fill(futureDate);

  await page.getByRole("button", { name: /create.*gift|send.*gift|next/i }).click();
  await page.waitForURL(/pay|gift/, { timeout: 15_000 });
}

// ─── Test ─────────────────────────────────────────────────────────────────────

test.describe("Full gift send and claim journey", () => {
  test(
    "register → create gift → pay → fast-forward → claim",
    async ({ page }) => {
      // ── Step 1: Mock all external services ─────────────────────────────────
      await mockOtp(page);
      await mockGiftCreation(page);
      await mockPaystackPayment(page);

      // ── Step 2: User A logs in ──────────────────────────────────────────────
      await loginAs(page, USER_A_PHONE);
      await expect(page).toHaveURL(/dashboard|\//);

      // ── Step 3: User A creates a gift ──────────────────────────────────────
      await createGift(page);

      // Confirm gift ID is present somewhere on the payment page
      await expect(
        page.getByText(GIFT_ID).or(page.getByText(/5,?000|₦5/))
      ).toBeVisible({ timeout: 10_000 });

      // ── Step 4: User A pays via Paystack mock ──────────────────────────────
      await page.getByRole("button", { name: /pay|proceed|checkout/i }).click();

      // Paystack mock redirects back with ?paid=1
      await page.waitForURL(/paid=1|gift.*paid/, { timeout: 15_000 });
      await expect(
        page
          .getByText(/payment.*success|gift.*created|confirmed/i)
          .or(page.getByRole("heading", { name: /success/i }))
      ).toBeVisible({ timeout: 10_000 });

      // ── Step 5: Fast-forward time — switch to unlocked mock ────────────────
      // In a real environment this would use a Docker-seeded gift with a past
      // unlockAt. Here we update the route mock to return "unlocked" status.
      await mockGiftUnlocked(page);

      // ── Step 6: User B visits the gift claim page ──────────────────────────
      // Update session mock to reflect User B
      await page.route("**/api/auth/session", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            user: { id: "user-b-id", phone: USER_B_PHONE },
            expires: new Date(Date.now() + 3_600_000).toISOString(),
          }),
        })
      );

      await page.goto(`/gifts/${GIFT_ID}?stellarKey=${STELLAR_KEY}`);

      // Gift should show as unlocked with amount visible
      await expect(page.getByText(/₦.*5,?000|3\.00.*USDC/i)).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByRole("button", { name: /claim.*gift|claim/i })
      ).toBeVisible();

      // ── Step 7: User B claims the gift ─────────────────────────────────────
      await page.getByRole("button", { name: /claim.*gift|claim/i }).click();

      // Confirm success — tx hash is displayed
      await expect(
        page.getByText(TX_HASH).or(page.getByText(/success|claimed|transaction/i))
      ).toBeVisible({ timeout: 15_000 });
    }
  );
});
