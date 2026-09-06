import { test, type Page } from "@playwright/test";

/** The whole of each page, so I can see what sits below the fold before
 *  deciding what deserves to be above it. */

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";

async function signIn(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
    } catch {
      /* ignore */
    }
  });
  await page.goto(`${BASE}/login`);
  await page
    .locator('[data-testid="login-email"]:visible, #li-email:visible')
    .first()
    .fill("superadmin@gmail.com");
  await page
    .locator('[data-testid="login-password"]:visible, #li-password:visible')
    .first()
    .fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

test("full pages", async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await signIn(page);

  for (const path of ["/rota", "/attendance", "/menu"]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(5000);
    // main is the scroll container at lg, so grow the window instead of
    // asking for fullPage — fullPage on an inner scroller captures one screen.
    const h = await page.evaluate(() => document.querySelector("main")!.scrollHeight);
    await page.setViewportSize({ width: 1280, height: Math.min(h + 120, 3000) });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `e2e-out/full-${path.slice(1)}.png` });
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  await ctx.close();
});
