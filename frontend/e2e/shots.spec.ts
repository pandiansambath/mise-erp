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
test("kitchen + tables", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/kitchen");
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${S}/72-kitchen.png` });
  await page.goto("/tables");
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${S}/73-tables.png` });
});
