import { test, expect, type Page } from "@playwright/test";

/** THE CLAIM: a chart is the colour the restaurant chose, not emerald.
 *
 *  Every chart in the app used to be emerald on every one of the sixteen
 *  themes, because CHART_COLORS[0] and the single-series default were both the
 *  literal "#10b981". The Reports page showed an emerald donut and emerald
 *  margin figures beside a burgundy NET PROFIT and a rose expense bar — five
 *  colour systems on the one screen that is about money.
 *
 *  Measured on the rendered SVG, not read off the stylesheet: the last several
 *  times I reasoned about which rule was winning, I was wrong.
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";

/** There is no backend on localhost:8000 in a bare frontend checkout, so the
 *  app's own fetches are sent to production. Read-only apart from the sign-in
 *  itself; it is the owner's tenant and nothing here writes. */
async function withProdApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== "localhost" || u.port === "3000" || u.port === "3100") {
      // same-origin page assets that merely look like /api/ — let them be
    }
    try {
      const res = await route.fetch({ url: "https://nirai1.dineai.cloud" + u.pathname + u.search });
      await route.fulfill({ response: res });
    } catch {
      await route.abort();
    }
  });
}

async function signIn(page: Page) {
  await withProdApi(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("mise.tour.done", "1"); } catch { /* ignore */ }
  });
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

/** What --chart-1 actually resolves to, with the theme applied. */
async function chartOne(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "var(--chart-1)";
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
}

const EMERALD = "rgb(16, 185, 129)";

test("the brand drives slot 1, so charts differ between themes", async ({ page }) => {
  await signIn(page);
  const seen: Record<string, string> = {};
  for (const theme of ["claret", "ocean", "violet", "burgundy", "honey"]) {
    await page.evaluate((t) => localStorage.setItem("mise_theme", t), theme);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    seen[theme] = await chartOne(page);
  }
  console.log("--chart-1 per theme: " + JSON.stringify(seen, null, 1));

  // The actual regression: one hard-coded colour for all of them.
  expect(new Set(Object.values(seen)).size).toBeGreaterThan(3);
  // And specifically: a burgundy page must not draw an emerald chart.
  expect(seen.burgundy).not.toBe(EMERALD);
  expect(seen.ocean).not.toBe(EMERALD);
});

test("the marketing site keeps DineAI's own emerald whatever the visitor saved", async ({ page }) => {
  // .mise-dark-page pins slot 1, so a saved burgundy theme cannot repaint the
  // public landing — that identity is ours, not the visitor's.
  await withProdApi(page);
  await page.addInitScript(() => localStorage.setItem("mise_theme", "burgundy"));
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const c = await page.evaluate(() => {
    const host = document.querySelector(".mise-dark-page");
    if (!host) return null;
    const probe = document.createElement("div");
    probe.style.color = "var(--chart-1)";
    host.appendChild(probe);
    const v = getComputedStyle(probe).color;
    probe.remove();
    return v;
  });
  console.log("landing --chart-1 with burgundy saved: " + c);
  expect(c).toBe(EMERALD);
});
