import { test, type Page } from "@playwright/test";

/**
 * WHERE THE TIME ACTUALLY GOES.
 *
 *   "site got heavy so site is always loading even for small small movement and
 *    navigations... i should not see that loading animation itself."
 *
 * Before changing a server, find out whether the server is the problem. This
 * walks the pages he walks and records, per page: how long until something is
 * painted, how long until the spinner is gone, how many API calls it made, how
 * long the slowest one took, and how much of that was WAITING versus
 * DOWNLOADING. Those two are different diagnoses with different fixes — a slow
 * backend is a bigger box, a waterfall of small calls is a frontend problem no
 * amount of RAM will help.
 */

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";

const WALK = ["/dashboard", "/sales", "/inventory", "/money", "/rota", "/attendance", "/staff"];

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

test("how slow is each page, and why", async ({ page }) => {
  test.setTimeout(600_000);
  await signIn(page);

  const rows: Record<string, unknown>[] = [];

  for (const path of WALK) {
    const calls: { url: string; ms: number; wait: number; size: number }[] = [];
    const onDone = async (r: import("@playwright/test").Response) => {
      const u = r.url();
      if (!u.includes("/api/")) return;
      try {
        const t = await r.request().timing();
        const body = await r.body().catch(() => Buffer.alloc(0));
        calls.push({
          url: u.replace(BASE, "").split("?")[0],
          ms: Math.round(t.responseEnd - t.requestStart),
          // Time to the FIRST byte: the server thinking. The rest is transfer.
          wait: Math.round(t.responseStart - t.requestStart),
          size: body.length,
        });
      } catch {
        /* a response that went away is not a measurement */
      }
    };
    page.on("response", onDone);

    const t0 = Date.now();
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("domcontentloaded");
    const painted = Date.now() - t0;

    // Wait for the spinner to go — that is what he actually sees.
    let settled = -1;
    for (let i = 0; i < 120; i++) {
      const spinning = await page
        .locator('[class*="animate-spin"], [data-testid="spinner"]')
        .count();
      if (spinning === 0) {
        settled = Date.now() - t0;
        break;
      }
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(1200);
    page.off("response", onDone);

    const slowest = calls.slice().sort((a, b) => b.ms - a.ms)[0];
    rows.push({
      path,
      painted,
      settled,
      apiCalls: calls.length,
      totalApiMs: calls.reduce((s, c) => s + c.ms, 0),
      slowest: slowest ? `${slowest.url} ${slowest.ms}ms (wait ${slowest.wait})` : "—",
      bytes: calls.reduce((s, c) => s + c.size, 0),
    });
  }

  console.log("LATENCY " + JSON.stringify(rows, null, 1));
});
