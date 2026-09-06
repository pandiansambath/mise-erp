import { test, type Page } from "@playwright/test";

/** Look at rota, attendance and menu as they stand — desktop and phone — before
 *  redesigning them. How far each page runs past the fold is the number that
 *  matters: "i hate scrolling". */

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
  test(`look at the three pages — ${label}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext({
      viewport: { width, height },
      isMobile: label === "phone",
      hasTouch: label === "phone",
    });
    const page = await ctx.newPage();
    await signIn(page);

    for (const path of ["/rota", "/attendance", "/menu"]) {
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(5000);

      const m = await page.evaluate(() => {
        const scroller =
          document.querySelector("main")!.scrollHeight > window.innerHeight
            ? document.querySelector("main")!
            : document.documentElement;
        return {
          screensTall: +(scroller.scrollHeight / window.innerHeight).toFixed(2),
          sideways:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
          buttons: document.querySelectorAll("main button").length,
          tables: document.querySelectorAll("main table").length,
          inputs: document.querySelectorAll("main input, main select, main textarea").length,
        };
      });
      console.log(`${label} ${path}:`, JSON.stringify(m));
      await page.screenshot({
        path: `e2e-out/now-${path.slice(1)}-${label}.png`,
        fullPage: false,
      });
    }
    await ctx.close();
  });
}
