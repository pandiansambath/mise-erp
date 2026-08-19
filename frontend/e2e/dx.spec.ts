import { test, type Page } from "@playwright/test";
async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload(); await page.waitForTimeout(2000);
}
test("what is in the sheet", async ({ page }) => {
  test.setTimeout(200_000);
  await login(page);
  await page.goto("/inventory");
  await page.waitForTimeout(4000);
  const row = page.locator("tbody tr[aria-expanded]").filter({ hasText: /Dragon fruit/i }).first();
  await row.click();
  await page.waitForTimeout(4000);
  const t = (await page.locator("body").innerText()).replace(/\n/g, " | ");
  for (const probe of [
    "PURCHASES BY SUPPLIER", "Packs are not the same size", "Every way you can buy it",
    "Order / view in Purchasing", "one-off", "their 1 box",
  ]) console.log(`${probe.padEnd(30)} -> ${t.includes(probe)}`);
  const i = t.indexOf("Packs are not the same size");
  console.log("AFTER the amber note:", i >= 0 ? t.slice(i, i + 330) : "(amber note absent)");
});
