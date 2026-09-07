import { test, type Page } from "@playwright/test";

/** "i tried dragging card... very very clumsy and tight nah, its scrolling
 *  inside that card." The inner scroll is gone; this checks that on the live
 *  site rather than assuming, and looks at what dragging feels like now. */

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

test("the rota week, and whether anything scrolls inside a day", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto(`${BASE}/rota`);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: "e2e-out/rota-now.png", fullPage: true });

  const days = await page.evaluate(() => {
    const cols = Array.from(document.querySelectorAll('[data-testid="rota-day"]'));
    return cols.map((el) => {
      const e = el as HTMLElement;
      const cs = getComputedStyle(e);
      return {
        h: Math.round(e.getBoundingClientRect().height),
        scrollH: e.scrollHeight,
        clientH: e.clientHeight,
        // The tell: a day that scrolls inside itself has more content than box.
        scrollsInside: e.scrollHeight > e.clientHeight + 1,
        overflowY: cs.overflowY,
      };
    });
  });
  console.log("DAYS " + JSON.stringify(days));

  // Does a shift card have any inner scroller?
  const inner = await page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll('[data-testid="rota-day"] *').forEach((el) => {
      const e = el as HTMLElement;
      const cs = getComputedStyle(e);
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 1) {
        bad.push(`${e.tagName}.${(e.className || "").toString().slice(0, 60)}`);
      }
    });
    return bad;
  });
  console.log("INNER SCROLLERS " + JSON.stringify(inner));
  await ctx.close();
});
