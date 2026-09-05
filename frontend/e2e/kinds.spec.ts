// The category labels, read off the live page. Every one of them said "other"
// once, because of a byte you cannot see — so this asserts they do not.
import { test, expect, type Page } from "@playwright/test";
const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";
async function login(page: Page) {
  await page.goto("/login");
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill(EMAIL);
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(2500);
}
test("categories are classified, not all 'other'", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/purchasing");
  await page.getByTestId("category-tile").first().waitFor({ timeout: 90_000 });
  const rows = await page.getByTestId("category-tile").allInnerTexts();
  const kinds = rows.map((r) => r.replace(/\s+/g, " ").trim());
  for (const k of kinds) console.log("  " + k);
  const other = kinds.filter((k) => / other$/.test(k)).length;
  console.log(`${other} of ${kinds.length} fell through to "other"`);
  // "Other" itself is legitimately other; nothing else should be.
  expect(other, "categories must be classified").toBeLessThanOrEqual(1);
});
