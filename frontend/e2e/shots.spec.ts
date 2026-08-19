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
test("the rebuilt roles page", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/staff");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${S}/40-list.png` });

  // Open somebody who is not the owner.
  const cards = page.locator("[role='button']").filter({ hasText: /Can reach/ });
  const n = await cards.count();
  console.log("person cards:", n);
  for (let i = 0; i < n; i++) {
    const t = await cards.nth(i).innerText();
    if (!/owner/i.test(t)) { await cards.nth(i).click(); break; }
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${S}/41-sheet.png` });
});
