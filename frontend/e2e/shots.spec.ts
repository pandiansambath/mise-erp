import { test, type Page } from "@playwright/test";
const S = "e2e/__shots__";
async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(2000);
}
test("one whole box", async ({ page }) => {
  test.setTimeout(220_000);
  await login(page);
  await page.goto("/purchasing");
  await page.getByTestId("category-tile").first().waitFor({ timeout: 90_000 });
  await page.getByTestId("category-tile").filter({ hasText: /fruit/i }).first().click();
  await page.waitForTimeout(1800);
  await page.locator("button:visible").filter({ hasText: /Dragon fruit/i }).first().click();
  await page.waitForTimeout(2200);
  const box = page.locator("button:visible", { hasText: /^box$/i }).first();
  if (await box.count()) { await box.click(); await page.waitForTimeout(1200); }
  const qty = page.locator("input:visible").first();
  await qty.fill("1");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${S}/03-one-box.png` });
});
