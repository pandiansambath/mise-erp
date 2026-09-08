import { test, type Page } from "@playwright/test";

/** "this is 7th time im saying this same issue."
 *
 *  Seven times means every previous diagnosis was wrong, so this one starts by
 *  pressing the button and recording what the browser actually does — URL
 *  before, URL after, console errors, and whether the element is even the thing
 *  receiving the click. */

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

test("pressing 'Change the restaurant's timezone'", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 160)));

  await signIn(page);
  await page.goto(`${BASE}/attendance`);
  await page.waitForTimeout(2500);

  // Open the clock.
  await page.locator('[data-testid="clock-open"], header button').filter({ hasText: /pm|am|:/ }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "e2e-out/tz-1-clock.png" });

  const btn = page.locator('[data-testid="clock-timezone"]');
  const found = await btn.count();
  console.log(`TZ BUTTON count=${found}`);
  if (found === 0) {
    console.log("TZ the button is not rendered at all — canSet is false for this user");
    await ctx.close();
    return;
  }

  // SPY ON HISTORY. The theory is that the overlay's cleanup calls
  // history.back() and undoes the push. Instrument it rather than believe it —
  // six previous diagnoses were confident and wrong.
  await page.evaluate(() => {
    const w = window as unknown as { __hist: string[] };
    w.__hist = [];
    const back = history.back.bind(history);
    const push = history.pushState.bind(history);
    history.back = () => { w.__hist.push("back()"); return back(); };
    history.pushState = (s: unknown, t: string, u?: string | URL | null) => {
      w.__hist.push(`push(${u ?? ""})`);
      return push(s as never, t, u as never);
    };
    window.addEventListener("popstate", () => w.__hist.push("popstate"));
  });

  const before = page.url();
  // What is actually at the button's centre? If something overlays it, the
  // click lands on the overlay and the handler never runs — which looks
  // exactly like "nothing happened".
  const hit = await btn.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return {
      visible: b.width > 0 && b.height > 0,
      box: { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
      topmost: top ? `${top.tagName}.${(top.className || "").toString().slice(0, 60)}` : null,
      isSelfOrChild: !!top && (el === top || el.contains(top)),
    };
  });
  console.log(`TZ HITTEST ${JSON.stringify(hit)}`);

  await btn.click();
  await page.waitForTimeout(3000);
  const after = page.url();
  console.log(`TZ URL before=${before}`);
  console.log(`TZ URL after =${after}`);
  console.log(`TZ navigated=${before !== after}`);
  await page.screenshot({ path: "e2e-out/tz-2-after.png", fullPage: true });

  // Did the settings page actually render, and is there a #timezone anchor?
  const landed = await page.evaluate(() => ({
    path: location.pathname + location.hash,
    hasAnchor: !!document.getElementById("timezone"),
    heading: document.querySelector("h1,h2")?.textContent?.trim().slice(0, 60) ?? null,
  }));
  console.log(`TZ LANDED ${JSON.stringify(landed)}`);
  const hist = await page.evaluate(() => (window as unknown as { __hist: string[] }).__hist);
  console.log(`TZ HISTORY CALLS ${JSON.stringify(hist)}`);
  console.log(`TZ CONSOLE ERRORS ${JSON.stringify(errors.slice(0, 5))}`);
  await ctx.close();
});
