import { test, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/** THROWAWAY pass 2 — popups, palette, tooltips, the door on every light theme. */

const LOCAL = "http://localhost:3100";
const LIVE = "https://nirai1.dineai.cloud";
const OUT = process.env.SHOT_DIR as string;
const LIGHTS = ["light", "azure", "honey", "apricot", "latte", "claret"];

async function proxyApi(ctx: BrowserContext) {
  await ctx.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const req = route.request();
    const headers = { ...req.headers() };
    delete headers.host; delete headers.origin; delete headers.referer;
    try {
      const res = await ctx.request.fetch(LIVE + url.pathname + url.search, {
        method: req.method(), headers,
        data: req.postDataBuffer() ?? undefined, maxRedirects: 5, timeout: 30_000,
      });
      const body = await res.body();
      const h = { ...res.headers() };
      delete h["content-encoding"]; delete h["content-length"];
      h["access-control-allow-origin"] = "*";
      await route.fulfill({ status: res.status(), headers: h, body });
    } catch { await route.fulfill({ status: 502, body: "{}" }); }
  });
}

test("popups + door", async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  fs.mkdirSync(OUT, { recursive: true });

  const boot = await browser.newContext();
  const r = await boot.request.post(`${LIVE}/api/auth/login`, {
    data: { email: "superadmin@gmail.com", password: "superadmin@123" },
  });
  const token = (await r.json()).access_token as string;

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await proxyApi(ctx);
  await ctx.addInitScript(([t]: string[]) => {
    try {
      localStorage.setItem("mise_token", t);
      localStorage.setItem("mise.tour.done", "1");
      localStorage.setItem("mise_tour_done", "1");
    } catch { /* ignore */ }
  }, [token]);
  const page = await ctx.newPage();

  // ── the door, on every LIGHT theme (the rescue block's blast radius) ──
  for (const k of LIGHTS) {
    await page.goto(`${LOCAL}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.evaluate((x) => localStorage.setItem("mise_theme", x), k);
    await page.goto(`${LOCAL}/signup`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(OUT, `door2--${k}.png`) });
    console.log("door", k);
  }

  // ── land in the app, then popups ──
  await page.goto(`${LOCAL}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const sk = page.getByRole("button", { name: /skip tour/i });
  if (await sk.count()) await sk.first().click().catch(() => {});
  await page.waitForTimeout(800);

  for (const k of ["claret", "dark", "ocean", "graphite"]) {
    await page.evaluate((x) => localStorage.setItem("mise_theme", x), k);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
    const s2 = page.getByRole("button", { name: /skip tour/i });
    if (await s2.count()) await s2.first().click().catch(() => {});

    // COMMAND PALETTE — portals to <body>, uses .mise-glass-panel
    await page.keyboard.press("Control+K");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `palette--${k}.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);

    // CURRENCY DROPDOWN in the top bar — a portalled popover
    const cur = page.getByRole("button", { name: /GBP/ }).first();
    if (await cur.count()) {
      await cur.click().catch(() => {});
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(OUT, `dropdown--${k}.png`) });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    console.log("popups", k);
  }

  // ── a page with real charts: Reports (P&L) — chart tooltip = .mise-glass-panel
  await page.getByRole("link", { name: /Reports \(P&L\)/ }).first().click();
  await page.waitForTimeout(7000);
  for (const k of ["claret", "dark", "ocean", "cocoa"]) {
    await page.evaluate((x) => localStorage.setItem("mise_theme", x), k);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(OUT, `reports--${k}.png`) });
    console.log("reports", k, page.url());
  }
  await ctx.close();
});
