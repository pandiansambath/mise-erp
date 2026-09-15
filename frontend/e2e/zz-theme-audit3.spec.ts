import { test, type BrowserContext } from "@playwright/test";

/** THROWAWAY pass 3 — measure the colours I accused, so the report has numbers. */
const LOCAL = "http://localhost:3100";
const LIVE = "https://nirai1.dineai.cloud";

async function proxyApi(ctx: BrowserContext) {
  await ctx.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const req = route.request();
    const headers = { ...req.headers() };
    delete headers.host; delete headers.origin; delete headers.referer;
    try {
      const res = await ctx.request.fetch(LIVE + url.pathname + url.search, {
        method: req.method(), headers, data: req.postDataBuffer() ?? undefined,
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

function lum(c: string) {
  const m = c.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const [r, g, b] = m.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fg: string, bg: string) {
  const a = lum(fg), b = lum(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

test("measure", async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await proxyApi(ctx);
  const page = await ctx.newPage();

  // ── the sign-in door on every LIGHT theme: the £3,412 and the ✓ ──
  for (const k of ["claret", "light", "azure", "honey", "apricot", "latte", "dark", "ocean"]) {
    await page.goto(`${LOCAL}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.evaluate((x) => localStorage.setItem("mise_theme", x), k);
    await page.goto(`${LOCAL}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const out = await page.evaluate(() => {
      const res: Record<string, string> = {};
      const money = [...document.querySelectorAll("p")].find((p) => /£3,?4?1?2?/.test(p.textContent || "") && p.className.includes("copper"));
      if (money) res.money = getComputedStyle(money).color;
      const tick = [...document.querySelectorAll("span")].find((s) => s.textContent?.trim() === "✓");
      if (tick) { res.tick = getComputedStyle(tick).color; res.tickBg = getComputedStyle(tick).backgroundColor; }
      res.mode = document.documentElement.dataset.mode || "?";
      return res;
    });
    console.log(`DOOR ${k.padEnd(8)} mode=${out.mode} money=${out.money} tick=${out.tick} tickBg=${out.tickBg}`);
  }

  // ── inventory: the "in stock" dot + label, per theme ──
  const boot = await browser.newContext();
  const tok = (await (await boot.request.post(`${LIVE}/api/auth/login`, {
    data: { email: "superadmin@gmail.com", password: "superadmin@123" } })).json()).access_token;
  await ctx.addInitScript(([t]: string[]) => {
    try { localStorage.setItem("mise_token", t); localStorage.setItem("mise.tour.done", "1"); } catch { /* ignore */ }
  }, [tok]);

  const p2 = await ctx.newPage();
  await p2.goto(`${LOCAL}/dashboard`, { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(6000);
  const sk = p2.getByRole("button", { name: /skip tour/i });
  if (await sk.count()) await sk.first().click().catch(() => {});
  await p2.getByRole("link", { name: /^Inventory$/ }).first().click();
  await p2.waitForTimeout(5000);

  for (const k of ["claret", "burgundy", "rose", "graphite", "dark", "cocoa", "sunset"]) {
    await p2.evaluate((x) => localStorage.setItem("mise_theme", x), k);
    await p2.reload({ waitUntil: "domcontentloaded" });
    await p2.waitForTimeout(4500);
    const o = await p2.evaluate(() => {
      const res: Record<string, string> = {};
      const ok = [...document.querySelectorAll("span,div")].find((e) => e.textContent?.trim() === "in stock");
      if (ok) {
        res.okText = getComputedStyle(ok).color;
        const dot = ok.parentElement?.querySelector("span[aria-hidden]");
        if (dot) res.okDot = getComputedStyle(dot as Element).backgroundColor;
      }
      const bad = [...document.querySelectorAll("span,div")].find((e) => e.textContent?.trim() === "out of stock");
      if (bad) res.badText = getComputedStyle(bad).color;
      const low = [...document.querySelectorAll("span,div")].find((e) => e.textContent?.trim() === "running low");
      if (low) res.lowText = getComputedStyle(low).color;
      return res;
    });
    console.log(`STOCK ${k.padEnd(9)} in=${o.okText} dot=${o.okDot} low=${o.lowText} out=${o.badText}`);
  }
  await ctx.close();
});
