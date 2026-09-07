import { test, type Page } from "@playwright/test";

/** Look at Menu and Tables & QR before rebuilding either. He said "rebuild from
 *  scratch" about both, and a rebuild that does not know what was wrong just
 *  produces a different thing that is also wrong. */

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";

async function signIn(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem("mise.tour.done", "1"); } catch { /* ignore */ }
  });
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

test("menu and tables, as they stand", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);

  for (const [path, shot] of [["/menu", "menu"], ["/tables", "tables"]] as const) {
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `e2e-out/${shot}-now.png`, fullPage: true });
    const m = await page.evaluate(() => ({
      h: document.documentElement.scrollHeight,
      view: window.innerHeight,
      cards: document.querySelectorAll("[data-testid]").length,
    }));
    console.log(`${path} ${JSON.stringify(m)}`);
  }
  await ctx.close();
});
