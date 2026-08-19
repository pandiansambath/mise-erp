import { test, expect, type Page } from "@playwright/test";
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
test("the printable cards", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/tables");
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${S}/80-tables.png` });
  // Did the QR images actually decode?
  const broken = await page.evaluate(() =>
    [...document.querySelectorAll("img")].filter((i) => !i.complete || i.naturalWidth === 0).length,
  );
  const total = await page.locator("img").count();
  console.log(`images: ${total}, broken: ${broken}`);
  expect(broken, "QR images still not rendering").toBe(0);
});
