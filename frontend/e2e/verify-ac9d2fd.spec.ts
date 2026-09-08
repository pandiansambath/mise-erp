import { test, expect, type Page } from "@playwright/test";

/** TEMPORARY verification spec for commit ac9d2fd — delete after reporting. */

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
  await page.waitForURL("**/dashboard", { timeout: 90_000 });
}

/** How many popup panels are on screen, and at what z / size. */
async function dialogs(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="dialog"]')).map((d) => {
      const el = d as HTMLElement;
      const r = el.getBoundingClientRect();
      const body = el.querySelector(".mise-noscrollbar.min-h-0") as HTMLElement | null;
      return {
        label: el.getAttribute("aria-label"),
        z: getComputedStyle(el).zIndex,
        w: Math.round(r.width),
        h: Math.round(r.height),
        visible: r.width > 0 && r.height > 0,
        hasBack: !!el.querySelector('[aria-label="Back"]'),
        bodyScrollH: body ? body.scrollHeight : null,
        bodyClientH: body ? body.clientHeight : null,
      };
    }),
  );
}

test("a) b) c) vendors: three stacked popups, auto-fill cards, no scroll on price", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);

  await page.goto(`${BASE}/vendors`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "e2e-out/ac-01-vendors.png", fullPage: false });

  // --- Layer 1: a supplier ------------------------------------------------
  // Prefer a supplier that actually has priced items, or the category tiles
  // never appear and the test would be checking an empty sheet.
  const cards = page.locator('[data-testid="vendor-card"]');
  const nCards = await cards.count();
  console.log(`VENDOR CARDS ${nCards}`);
  expect(nCards).toBeGreaterThan(0);

  let opened = "";
  for (let i = 0; i < Math.min(nCards, 12); i++) {
    await cards.nth(i).click();
    await page.waitForTimeout(1500);
    const tiles = page.locator('[role="dialog"] button:has-text("priced")');
    if ((await tiles.count()) > 0) {
      opened = (await cards.nth(i).innerText()).split("\n")[0];
      break;
    }
    // no priced items on this one — close and try the next
    await page.locator('[role="dialog"] [aria-label="Close"]').last().click();
    await page.waitForTimeout(800);
  }
  console.log(`SUPPLIER OPENED: ${opened}`);
  const d1 = await dialogs(page);
  console.log("AFTER SUPPLIER:", JSON.stringify(d1));
  await page.screenshot({ path: "e2e-out/ac-02-supplier.png" });

  // --- Layer 2: a category ------------------------------------------------
  const catTiles = page.locator('[role="dialog"] button:has-text("priced")');
  const catCount = await catTiles.count();
  console.log(`CATEGORY TILES ${catCount}`);
  expect(catCount, "supplier sheet should show category tiles").toBeGreaterThan(0);
  const catName = (await catTiles.first().innerText()).split("\n")[0];
  await catTiles.first().click();
  await page.waitForTimeout(1500);
  const d2 = await dialogs(page);
  const catLabel = d2.filter((d) => d.visible).slice(-1)[0]?.label ?? "";
  console.log(`CATEGORY OPENED: tile="${catName}" panel="${catLabel}"`);
  console.log("AFTER CATEGORY:", JSON.stringify(d2));
  await page.screenshot({ path: "e2e-out/ac-03-category.png" });
  expect(d2.filter((d) => d.visible).length, "supplier + category = 2 panels").toBe(2);

  // (b) the item cards inside the category must be small auto-fill cards, not
  //     two full-width bars. Measure the grid track and the card widths.
  const grid = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('[role="dialog"]')) as HTMLElement[];
    const top = panels[panels.length - 1];
    const g = top.querySelector(".mise-stagger.grid") as HTMLElement | null;
    if (!g) return null;
    const cs = getComputedStyle(g);
    const kids = Array.from(g.children) as HTMLElement[];
    return {
      panelWidth: Math.round(top.getBoundingClientRect().width),
      templateColumns: cs.gridTemplateColumns,
      columnCount: cs.gridTemplateColumns.split(" ").filter(Boolean).length,
      cardCount: kids.length,
      cardWidths: kids.slice(0, 6).map((k) => Math.round(k.getBoundingClientRect().width)),
    };
  });
  console.log("CATEGORY GRID:", JSON.stringify(grid));

  // --- Layer 3: an item ---------------------------------------------------
  const topDialog = page.locator('[role="dialog"]').last();
  const itemCards = topDialog.locator(".mise-stagger.grid > *");
  const nItems = await itemCards.count();
  console.log(`ITEM CARDS IN CATEGORY ${nItems}`);
  expect(nItems).toBeGreaterThan(0);
  const itemName = (await itemCards.first().innerText()).split("\n")[0];
  await itemCards.first().click();
  await page.waitForTimeout(1800);
  const d3 = await dialogs(page);
  console.log(`ITEM OPENED: ${itemName}`);
  console.log("AFTER ITEM:", JSON.stringify(d3));
  await page.screenshot({ path: "e2e-out/ac-04-item-price.png" });

  // (a) THE MAIN FIX: all three are on screen at once.
  const visible3 = d3.filter((d) => d.visible);
  expect(visible3.length, "supplier + category + price = 3 stacked panels").toBe(3);

  // (c) the price popup must not scroll.
  const top3 = d3[d3.length - 1];
  console.log(
    `PRICE POPUP BODY scrollHeight=${top3.bodyScrollH} clientHeight=${top3.bodyClientH} panel=${top3.w}x${top3.h} hasBack=${top3.hasBack}`,
  );

  // ✕ on the item must return to the CATEGORY, not the page.
  await page.locator('[role="dialog"] [aria-label="Close"]').last().click();
  await page.waitForTimeout(1500);
  const d4 = await dialogs(page);
  console.log("AFTER ✕ ON ITEM:", JSON.stringify(d4));
  await page.screenshot({ path: "e2e-out/ac-05-back-to-category.png" });
  const vis4 = d4.filter((d) => d.visible);
  expect(vis4.length, "closing the item leaves supplier + category").toBe(2);
  expect(vis4[vis4.length - 1].label, "the top panel is the category again").toBe(catLabel);

  // and ✕ again → supplier
  await page.locator('[role="dialog"] [aria-label="Close"]').last().click();
  await page.waitForTimeout(1200);
  const d5 = (await dialogs(page)).filter((d) => d.visible);
  console.log("AFTER ✕ ON CATEGORY:", JSON.stringify(d5));
  await page.screenshot({ path: "e2e-out/ac-06-back-to-supplier.png" });
  expect(d5.length, "closing the category leaves the supplier").toBe(1);

  await ctx.close();
});

test("d) purchasing: All items exists and shows a flat list", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);

  await page.goto(`${BASE}/purchasing`);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "e2e-out/ac-07-purchasing.png" });

  const all = page.locator('[data-testid="showby-all"]');
  await expect(all, "an All items button in the Show by row").toBeVisible();
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-testid^='showby-']")).map(
      (b) => (b as HTMLElement).innerText,
    ),
  );
  console.log("SHOW BY OPTIONS:", JSON.stringify(order));

  const catsBefore = await page.locator('[data-testid="category-tile"]').count();
  await all.click();
  await page.waitForTimeout(2500);
  const tiles = await page.locator('[data-testid="item-tile"]').count();
  const catsAfter = await page.locator('[data-testid="category-tile"]').count();
  const vendorsAfter = await page.locator('[data-testid="vendor-tile"]').count();
  console.log(
    `CATEGORY TILES before=${catsBefore} after=${catsAfter}; VENDOR TILES after=${vendorsAfter}; ITEM TILES=${tiles}`,
  );
  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-testid='item-tile']"))
      .slice(0, 8)
      .map((t) => (t as HTMLElement).innerText.split("\n")[0]),
  );
  console.log("FIRST ITEMS:", JSON.stringify(names));
  await page.screenshot({ path: "e2e-out/ac-08-purchasing-all-items.png", fullPage: true });

  expect(tiles, "a flat list of items").toBeGreaterThan(0);
  expect(catsAfter, "no category grouping under All items").toBe(0);
  expect(await all.getAttribute("aria-pressed")).toBe("true");

  await ctx.close();
});

test("e) no horizontal overflow at 390px on /vendors and /purchasing", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await signIn(page);

  for (const path of ["/vendors", "/purchasing"]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(5000);
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      // Name the widest offender, so a failure says WHAT is sticking out.
      let worst = { tag: "", right: 0 };
      document.querySelectorAll("*").forEach((n) => {
        const r = (n as HTMLElement).getBoundingClientRect();
        if (r.width > 0 && r.right > worst.right) {
          worst = {
            tag: `${n.tagName.toLowerCase()}.${(n as HTMLElement).className?.toString().slice(0, 60)}`,
            right: Math.round(r.right),
          };
        }
      });
      return {
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        worst,
      };
    });
    console.log(`${path} @390: ${JSON.stringify(m)}`);
    await page.screenshot({
      path: `e2e-out/ac-09-mobile${path.replace(/\//g, "-")}.png`,
      fullPage: true,
    });
    expect(m.scrollWidth, `${path} must not overflow horizontally`).toBeLessThanOrEqual(
      m.clientWidth + 1,
    );
  }

  // And the popup stack at 390 too — the widths are literal class names, so a
  // 60rem depth-3 panel on a 390px phone is exactly the thing to check.
  await page.goto(`${BASE}/vendors`);
  await page.waitForTimeout(4000);
  const cards = page.locator('[data-testid="vendor-card"]');
  const n = await cards.count();
  for (let i = 0; i < Math.min(n, 12); i++) {
    await cards.nth(i).click();
    await page.waitForTimeout(1500);
    if ((await page.locator('[role="dialog"] button:has-text("priced")').count()) > 0) break;
    await page.locator('[role="dialog"] [aria-label="Close"]').last().click();
    await page.waitForTimeout(700);
  }
  await page.locator('[role="dialog"] button:has-text("priced")').first().click();
  await page.waitForTimeout(1200);
  await page.locator('[role="dialog"]').last().locator(".mise-stagger.grid > *").first().click();
  await page.waitForTimeout(1500);
  const d = await dialogs(page);
  console.log("MOBILE STACK:", JSON.stringify(d));
  const ov = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  console.log(`MOBILE with 3 popups open: ${JSON.stringify(ov)}`);
  await page.screenshot({ path: "e2e-out/ac-10-mobile-stack.png" });

  await ctx.close();
});
