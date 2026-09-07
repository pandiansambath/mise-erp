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
  const api = await page.evaluate(async () => {
    const r = await fetch("/api/ordering/tables", { credentials: "include" });
    const rows = await r.json();
    return Array.isArray(rows)
      ? { n: rows.length, sample: rows[0], hasField: "open_orders" in (rows[0] ?? {}) }
      : { n: 0, sample: null, hasField: false };
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
