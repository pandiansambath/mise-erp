import { test, type Browser, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/** THROWAWAY — §38 theme audit. Delete when the report is written. */

const LOCAL = "http://localhost:3100";
const LIVE = "https://nirai1.dineai.cloud";
const OUT = process.env.SHOT_DIR as string;

const ALL = [
  "claret", "light", "azure", "honey", "apricot", "latte",
  "dark", "graphite", "emerald", "ocean", "violet", "sunset",
  "rose", "sapphire", "cocoa", "burgundy",
];
const SOME = ["claret", "light", "honey", "dark", "ocean", "burgundy", "cocoa", "violet"];

/** The build had no NEXT_PUBLIC_API_URL, so the app calls http://localhost:8000.
 *  Re-point every API call at the live box so pages have real rows in them. */
async function proxyApi(ctx: BrowserContext) {
  await ctx.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const req = route.request();
    const headers = { ...req.headers() };
    delete headers.host; delete headers.origin; delete headers.referer;
    try {
      const res = await ctx.request.fetch(LIVE + url.pathname + url.search, {
        method: req.method(), headers,
        data: req.postDataBuffer() ?? undefined,
        maxRedirects: 5, timeout: 30_000,
      });
      const body = await res.body();
      const h = { ...res.headers() };
      delete h["content-encoding"]; delete h["content-length"];
      h["access-control-allow-origin"] = "*";
      await route.fulfill({ status: res.status(), headers: h, body });
    } catch { await route.fulfill({ status: 502, body: "{}" }); }
  });
}

async function tokenFor(ctx: BrowserContext, email: string, password: string) {
  const res = await ctx.request.post(`${LIVE}/api/auth/login`, { data: { email, password } });
  const j = await res.json();
  const t = j.access_token || j.token;
  if (!t) throw new Error(`no token for ${email}: ${JSON.stringify(j).slice(0, 200)}`);
  return t as string;
}

async function makeCtx(browser: Browser, token: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await proxyApi(ctx);
  await ctx.addInitScript(([tok]: string[]) => {
    try {
      localStorage.setItem("mise_token", tok);
      localStorage.setItem("mise.tour.done", "1");
      localStorage.setItem("mise_tour_done", "1");
      localStorage.setItem("mise.onboarding.done", "1");
    } catch { /* ignore */ }
  }, [token]);
  return ctx as BrowserContext;
}

async function killTour(page: Page) {
  const sk = page.getByRole("button", { name: /skip tour/i });
  if (await sk.count()) { await sk.first().click().catch(() => {}); await page.waitForTimeout(700); }
}

async function sweep(page: Page, slug: string, keys: string[], settle = 4200) {
  for (const key of keys) {
    await page.evaluate((k) => localStorage.setItem("mise_theme", k), key);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(settle);
    await killTour(page);
    await page.screenshot({ path: path.join(OUT, `${slug}--${key}.png`) });
    console.log("shot", slug, key, "url=", page.url());
  }
}

test("theme audit", async ({ browser }) => {
  test.setTimeout(45 * 60_000);
  fs.mkdirSync(OUT, { recursive: true });

  // ───────────────────────── hotel side ─────────────────────────
  const hotelTok = await tokenFor(await browser.newContext(), "superadmin@gmail.com", "superadmin@123");
  const ctx = await makeCtx(browser, hotelTok);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

  await page.goto(`${LOCAL}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  await killTour(page);
  console.log("landed:", page.url());
  await sweep(page, "dashboard", ALL);

  await page.getByRole("link", { name: /^Inventory$/ }).first().click();
  await page.waitForTimeout(5000);
  console.log("inventory url:", page.url());
  await sweep(page, "inventory", ALL);

  await page.getByRole("link", { name: /^Employees$/ }).first().click();
  await page.waitForTimeout(5000);
  console.log("employees url:", page.url());
  await sweep(page, "employees", SOME);

  // Public table page — no auth, follows the viewer's own localStorage theme.
  await page.goto(`${LOCAL}/t/pqqmr6y`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await sweep(page, "table", SOME, 3200);

  // The sign-in door, with a theme set, to see whether it follows at all.
  for (const key of ["claret", "dark", "ocean"]) {
    await page.goto(`${LOCAL}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.evaluate((k) => localStorage.setItem("mise_theme", k), key);
    await page.goto(`${LOCAL}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(OUT, `login--${key}.png`) });
  }
  await ctx.close();

  // ───────────────────────── operator side ─────────────────────────
  const opTok = await tokenFor(await browser.newContext(), "control@mise.app", "Control@2026");
  const octx = await makeCtx(browser, opTok);
  const op = await octx.newPage();
  op.on("pageerror", (e) => console.log("CR PAGEERROR:", e.message));

  await op.goto(`${LOCAL}/control-room`, { waitUntil: "domcontentloaded" });
  await op.waitForTimeout(6500);
  console.log("cr url:", op.url());
  await sweep(op, "cr-overview", SOME, 4000);

  for (const [slug, name] of [["cr-fleet", /Fleet/i], ["cr-plans", /Plans/i]] as const) {
    const link = op.getByRole("link", { name }).first();
    if (await link.count()) {
      await link.click();
      await op.waitForTimeout(4500);
      console.log(slug, "url:", op.url());
      await sweep(op, slug, ["claret", "light", "dark", "ocean", "honey"], 3500);
    } else {
      console.log("NO NAV LINK for", slug);
    }
  }
  await octx.close();
});
