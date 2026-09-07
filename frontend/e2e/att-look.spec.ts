import { test, type Page } from "@playwright/test";

/** Look at attendance the way he does. Two questions I refuse to answer from
 *  the CSS: what theme is he actually on, and what does the "mild red" resolve
 *  to on it. Plus the leave panel, which he says opens inside the sheet. */

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

test("attendance, as he sees it", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto(`${BASE}/attendance`);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: "e2e-out/att-page.png", fullPage: true });

  const theme = await page.evaluate(() => {
    const app = document.querySelector(".mise-app") as HTMLElement | null;
    const reds = Array.from(document.querySelectorAll('[class*="rose"]')).slice(0, 8).map((el) => {
      const cs = getComputedStyle(el);
      return {
        cls: (el.className || "").toString().slice(0, 90),
        color: cs.color,
        bg: cs.backgroundColor,
        text: (el.textContent || "").trim().slice(0, 40),
      };
    });
    return {
      mode: app?.getAttribute("data-mode"),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      reds,
    };
  });
  console.log("THEME " + JSON.stringify(theme, null, 1));

  // Open a person, then the leave panel — the thing he says makes a scrollbar.
  const card = page.locator('[data-testid="att-person"], button:has-text("Open")').first();
  if ((await card.count()) === 0) {
    // fall back: the person cards are clickable divs
    await page.locator("main").getByRole("button").nth(4).click().catch(() => {});
  } else {
    await card.click().catch(() => {});
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "e2e-out/att-person.png" });

  const leave = page.getByRole("button", { name: /Leave/i }).first();
  if ((await leave.count()) > 0) {
    await leave.click();
    await page.waitForTimeout(1200);
    const box = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]') as HTMLElement | null;
      const body = dlg?.querySelector(".mise-noscrollbar") as HTMLElement | null;
      return {
        dialog: dlg ? { w: Math.round(dlg.getBoundingClientRect().width), h: Math.round(dlg.getBoundingClientRect().height) } : null,
        bodyScrollH: body?.scrollHeight ?? null,
        bodyClientH: body?.clientHeight ?? null,
        scrolls: body ? body.scrollHeight > body.clientHeight + 1 : null,
      };
    });
    console.log("LEAVE " + JSON.stringify(box));
    await page.screenshot({ path: "e2e-out/att-leave.png" });
  }
  await ctx.close();
});
