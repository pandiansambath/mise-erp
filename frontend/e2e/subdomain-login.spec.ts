import { expect, test } from "@playwright/test";

/**
 * A hotel's own subdomain is their STAFF DOOR, not the public shop window.
 *
 *   "if they open their hotel's subdomain here, login only need to show. it
 *    should not show register and all — coz already they register, then why
 *    again register button in their subdomain. so please remove that."
 *
 * AuthGate already claims to do this (`lockedToLogin`). Claiming is not the
 * same as doing, and this is a door — so it is checked on the live subdomain,
 * including the direct /signup URL, which is the way someone actually ends up
 * there.
 */

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";

test("a hotel subdomain offers sign-in and never registration", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto(`${BASE}/login`);
  await expect(page.locator("#li-email:visible").first()).toBeVisible({ timeout: 30_000 });

  // Nothing on the page should invite them to create a second hotel.
  const registerish = page.getByRole("link", { name: /register|sign up|start free|create account/i });
  expect(await registerish.count(), "a registration link is on the hotel's own door").toBe(0);

  const registerBtn = page.getByRole("button", { name: /register your hotel|sign up|create account/i });
  expect(await registerBtn.count(), "a registration button is on the hotel's own door").toBe(0);
});

test("/signup on a hotel subdomain lands on the sign-in door", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`${BASE}/signup`);

  // It should end up showing the login form, whatever the URL was.
  await expect(
    page.locator("#li-email:visible").first(),
    "/signup on a hotel subdomain did not fall back to sign-in",
  ).toBeVisible({ timeout: 30_000 });
});
