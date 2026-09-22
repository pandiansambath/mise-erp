import { test, expect } from "@playwright/test";
const OUT = "C:/Users/pandi/AppData/Local/Temp/claude/c--pandi-project-nirai-try1/b2b5b43d-8ddb-48ca-be6f-f1ae1e7d2215/scratchpad/shots";
async function signIn(page: any) {
  await page.goto("/login");
  await page.locator('#li-email:visible').first().fill("control@mise.app");
  await page.locator('#li-password:visible').first().fill("Control@2026");
  await page.locator('#li-password:visible').first().press("Enter");
  await page.waitForTimeout(6000);
}
test("node sheet + money page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/control-room/graph");
  await page.waitForTimeout(8000);
  // click the NIRAI.Reading node group by its aria-label
  const g = page.locator('g[role="button"]').filter({ hasText: "NIRAI.Reading" }).first();
  try { await g.click({ force: true, timeout: 6000 }); } catch { 
    await page.locator('g[role="button"]').nth(4).click({ force: true });
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/map-sheet.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  await page.goto("/control-room/money");
  await page.waitForTimeout(10000);
  await page.screenshot({ path: `${OUT}/money-top.png` });
  const txt = await page.evaluate(() => (document.body.innerText || "").slice(0, 4000));
  console.log("MONEYTEXT>>>", txt);
  expect(true).toBe(true);
});
test("mobile sheet 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/control-room/money");
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT}/money-390.png` });
  expect(true).toBe(true);
});
