// The sort he called confusing: are the dates actually in order?
import { test, expect, type Page } from "@playwright/test";
const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";
async function login(page: Page) {
  await page.goto("/login");
  await page.locator('[data-testid="login-email"]:visible').first().fill(EMAIL);
  await page.locator('[data-testid="login-password"]:visible').first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(2500);
}
test("the dates on screen are in the order the sort claims", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/purchasing");
  await page.getByTestId("category-tile").first().waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: /^Orders/ }).first().click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "all", exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(2500);

  // Read the run headers and pull the date out of each. The previous selector
  // matched nothing and the test passed on ZERO samples — which proves nothing
  // at all, and is exactly the shape of green tick worth distrusting.
  const heads = await page
    .locator("button:visible", { hasText: /Purchase ·|Orders with no indent/ })
    .allInnerTexts();
  const dates = heads
    .map((t) => (t.match(/\d{4}-\d{2}-\d{2}/) ?? [])[0])
    .filter(Boolean) as string[];
  console.log("first 8 dates as shown:", dates.slice(0, 8).join("  "));

  // Newest first: each date must be <= the one before it.
  let broken = 0;
  for (let i = 1; i < dates.length; i++) if (dates[i] > dates[i - 1]) broken += 1;
  console.log(`${dates.length} dates, ${broken} out of order`);
  expect(dates.length, "the check must actually have samples to check").toBeGreaterThan(3);
  expect(broken, "a list sorted newest-first must not go back up").toBe(0);
  await page.screenshot({ path: "e2e/__screens__/sorted.png" });
});
