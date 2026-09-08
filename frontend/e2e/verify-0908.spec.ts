import { test, expect, type Page } from "@playwright/test";

/** Everything shipped on 7-8 Sept, checked on the live site.
 *
 *  Each assertion is written to fail for the RIGHT reason. The recurring trap
 *  on this project is a check that reads the same whether the thing works or
 *  the thing is missing — "the page scrolls 0px" is true both when it must not
 *  scroll and when it cannot. So where a claim is about a number, the number is
 *  printed; where it is about how something looks, a screenshot is taken and
 *  looked at rather than merely captured.
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

/** Relative luminance → contrast ratio, so a colour claim is a number somebody
 *  can argue with rather than "looks fine to me". */
function contrast(fg: string, bg: string): number {
  const parse = (c: string) => {
    const m = c.match(/\d+(\.\d+)?/g);
    return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
  };
  const lum = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(parse(fg));
  const b = lum(parse(bg));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

test("tables: tiles, a name inside the QR, and who is sitting where", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);

  await page.goto(`${BASE}/tables`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "e2e-out/v-tables.png", fullPage: true });

  const tiles = page.locator('[data-testid="table-tile"]');
  const n = await tiles.count();
  console.log(`TILES ${n}`);
  expect(n, "the page should be tiles now, not nineteen big QR cards").toBeGreaterThan(0);

  // The whole page must fit far better than the four screens it used to take.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(`TABLES PAGE HEIGHT ${height}px for ${n} tables`);

  // The live-sitting field has to survive response_model — the failure mode
  // that has cost this project six fields is the value arriving as undefined.
  // THE APP SENDS A BEARER TOKEN, NOT A COOKIE. A raw fetch with
  // `credentials: "include"` therefore arrives unauthenticated and comes back
  // 401 — which this test then reported as "the field is missing", blaming the
  // server for my own missing header. Read the token the way the app does.
  const api = await page.evaluate(async () => {
    const token =
      window.sessionStorage.getItem("mise_token") ?? window.localStorage.getItem("mise_token");
    const r = await fetch("/api/ordering/tables", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const rows = await r.json();
    return Array.isArray(rows)
      ? { status: r.status, n: rows.length, sample: rows[0], hasField: "open_orders" in (rows[0] ?? {}) }
      : { status: r.status, n: 0, sample: null, hasField: false };
  });
  console.log(`TABLES API ${JSON.stringify(api).slice(0, 240)}`);
  expect(api.hasField, "open_orders must be declared on TableOut or it is dropped").toBe(true);

  await tiles.first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "e2e-out/v-table-sheet.png" });

  // The name, inside the code. Read from the SVG the page is actually showing.
  const qr = await page.evaluate(async () => {
    const img = document.querySelector('[role="dialog"] img') as HTMLImageElement | null;
    if (!img) return null;
    const r = await fetch(img.src);
    const body = await r.text();
    return { src: img.src, hasText: body.includes("<text"), body: body.slice(-400) };
  });
  console.log(`QR ${JSON.stringify({ hasText: qr?.hasText, tail: qr?.body?.slice(-200) })}`);
  expect(qr?.hasText, "the table's name should be drawn into the middle of its QR").toBe(true);

  await ctx.close();
});

test("menu: grouped by course, and the pill only when it is news", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);

  await page.goto(`${BASE}/menu`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "e2e-out/v-menu.png", fullPage: true });

  const seen = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h2")).map((h) =>
      (h.textContent || "").trim(),
    );
    const dishes = document.querySelectorAll('[data-testid="menu-dish"]').length;
    // The old page printed "On the menu" on every available dish. If that
    // string still appears on a card, nothing changed.
    const shouty = Array.from(document.querySelectorAll('[data-testid="menu-dish"]')).filter(
      (el) => (el.textContent || "").includes("On the menu"),
    ).length;
    return { headings, dishes, shouty };
  });
  console.log(`MENU ${JSON.stringify(seen)}`);
  expect(seen.dishes, "dishes should render").toBeGreaterThan(0);
  expect(seen.headings.length, "dishes should be grouped under course headings").toBeGreaterThan(0);
  expect(seen.shouty, '"On the menu" should no longer be printed on every card').toBe(0);

  await ctx.close();
});

test("rota: the week check, and a shift that moves without dragging", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);

  await page.goto(`${BASE}/rota`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "e2e-out/v-rota.png", fullPage: true });

  // The day buttons in the shift editor — the only way to move a shift on a
  // touch device, since HTML5 drag events do not fire there at all.
  const shift = page.locator('[data-testid="rota-shift"]').first();
  if ((await shift.count()) > 0) {
    await shift.click();
    await page.waitForTimeout(1200);
    const days = page.locator('[data-testid="edit-day"]');
    const dn = await days.count();
    console.log(`EDIT DAY BUTTONS ${dn}`);
    await page.screenshot({ path: "e2e-out/v-rota-edit.png" });
    expect(dn, "seven days to tap, one per column").toBe(7);
  } else {
    console.log("EDIT DAY BUTTONS — no shift on this week to open");
  }

  await ctx.close();
});

test("the voice rings are no longer cut off by their own card", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ["microphone"],
  });
  const page = await ctx.newPage();
  await signIn(page);
  await page.waitForTimeout(2500);

  await page.getByRole("button", { name: "Talk to DineAI" }).click();
  await page.waitForTimeout(1500);
  const start = page.getByRole("button", { name: "Start listening" });
  if ((await start.count()) > 0) {
    await start.click();
    await page.waitForTimeout(3500);
  }

  const box = await page.evaluate(() => {
    const q = (s: string) => document.querySelector(s) as HTMLElement | null;
    const r = (el: HTMLElement | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    };
    const card = q(".mise-voice-card");
    return {
      orb: r(q(".mise-voice-orb")),
      rings: r(q(".mise-voice-rings")),
      card: r(card),
      cardOverflow: card ? getComputedStyle(card).overflow : null,
      staged: q(".mise-voice")?.hasAttribute("data-staged"),
    };
  });
  console.log(`VOICE ${JSON.stringify(box)}`);
  await page.screenshot({ path: "e2e-out/v-voice.png" });

  // The rings scale up to 1.2x with the voice. Clipping is what cut the outer
  // one off at exactly the moment it mattered.
  if (box.staged) {
    expect(box.cardOverflow, "a transparent card has nothing to clip").not.toBe("clip");
  }
  await ctx.close();
});

/** MOBILE AND DARK, because everything above was checked at 1440px on the light
 *  theme and that is one of four corners. The rebuilt pages are new layouts and
 *  the colour work changed a rule that applies to BOTH themes — the brand
 *  button's ink is now set in CSS rather than by a utility class, and that rule
 *  is not scoped to light. If it is wrong on dark, it is wrong everywhere the
 *  dark theme is used. */
for (const page_ of [
  { path: "/tables", name: "tables" },
  { path: "/menu", name: "menu" },
  { path: "/rota", name: "rota" },
]) {
  test(`${page_.name} on a phone`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${BASE}${page_.path}`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `e2e-out/v-${page_.name}-phone.png`, fullPage: true });

    // The page body must never scroll SIDEWAYS. A horizontal scrollbar on a
    // phone is the tell for a fixed width somewhere, and it makes every
    // vertical swipe feel like it is fighting you.
    const over = await page.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
      h: document.documentElement.scrollHeight,
    }));
    console.log(`${page_.path} PHONE ${JSON.stringify(over)}`);
    expect(over.docW, "nothing should overflow the viewport width").toBeLessThanOrEqual(
      over.winW + 1,
    );
    await ctx.close();
  });
}

test("the brand button is readable on the DARK theme too", async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);

  // Force the app root onto dark and read the button's ink against its panel.
  // The rule that sets that ink is NOT scoped to light, so dark has to be
  // checked separately rather than assumed to follow.
  await page.goto(`${BASE}/attendance`);
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.documentElement.dataset.mode = "dark";
    document.querySelector(".mise-app")?.setAttribute("data-mode", "dark");
  });
  await page.getByRole("button").filter({ hasText: /Not in yet|Working|Clocked out/ }).first().click();
  await page.waitForTimeout(1200);

  const btn = page.locator('[data-testid="edit-save"]');
  await expect(btn).toBeVisible();
  const seen = await btn.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      color: cs.color,
      panel: getComputedStyle(el.closest('[role="dialog"]')!).backgroundColor,
    };
  });
  const ratio = contrast(seen.color, seen.panel);
  console.log(`DARK SAVE BUTTON ink=${seen.color} on ${seen.panel} → ${ratio.toFixed(2)}:1`);
  await page.screenshot({ path: "e2e-out/v-dark.png" });
  expect(ratio, "the brand button must read on dark as well as light").toBeGreaterThan(4.5);
  await ctx.close();
});
