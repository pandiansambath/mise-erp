import { test, expect, type Page } from "@playwright/test";
const EMAIL = "owner@nirai.com";
const PASSWORD = "StrongPass123!";
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
test("orders: the chip that said 15 and showed 0", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await page.goto("/purchasing");
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /^Orders/ }).first().click();
  await page.waitForTimeout(2500);
  const chip = page.locator("button").filter({ hasText: /^Still to arrive\s*\d+$/ }).first();
  const label = (await chip.innerText()).replace(/\s+/g, " ").trim();
  await chip.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "e2e/__screens__/orders-chip.png" });
  const line = page.locator("p:visible", { hasText: /showing/ }).first();
  const txt = await line.innerText();
  console.log(`chip "${label}" -> ${txt.replace(/\s+/g, " ")}`);
  const claimed = parseInt(label.match(/(\d+)$/)?.[1] ?? "0", 10);
  const got = parseInt(txt.match(/showing\s*(\d+)/)?.[1] ?? "-1", 10);
  expect(got, "the list must show what the chip claims").toBe(claimed);
});
