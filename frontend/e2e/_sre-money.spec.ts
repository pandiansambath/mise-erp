import { test, expect } from "@playwright/test";

const OUT = "C:/Users/pandi/AppData/Local/Temp/claude/c--pandi-project-nirai-try1/b2b5b43d-8ddb-48ca-be6f-f1ae1e7d2215/scratchpad";

test("control-room money page after the aws bill collector ran", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto("/login");
  await page.locator('#li-email:visible, [data-testid="login-email"]:visible').first().fill("control@mise.app");
  await page.locator('#li-password:visible, [data-testid="login-password"]:visible').first().fill("Control@2026");
  await page.locator('button[type="submit"]:visible').first().click();
  await page.waitForTimeout(6000);
  console.log("AFTER LOGIN URL:", page.url());

  // capture the API payload the page renders from
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/platform/costs") && r.status() === 200, { timeout: 60_000 }).catch(() => null),
    page.goto("/control-room/money"),
  ]);
  await page.waitForTimeout(9000);
  console.log("MONEY URL:", page.url());
  if (resp) {
    const j = await resp.json().catch(() => null);
    console.log("COSTS PAYLOAD:", JSON.stringify(j).slice(0, 4000));
  }

  const h = await page.evaluate(() => document.body.scrollHeight);
  console.log("SCROLLHEIGHT", h);
  await page.screenshot({ path: `${OUT}/money-top.png` });
  for (const [i, y] of [900, 1800, 2700, 3600].entries()) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/money-${i + 1}.png` });
  }
  const text = await page.evaluate(() => document.body.innerText);
  console.log("PAGE TEXT >>>\n" + text.slice(0, 6000) + "\n<<< END");
  expect(true).toBe(true);
});
