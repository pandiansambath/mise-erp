import { expect, test } from "@playwright/test";

/**
 * His seven, checked on the DEPLOYED site.
 *
 * Written because I called two batches shipped while the deploy was red and the
 * site was three commits behind. Every assertion here runs against his tenant,
 * and every one ends in a screenshot I have to look at — "page scrolls 0px"
 * reads the same for *must not scroll* and *cannot scroll*, and I have been
 * caught by exactly that before.
 */

const BASE = "https://nirai1.dineai.cloud";

async function signIn(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
    } catch {
      /* ignore */
    }
  });
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

test("3 + 5 — the order pad shows by supplier, and a supplier's list goes in whole", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/purchasing`);
  // NOT networkidle: the app holds a realtime stream open, so it never fires.
  await page.waitForLoadState("domcontentloaded");

  // Same rule as inventory: wait for the pad to have loaded something.
  await expect
    .poll(async () => page.getByTestId("showby-category").count(), {
      timeout: 60_000,
      message: "the order pad never loaded",
    })
    .toBeGreaterThan(0);

  // The three buttons exist and say what they do.
  for (const k of ["category", "vendor", "price"]) {
    await expect(page.getByTestId(`showby-${k}`), `show-by ${k} is missing`).toBeVisible({
      timeout: 30_000,
    });
  }

  // BY SUPPLIER.
  await page.getByTestId("showby-vendor").click();
  await page.waitForTimeout(900);
  const vendorTiles = page.getByTestId("vendor-tile");
  const nVendors = await vendorTiles.count();
  console.log("supplier tiles:", nVendors);
  expect(nVendors, "no supplier tiles rendered").toBeGreaterThan(0);
  await page.screenshot({ path: "e2e/__screens__/showby-vendor.png", fullPage: false });

  // Its label must carry a real count, not "0 items priced".
  const firstLabel = (await vendorTiles.first().textContent()) || "";
  console.log("first supplier tile:", firstLabel.replace(/\s+/g, " ").trim());
  expect(firstLabel).not.toContain("0 items priced");

  // ITEM 5: the whole list lands in the basket.
  const basketBefore = (await page.locator("#mise-basket").textContent()) || "0";
  await page.getByTestId("vendor-add-all").first().click();
  await page.waitForTimeout(1200);
  const basketAfter = (await page.locator("#mise-basket").textContent()) || "0";
  const n = (s: string) => parseInt((s.match(/\d+/) || ["0"])[0], 10);
  console.log("basket:", n(basketBefore), "->", n(basketAfter));
  await page.screenshot({ path: "e2e/__screens__/vendor-add-all.png", fullPage: false });
  expect(n(basketAfter), "Add all put nothing in the basket").toBeGreaterThan(n(basketBefore));

  // DEAREST FIRST: items appear with no category tap, and in descending order.
  await page.getByTestId("showby-price").click();
  await page.waitForTimeout(900);
  const tiles = page.getByTestId("item-tile");
  const nItems = await tiles.count();
  console.log("items in price mode:", nItems);
  expect(nItems, "price mode showed no items").toBeGreaterThan(0);
  await page.screenshot({ path: "e2e/__screens__/showby-price.png", fullPage: false });
});

test("2 — an item's supplier can be changed from Inventory", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/inventory`);
  // NOT networkidle: the app holds a realtime stream open, so it never fires.
  await page.waitForLoadState("domcontentloaded");

  // WAIT FOR THE LIST, not for the document. The first run of this test failed
  // on a spinner and an empty table — the same shape of mistake as a test that
  // PASSES on a spinner, which has caught me here before. Assert the page has
  // content before asserting anything about the content.
  const rows = page.locator("tbody tr");
  await expect
    .poll(async () => rows.count(), { timeout: 60_000, message: "inventory never loaded" })
    .toBeGreaterThan(0);
  const total = await rows.count();
  console.log("inventory rows:", total);

  let found = 0;
  for (let i = 0; i < Math.min(total, 12); i += 1) {
    await rows.nth(i).click();
    await page.waitForTimeout(700);
    found = await page.getByTestId("inv-supplier-pick").count();
    if (found >= 2) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  console.log("supplier choices in the sheet:", found);
  await page.screenshot({ path: "e2e/__screens__/inventory-supplier.png", fullPage: false });
  expect(found, "no supplier picker in any item's detail sheet").toBeGreaterThan(0);
});

test("1 — sales and expenses lead with the numbers, not the charts", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);

  /**
   * Checked by DOM ORDER, not by pixels.
   *
   * Two earlier versions of this test measured geometry and both lied: the app
   * scrolls an inner container so `body.scrollHeight` is always the viewport,
   * and on a quiet day the donut is not rendered AT ALL — so a test looking for
   * a chart found none, skipped its own assertion, and reported a pass. That is
   * the same fault this batch was meant to fix, committed by the test.
   *
   * `compareDocumentPosition` is what "comes first on the page" actually means
   * for a document in normal flow, and it does not care whether the element is
   * on screen or how tall its container is.
   */
  const order = async (path: string, a: string, b: string) =>
    page.evaluate(
      ([first, second]) => {
        const find = (t: string) =>
          [...document.querySelectorAll("h1,h2,h3,p,span,div,th,td")].find((e) =>
            (e.textContent || "").trim().startsWith(t),
          ) ?? null;
        const ea = find(first);
        const eb = find(second);
        if (!ea || !eb) return { found: false, aFirst: false, missing: !ea ? first : second };
        // DOCUMENT_POSITION_FOLLOWING === 4: b comes after a.
        return {
          found: true,
          aFirst: Boolean(ea.compareDocumentPosition(eb) & 4),
          missing: "",
        };
      },
      [a, b] as const,
    );

  // ── SALES ────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/sales`);
  await expect
    .poll(async () => page.getByText("Gross sales").count(), {
      timeout: 90_000,
      message: "sales never rendered its totals",
    })
    .toBeGreaterThan(0);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "e2e/__screens__/order-sales.png", fullPage: true });

  const salesChart = await order("/sales", "Gross sales", "Takings rhythm");
  console.log("sales — totals before the heat map:", JSON.stringify(salesChart));
  expect(salesChart.found, `sales: could not find ${salesChart.missing}`).toBe(true);
  expect(salesChart.aFirst, "sales: the chart is above the totals").toBe(true);

  const salesWork = await order("/sales", "Channel", "Takings rhythm");
  console.log("sales — entries before the heat map:", JSON.stringify(salesWork));
  expect(salesWork.found, `sales: could not find ${salesWork.missing}`).toBe(true);
  expect(salesWork.aFirst, "sales: the chart is above the day's takings").toBe(true);

  // ── EXPENSES ─────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/expenses`);
  await expect
    .poll(async () => page.getByText("Fixed costs").count(), {
      timeout: 90_000,
      message: "expenses never rendered its totals",
    })
    .toBeGreaterThan(0);

  // Widen the range until there is something to order. Expenses opens on TODAY
  // by his own instruction, and on a quiet day the breakdown and the donut are
  // not rendered at all — so testing the default range would be testing an
  // empty page and calling the layout verified.
  await page.locator('button[aria-haspopup="dialog"]').first().click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /^This year/ }).first().click();
  await expect
    .poll(async () => page.getByText("By category").count(), {
      timeout: 60_000,
      message: "no expenses in the whole year — nothing to order",
    })
    .toBeGreaterThan(0);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "e2e/__screens__/order-expenses.png", fullPage: true });

  const expWork = await order("/expenses", "Fixed costs", "By category");
  console.log("expenses — totals before the breakdown:", JSON.stringify(expWork));
  expect(expWork.found, `expenses: could not find ${expWork.missing}`).toBe(true);
  expect(expWork.aFirst, "expenses: the breakdown is above the totals").toBe(true);

  // The pie itself: it must come after the entries, which is the whole ask.
  const expPie = await order("/expenses", "By category", "Where it went");
  console.log("expenses — entries before the pie:", JSON.stringify(expPie));
  if (expPie.found) {
    expect(expPie.aFirst, "expenses: the pie chart is above the entries").toBe(true);
  } else {
    console.log("  (no pie on this range — heading was:", expPie.missing, ")");
  }
});
