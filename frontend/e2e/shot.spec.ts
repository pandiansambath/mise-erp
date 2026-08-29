import { test } from "@playwright/test";
const BASE = "https://nirai1.dineai.cloud";

test("shoot the swept pages", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    try { localStorage.setItem("mise.tour.done", "1"); } catch { /* */ }
  });
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  // Reference first, so the comparison is in the same run and same theme.
  for (const [path, name] of [
    ["/staff", "A-ref-staff"],
    ["/employees", "B-employees"],
    ["/documents", "C-documents"],
    ["/sales", "D-sales"],
  ] as const) {
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `e2e/__screens__/sweep-${name}.png` });
    console.log("shot", path);
  }

  // Expenses needs a range with data in it.
  await page.goto(`${BASE}/expenses`);
  await page.waitForTimeout(4000);
  await page.locator('button[aria-haspopup="dialog"]').first().click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /^This year/ }).first().click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: "e2e/__screens__/sweep-E-expenses.png" });
  console.log("shot /expenses");
});
