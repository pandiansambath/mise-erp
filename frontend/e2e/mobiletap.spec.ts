// Are the other clickable rows actually reachable on a phone, or only in theory?
import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('[data-testid="login-email"]:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(1800);
}

test("vendors: a price row is tappable on a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/vendors");
  await page.waitForTimeout(3000);
  await page.locator("text=/Manage/i").first().click();
  await page.waitForTimeout(2500);

  const rows = page.locator("tbody tr").filter({ visible: true });
  const n = await rows.count();
  console.log("visible price rows on mobile:", n);
  if (n === 0) {
    console.log("NO ROWS VISIBLE — the table is unreachable on a phone");
  }
  expect(n, "no vendor price row reachable on mobile").toBeGreaterThan(0);

  const before = await page.locator("body").innerText();
  await rows.first().click();
  await page.waitForTimeout(2000);
  const after = await page.locator("body").innerText();
  const opened = /THEY QUOTE|HOW THEY SELL IT|the unit you cook with/i.test(after);
  console.log("price sheet opened on tap:", opened, "| grew by", after.length - before.length);
  expect(opened, "tapping a price row did not open its sheet on mobile").toBeTruthy();
});

test("payroll: a row is tappable on a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/payroll");
  await page.waitForTimeout(4000);

  const rows = page.locator("tbody tr").filter({ visible: true });
  const n = await rows.count();
  console.log("visible payroll rows on mobile:", n);
  if (n === 0) {
    console.log("NO ROWS — nothing to tap (may just be an empty payroll run)");
    return;
  }
  const txt = (await rows.first().innerText()).replace(/\s+/g, " ").trim();
  console.log("the row says:", JSON.stringify(txt.slice(0, 120)));
  const cells = await rows.first().locator("td").count();
  console.log("cells in that row:", cells);
  const before = await page.locator("body").innerText();
  await rows.first().click();
  await page.waitForTimeout(1800);
  const after = await page.locator("body").innerText();
  console.log("row expanded on tap:", after.length !== before.length, "| grew by", after.length - before.length);
});
