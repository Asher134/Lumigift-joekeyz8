/**
 * e2e: SMS claim deep link (Issue #366)
 *
 * Covers:
 *  1. SMS link → login redirect → token survives → claim page resolves the gift
 *  2. Expired token shows an informative error
 */

import { test, expect, type Page } from "@playwright/test";

const GIFT_ID = "00000000-0000-0000-0000-000000000001";
const TOKEN = "sms-claim-token";

async function mockSession(page: Page, state: { loggedIn: boolean }) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        state.loggedIn
          ? {
              user: { id: "test-user-id", phone: "+2348012345678" },
              expires: new Date(Date.now() + 86_400_000).toISOString(),
            }
          : {}
      ),
    })
  );
}

test("SMS link → login → claim resolves the gift", async ({ page }) => {
  const session = { loggedIn: false };
  await mockSession(page, session);

  let requestedToken: string | null = null;
  await page.route("**/api/v1/gifts/claim-token**", (route) => {
    requestedToken = new URL(route.request().url()).searchParams.get("token");
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { giftId: GIFT_ID } }),
    });
  });

  await page.goto(`/claim?token=${TOKEN}`);
  await expect(page).toHaveURL(/\/auth\/login\?callbackUrl=%2Fclaim/);

  // Login completes and NextAuth returns the user to the callbackUrl (no token in URL)
  session.loggedIn = true;
  await page.goto("/claim");

  await expect(page).toHaveURL(new RegExp(`/gifts/${GIFT_ID}`));
  expect(requestedToken).toBe(TOKEN);
});

test("expired claim token shows an informative error", async ({ page }) => {
  await mockSession(page, { loggedIn: true });
  await page.route("**/api/v1/gifts/claim-token**", (route) =>
    route.fulfill({
      status: 410,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: "This claim link has expired." }),
    })
  );

  await page.goto(`/claim?token=${TOKEN}`);
  await expect(page.getByRole("alert")).toHaveText(/expired/i);
});
