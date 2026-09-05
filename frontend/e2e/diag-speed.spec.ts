import { test, type Page } from "@playwright/test";

/**
 * "i can note loading pages often. when i move from purchase page to inventory
 *  page i can see loading icon, which means our site is slow in showing and
 *  processing. please make our site fast faster."
 *
 * Measure before touching anything. "The site is slow" has at least four
 * different fixes depending on WHERE the time goes — the server, the number of
 * round trips, the bundle, or a page that refuses to render until every last
 * request has landed. Guessing picks the wrong one.
 */

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
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

test("where does the time go between pages", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);

  for (const path of ["/purchasing", "/inventory", "/sales", "/expenses"]) {
    const calls: { url: string; ms: number }[] = [];
    const started = new Map<string, number>();

    const onReq = (r: import("@playwright/test").Request) => {
      if (r.url().includes("/api/")) started.set(r.url(), Date.now());
    };
    const onDone = (r: import("@playwright/test").Response) => {
      const t0 = started.get(r.url());
      if (t0) calls.push({ url: r.url().split("/api")[1].slice(0, 58), ms: Date.now() - t0 });
    };
    page.on("request", onReq);
    page.on("response", onDone);

    const t0 = Date.now();
    await page.goto(`${BASE}${path}`);
    // First paint of real content — the moment the spinner would go.
    // :visible, and a REAL failure rather than a silent one. The first version
    // matched a hidden element, waited the full 60s, and reported "painted =
    // 61362ms" — a timeout dressed up as a measurement. A number that large
    // should have been the tell, and it was: the instrument, not the site.
    let painted = -1;
    try {
      await page.locator("h1:visible, h2:visible, table:visible").first().waitFor({ timeout: 30_000 });
      painted = Date.now() - t0;
    } catch {
      painted = -1; // never painted within 30s — say so instead of pretending
    }

    // Let the tail of the requests land so we can see the whole picture.
    await page.waitForTimeout(3500);
    const total = Date.now() - t0;

    page.off("request", onReq);
    page.off("response", onDone);

    calls.sort((a, b) => b.ms - a.ms);
    console.log(
      `SPEED ${path} painted=${painted}ms settled=${total}ms calls=${calls.length}\n` +
        calls
          .slice(0, 8)
          .map((c) => `    ${String(c.ms).padStart(5)}ms  ${c.url}`)
          .join("\n"),
    );
  }
});
