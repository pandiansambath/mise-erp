import { test, type Page } from "@playwright/test";

/** Look at the rebuilt rota, desktop and phone. He said "build the full page
 *  from scratch" and called the old one clumsy and tight — a passing assertion
 *  cannot answer whether that is fixed. */

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

for (const [label, width, height] of [
  ["desktop", 1280, 800],
  ["phone", 390, 844],
] as const) {
  test(`the rota as it stands — ${label}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({
      viewport: { width, height },
      isMobile: label === "phone",
      hasTouch: label === "phone",
    });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${BASE}/rota`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(5000);

    const m = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      const el = main.scrollHeight > window.innerHeight ? main : document.documentElement;
      const days = document.querySelectorAll('[data-testid="rota-day"]');
      const first = days[0]?.getBoundingClientRect();
      return {
        screensTall: +(el.scrollHeight / window.innerHeight).toFixed(2),
        sideways:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        days: days.length,
        firstDayTop: first ? Math.round(first.top) : -1,
      };
    });
    console.log(`ROTA ${label}:`, JSON.stringify(m));
    await page.screenshot({ path: `e2e-out/rota-${label}.png`, fullPage: false });
    await ctx.close();
  });
}
