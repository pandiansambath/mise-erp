import { test, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/** THROWAWAY - section 38, the new Control Room routes in four themes. */

const LOCAL = "http://localhost:3100";
const LIVE = "https://nirai1.dineai.cloud";
const OUT = process.env.SHOT_DIR as string;
const THEMES = ["claret", "dark", "ocean", "honey"];

async function proxyApi(ctx: BrowserContext) {
  await ctx.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const req = route.request();
    const headers = { ...req.headers() };
    delete headers.host;
    delete headers.origin;
    delete headers.referer;
    try {
      const res = await ctx.request.fetch(LIVE + url.pathname + url.search, {
        method: req.method(),
        headers,
        data: req.postDataBuffer() ?? undefined,
        maxRedirects: 5,
        timeout: 30_000,
      });
      const body = await res.body();
      const h = { ...res.headers() };
      delete h["content-encoding"];
      delete h["content-length"];
      h["access-control-allow-origin"] = "*";
      await route.fulfill({ status: res.status(), headers: h, body });
    } catch {
      await route.fulfill({ status: 502, body: "{}" });
    }
  });
}

async function sweep(page: Page, slug: string) {
  for (const k of THEMES) {
    await page.evaluate((x) => localStorage.setItem("mise_theme", x), k);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(OUT, "cr2-" + slug + "--" + k + ".png") });
    console.log("shot", slug, k, page.url());
  }
}

test("control room routes", async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  fs.mkdirSync(OUT, { recursive: true });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await proxyApi(ctx);
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
    } catch {
      /* ignore */
    }
  });

  await page.goto(LOCAL + "/login", { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("control@mise.app");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("Control@2026");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForTimeout(9000);
  console.log("after sign-in:", page.url());

  if (!page.url().includes("control-room")) {
    await page.goto(LOCAL + "/control-room", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    console.log("forced:", page.url());
  }

  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(OUT, "cr2-DEBUG.png") });
  console.log("links:", JSON.stringify(await page.getByRole("link").allInnerTexts()));

  // Reach the sub-pages by CLICKING the rail, per the map.
  for (const [slug, name] of [
    ["hotels", /^Hotels$/],
    ["ai", /AI spend/i],
    ["broadcast", /^Broadcast$/],
  ] as const) {
    const link = page.getByRole("link", { name }).first();
    if (await link.count()) {
      await link.click();
      await page.waitForTimeout(4500);
      console.log(slug, "->", page.url());
      await sweep(page, slug);
    } else {
      console.log("NO LINK for", slug);
    }
  }
  await ctx.close();
});
