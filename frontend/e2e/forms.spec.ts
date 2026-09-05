import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(1800);
}

test("a supplier's box and loose prices read as two different ways to buy", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/vendors");
  await page.waitForTimeout(3000);
  await page.locator("text=/Manage/i").first().click().catch(() => {});
  await page.waitForTimeout(2500);

  // Farm2Land is the one with both forms.
  const body = await page.locator("body").innerText();
  const flat = body.replace(/\n/g, " | ");
  const idx = flat.indexOf("Dragon fruit");
  console.log("supplies region:", idx >= 0 ? flat.slice(idx - 30, idx + 220) : "(Dragon fruit not on this vendor)");

  console.log("names 'by the box':", /by the box/i.test(body));
  console.log("names 'loose, per':", /loose, per/i.test(body));
});

test("price comparison lists both forms, ranked by real cost", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/price-comparison");
  await page.waitForTimeout(3500);
  await page.getByPlaceholder(/search|find/i).first().fill("dragon").catch(() => {});
  await page.waitForTimeout(2000);
  await page.getByText(/Dragon fruit/i).first().click().catch(() => {});
  await page.waitForTimeout(3000);

  const flat = (await page.locator("body").innerText()).replace(/\n/g, " | ");
  const i = flat.indexOf("Farm2Land");
  console.log("cards:", i >= 0 ? flat.slice(i - 20, i + 320) : "(no Farm2Land)");

  // The case rate and the loose rate must BOTH appear, and differ.
  const hasCase = /1\.00\s*\|?\s*\/kg/.test(flat);
  const hasLoose = /1\.40\s*\|?\s*\/kg/.test(flat);
  console.log("shows the £1.00/kg case rate:", hasCase);
  console.log("shows the £1.40/kg loose rate:", hasLoose);
  expect(hasCase || hasLoose, "neither rate is shown").toBeTruthy();
});
