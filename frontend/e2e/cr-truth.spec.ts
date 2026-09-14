import { test, expect } from "@playwright/test";

const OUT = "C:/Users/pandi/AppData/Local/Temp/claude/c--pandi-project-nirai-try1/b2b5b43d-8ddb-48ca-be6f-f1ae1e7d2215/scratchpad";

// The OPERATOR account. superadmin@gmail.com is NOT is_platform_owner and the
// control-room layout bounces it to /dashboard, so a screenshot taken with it
// is a screenshot of the wrong page.
test("control room as it really is", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/login");
  await page.locator('#li-email:visible, [data-testid="login-email"]:visible').first().fill("control@mise.app");
  await page.locator('#li-password:visible, [data-testid="login-password"]:visible').first().fill("Control@2026");
  await page.locator('button[type="submit"]:visible').first().click();
  await page.waitForTimeout(5000);
  console.log("AFTER LOGIN URL:", page.url());
  await page.goto("/control-room");
  await page.waitForTimeout(7000);
  console.log("CONTROL ROOM URL:", page.url());
  const h = await page.evaluate(() => document.body.scrollHeight);
  console.log("SCROLLHEIGHT", h, "=", (h / 1080).toFixed(1), "screens");
  await page.screenshot({ path: `${OUT}/truth-1920-top.png` });
  for (const [i, y] of [1000, 2200, 3400, 4600].entries()) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/truth-1920-${i + 1}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  const hm = await page.evaluate(() => document.body.scrollHeight);
  console.log("MOBILE SCROLLHEIGHT", hm, "=", (hm / 844).toFixed(1), "screens");
  await page.screenshot({ path: `${OUT}/truth-390-top.png` });
  expect(true).toBe(true);
});
