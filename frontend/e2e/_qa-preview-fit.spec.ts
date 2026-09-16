import { test, expect, type Page } from "@playwright/test";

/** THROWAWAY QA SPEC — delete after the run.
 *  Proves (or disproves) that the Settings page-studio preview fits inside the
 *  viewport at every viewport x device x page combination. */

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";
const API = process.env.API_ORIGIN || "https://nirai1.dineai.cloud";
const OUT = "e2e-out/qa-preview";

const VIEWPORTS = [
  { name: "1920x1080", w: 1920, h: 1080, mobile: false },
  { name: "1440x900", w: 1440, h: 900, mobile: false },
  { name: "1280x720", w: 1280, h: 720, mobile: false },
  { name: "390x844", w: 390, h: 844, mobile: true },
  { name: "360x740", w: 360, h: 740, mobile: true },
];

/** When BASE is a local dev server there is no backend behind it, so the app's
 *  own calls are sent to production. Read-only apart from the sign-in itself. */
async function withProdApi(page: Page) {
  if (API === BASE) return;
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    try {
      const res = await route.fetch({ url: API + u.pathname + u.search });
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
  await page.waitForURL("**/dashboard", { timeout: 120_000 });
  const skip = page.getByText("Skip tour").first();
  if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(600); }
}

/** Reach a page by CLICKING, never by typing a URL. */
async function navByClick(page: Page, what: "settings" | "customise") {
  if (what === "settings") {
    await page.locator('button[aria-label="Account"]').first().click({ timeout: 20_000 });
    await page.waitForTimeout(400);
    await page.getByRole("link", { name: /Settings/ }).first().click({ timeout: 20_000 });
    await page.waitForURL("**/settings", { timeout: 90_000 });
  } else {
    try {
      await page.getByRole("link", { name: "Your pages" }).first().click({ timeout: 20_000 });
      await page.waitForURL("**/customise", { timeout: 60_000 });
    } catch (e) {
      console.log(`NAV-CLICK to /customise failed, fell back to goto: ${String(e).slice(0, 110)}`);
      await page.goto(`${BASE}/customise`);
      await page.waitForURL("**/customise", { timeout: 90_000 });
    }
  }
  await page.waitForTimeout(1500);
}

async function probe(page: Page) {
  return page.evaluate(() => {
    const ifr = document.querySelector('iframe[title="Preview"]') as HTMLIFrameElement | null;
    const de = document.documentElement;
    const base = {
      docScroll: { scrollH: de.scrollHeight, clientH: de.clientHeight, overflow: de.scrollHeight - de.clientHeight },
      vp: { w: window.innerWidth, h: window.innerHeight },
    };
    if (!ifr) return { missing: true, ...base } as Record<string, any>;
    const r = ifr.getBoundingClientRect();
    const bez = ifr.parentElement?.parentElement as HTMLElement | null;
    const br = bez?.getBoundingClientRect();
    let scalePct: number | null = null;
    for (const p of Array.from(document.querySelectorAll("p"))) {
      const m = (p.textContent || "").match(/(laptop|phone).*?(\d+)%/);
      if (m) { scalePct = Number(m[2]); break; }
    }
    const d = ifr.contentDocument;
    let inner: Record<string, any> | undefined;
    if (d && d.body) {
      const all = Array.from(d.body.querySelectorAll("*"));
      const painted = all.filter((el) => {
        const rr = (el as HTMLElement).getBoundingClientRect();
        return rr.width > 4 && rr.height > 4;
      }).length;
      inner = {
        els: all.length,
        textLen: (d.body.innerText || "").trim().length,
        scrollH: d.body.scrollHeight,
        paintedEls: painted,
        bg: getComputedStyle(d.body).backgroundColor,
        head: (d.body.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60),
      };
    }
    // WHAT THE FIT ACTUALLY MEASURES. `box` is the element PagePreview
    // observes; if its clientHeight is the frame's own height rather than the
    // room in the column, the height term is still an echo.
    const box = document.querySelector('div.flex.min-h-0.w-full.flex-1.items-center.justify-center') as HTMLElement | null;
    const chain: Record<string, any>[] = [];
    let el: HTMLElement | null = box;
    for (let i = 0; el && i < 5; i++) {
      chain.push({
        cls: (el.className || "").toString().slice(0, 48),
        display: getComputedStyle(el).display,
        clientH: el.clientHeight,
        scrollH: el.scrollHeight,
      });
      el = el.parentElement;
    }

    return {
      missing: false,
      chain,
      frame: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) },
      bezel: br ? { y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height), bottom: Math.round(br.bottom) } : undefined,
      scalePct,
      inner,
      ...base,
    } as Record<string, any>;
  });
}

async function waitPreviewReady(page: Page) {
  await page.waitForFunction(() => {
    const ifr = document.querySelector('iframe[title="Preview"]') as HTMLIFrameElement | null;
    const d = ifr?.contentDocument;
    return !!d && !!d.body && d.body.childElementCount > 0;
  }, undefined, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1600);
}

for (const vp of VIEWPORTS) {
  test(`studio preview fits — ${vp.name}`, async ({ browser }) => {
    test.setTimeout(400_000);
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
    });
    const page = await ctx.newPage();
    await signIn(page);
    await navByClick(page, "settings");
    await page.screenshot({ path: `${OUT}/${vp.name}-00-settings.png` });

    await page.locator('[data-testid="open-studio-site"]').first().click({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    await expect(page.locator('[data-testid="studio-close"]')).toBeVisible({ timeout: 30_000 });

    const combos = [
      { key: "site", dev: "desktop", label: "public-laptop" },
      { key: "site", dev: "phone", label: "public-phone" },
      { key: "door", dev: "desktop", label: "signin-laptop" },
      { key: "door", dev: "phone", label: "signin-phone" },
    ] as const;

    const failures: string[] = [];

    for (const c of combos) {
      await page.locator(`[data-testid="preview-${c.key}"]`).first().click({ timeout: 20_000 });
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: c.dev === "desktop" ? "Laptop" : "Phone" }).first().click({ timeout: 20_000 });
      await waitPreviewReady(page);

      const p = await probe(page);
      await page.screenshot({ path: `${OUT}/${vp.name}-${c.label}.png` });
      console.log(`RESULT ${vp.name} ${c.label} :: ${JSON.stringify(p)}`);

      if (p.missing || !p.frame) { failures.push(`${c.label}: NO IFRAME`); continue; }
      const f = p.frame;
      if (f.w < 40 || f.h < 40) failures.push(`${c.label}: frame collapsed ${f.w}x${f.h}`);
      if (!p.inner || p.inner.paintedEls < 3) failures.push(`${c.label}: iframe looks empty (painted=${p.inner ? p.inner.paintedEls : "n/a"})`);
      if (f.bottom > p.vp.h + 1) failures.push(`${c.label}: frame bottom ${f.bottom} > viewport ${p.vp.h}`);
      if (p.bezel && p.bezel.bottom > p.vp.h + 1) failures.push(`${c.label}: BEZEL bottom ${p.bezel.bottom} > viewport ${p.vp.h}`);
      if (f.y < -1) failures.push(`${c.label}: frame top ${f.y} above viewport`);
      if (p.docScroll.overflow > 2) failures.push(`${c.label}: studio scrolls ${p.docScroll.overflow}px`);
    }

    // ── if it is off-screen, can the user REACH it? ──────────────────────
    if (vp.mobile) {
      // A REAL GESTURE FIRST. Forcing scrollTop on an overflow:hidden box
      // proves nothing a user can do; the wheel is what they actually have.
      const yBefore = await page.evaluate(() => {
        const i = document.querySelector('iframe[title="Preview"]');
        return i ? Math.round(i.getBoundingClientRect().y) : null;
      });
      await page.mouse.move(vp.w / 2, vp.h / 2);
      for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 400);
      await page.waitForTimeout(700);
      const yAfterWheel = await page.evaluate(() => {
        const i = document.querySelector('iframe[title="Preview"]');
        return i ? Math.round(i.getBoundingClientRect().y) : null;
      });
      console.log(`WHEEL ${vp.name} :: ${JSON.stringify({ yBefore, yAfterWheel, vpH: vp.h })}`);
      await page.screenshot({ path: `${OUT}/${vp.name}-after-wheel.png` });

      const reach = await page.evaluate(async () => {
        const ifr = document.querySelector('iframe[title="Preview"]') as HTMLIFrameElement | null;
        if (!ifr) return { why: "no iframe" };
        const before = Math.round(ifr.getBoundingClientRect().y);
        window.scrollBy(0, 2000);
        // every scrollable ancestor too
        let el: HTMLElement | null = ifr.parentElement;
        const scrolled: string[] = [];
        while (el) {
          if (el.scrollHeight > el.clientHeight + 2) {
            el.scrollTop = el.scrollHeight;
            scrolled.push(`${el.tagName}.${(el.className || "").toString().slice(0, 40)}`);
          }
          el = el.parentElement;
        }
        await new Promise((r) => setTimeout(r, 400));
        const after = Math.round(ifr.getBoundingClientRect().y);
        return { before, after, moved: before - after, scrolled, vpH: window.innerHeight };
      });
      console.log(`REACH ${vp.name} :: ${JSON.stringify(reach)}`);
      await page.screenshot({ path: `${OUT}/${vp.name}-after-scroll.png` });
    }

    // ── click-swallow check on the SIGN-IN preview (currently selected) ──
    const urlBefore = page.url();
    const swallow = await page.evaluate(async () => {
      const ifr = document.querySelector('iframe[title="Preview"]') as HTMLIFrameElement | null;
      const d = ifr?.contentDocument;
      if (!d) return { ok: false, why: "no doc" };
      const rec: { prevented: boolean; tag: string }[] = [];
      const spy = (e: Event) => rec.push({ prevented: e.defaultPrevented, tag: (e.target as HTMLElement)?.tagName });
      d.addEventListener("click", spy, false);
      const targets = Array.from(d.querySelectorAll('div[style*="gradient"], button, a')).slice(0, 4);
      if (!targets.length && d.body.firstElementChild) targets.push(d.body.firstElementChild);
      for (const t of targets) (t as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 200));
      d.removeEventListener("click", spy, false);
      return { ok: true, clicked: targets.length, rec };
    });
    const btn = page.frameLocator('iframe[title="Preview"]').locator('div[style*="gradient"], button, a').first();
    let trustedClick = "none-found";
    if (await btn.count()) {
      trustedClick = "clicked";
      await btn.click({ timeout: 10_000, force: true }).catch((e) => { trustedClick = `err ${String(e).slice(0, 70)}`; });
      await page.waitForTimeout(900);
    }
    const urlAfter = page.url();
    const studioStillOpen = await page.locator('[data-testid="studio-close"]').count();
    console.log(`SWALLOW ${vp.name} :: ${JSON.stringify({ swallow, trustedClick, urlBefore, urlAfter, studioStillOpen })}`);
    await page.screenshot({ path: `${OUT}/${vp.name}-after-click.png` });
    expect(urlAfter, "a click inside the preview navigated").toBe(urlBefore);

    await page.locator('[data-testid="studio-close"]').first().click({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(500);
    await ctx.close();
    expect(failures.join(" | "), `overflow/render faults at ${vp.name}`).toBe("");
  });
}

test("customise page — thumbnails and the big preview stay inside their cards", async ({ browser }) => {
  test.setTimeout(400_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);
  await navByClick(page, "customise");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/customise-cards.png` });

  const cards = await page.evaluate(() => {
    const out: Record<string, any>[] = [];
    document.querySelectorAll('iframe[title="Preview"]').forEach((ifr, i) => {
      const r = ifr.getBoundingClientRect();
      let host: HTMLElement | null = ifr as HTMLElement;
      while (host && !(host.className || "").toString().includes("26rem")) host = host.parentElement;
      const hr = host ? host.getBoundingClientRect() : null;
      const d = (ifr as HTMLIFrameElement).contentDocument;
      out.push({
        i,
        frame: { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width), bottom: Math.round(r.bottom) },
        host: hr ? { y: Math.round(hr.y), h: Math.round(hr.height), bottom: Math.round(hr.bottom) } : null,
        overflowsCardBy: hr ? Math.round(r.bottom - hr.bottom) : null,
        painted: d ? Array.from(d.body.querySelectorAll("*")).filter((e) => { const b = e.getBoundingClientRect(); return b.width > 4 && b.height > 4; }).length : -1,
      });
    });
    return { count: document.querySelectorAll('iframe[title="Preview"]').length, out };
  });
  console.log("CUSTOMISE CARDS " + JSON.stringify(cards));

  await page.getByRole("button", { name: /Your public page/ }).first().click({ timeout: 20_000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/customise-editor-laptop.png` });
  console.log("CUSTOMISE EDITOR site/desktop " + JSON.stringify(await probe(page)));

  await page.getByRole("button", { name: "Phone" }).first().click({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/customise-editor-phone.png` });
  console.log("CUSTOMISE EDITOR site/phone " + JSON.stringify(await probe(page)));

  await ctx.close();
});
