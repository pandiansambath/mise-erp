import { test, expect } from "@playwright/test";

// TEMP QA SPEC — not part of the suite, deleted after this run.
// Verifies: after signup, land signed-in on /setup (not a "check your inbox"
// screen), the amber verify-banner is visible with a Resend button, and
// /dashboard loads while unverified.

const HOTEL_NAME = "QA Temp Kitchen 9300";
const EMAIL = "qa-temp-9300@example.invalid";
const PASSWORD = "QaTemp9300pass!";

test("signup lands signed-in on /setup with verify banner", async ({ page }) => {
  // The AuthGate mounts BOTH the desktop-cinema and mobile-card SignupForm at
  // once (responsive CSS toggles which is visible) — so #su-hotel etc. exist
  // TWICE in the DOM. `:visible` picks whichever one the current viewport
  // actually shows; a bare id selector throws a strict-mode violation here.
  await page.goto("/signup");
  await page.waitForSelector("#su-hotel:visible", { timeout: 15000 });

  await page.locator("#su-hotel:visible").fill(HOTEL_NAME);
  await page.locator("#su-email:visible").fill(EMAIL);
  await page.locator("#su-password:visible").fill(PASSWORD);

  await page.screenshot({ path: "e2e/__screens__/qa-signup-before-submit.png" });

  await Promise.all([
    page.waitForURL(/\/setup/, { timeout: 20000 }),
    page.getByRole("button", { name: /create my restaurant/i }).locator("visible=true").click(),
  ]);

  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: "e2e/__screens__/qa-signup-after-submit-setup.png", fullPage: true });

  console.log("FINAL_URL_AFTER_SUBMIT=" + page.url());

  // Must NOT be the "check your inbox" screen.
  const inboxCopy = page.getByText(/check your inbox|confirmation link/i);
  const inboxVisible = await inboxCopy.first().isVisible().catch(() => false);
  console.log("INBOX_SCREEN_VISIBLE=" + inboxVisible);

  const banner = page.getByTestId("verify-banner");
  await expect(banner).toBeVisible({ timeout: 10000 });
  const bannerText = await banner.innerText();
  console.log("BANNER_TEXT=" + bannerText.replace(/\n/g, " "));

  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle").catch(() => {});
  console.log("FINAL_URL_DASHBOARD=" + page.url());
  await page.screenshot({ path: "e2e/__screens__/qa-signup-dashboard.png", fullPage: true });

  const dashBanner = page.getByTestId("verify-banner");
  const dashBannerVisible = await dashBanner.isVisible().catch(() => false);
  console.log("DASHBOARD_BANNER_VISIBLE=" + dashBannerVisible);
});
