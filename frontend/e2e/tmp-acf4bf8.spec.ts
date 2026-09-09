import { test, expect, type Page } from "@playwright/test";

/** TEMPORARY — verification of acf4bf8 on the live site. Deleted after the run.
 *
 *  The claim under test: the ↗ marker and its "Still reachable through …"
 *  sentence must appear ONLY when the other area that opens the page is
 *  actually switched on. Previously it appeared always, which made it state
 *  something false on a role where the other switch was off.
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

/** The "Pages they can open" headline, read as the raw string it renders. */
async function counter(page: Page): Promise<string> {
  return page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll("p"));
    const label = ps.find((p) => p.textContent?.trim() === "Pages they can open");
    const val = label?.nextElementSibling as HTMLElement | null;
    return val?.textContent?.trim() ?? "(not found)";
  });
}

/** The chip for one page inside one area row: its exact title and its text,
 *  so "has ↗" is read off the DOM rather than off a screenshot. */
async function chip(page: Page, areaLabel: string, pageLabel: string) {
  return page.evaluate(
    ({ areaLabel, pageLabel }) => {
      const group = Array.from(
        document.querySelectorAll('[role="radiogroup"]'),
      ).find((g) => g.getAttribute("aria-label") === areaLabel);
      const li = group?.closest("li");
      if (!li) return { found: false, title: "", text: "", arrow: false, struck: false };
      const spans = Array.from(li.querySelectorAll("span[title]"));
      const c = spans.find((s) => (s.getAttribute("title") || "").startsWith(pageLabel + ":"));
      if (!c) return { found: false, title: "", text: "", arrow: false, struck: false };
      return {
        found: true,
        title: c.getAttribute("title") || "",
        text: (c.textContent || "").trim(),
        arrow: (c.textContent || "").includes("↗"),
        struck: c.className.includes("line-through"),
      };
    },
    { areaLabel, pageLabel },
  );
}

/** What each page in the open per-page popup is set to right now. */
async function pageStates(page: Page, labels: string[]) {
  return page.evaluate((labels) => {
    const out: Record<string, string> = {};
    for (const l of labels) {
      const g = Array.from(document.querySelectorAll('[role="radiogroup"]')).find(
        (x) => x.getAttribute("aria-label") === `What they may do on ${l}`,
      );
      const on = g?.querySelector('[aria-checked="true"]');
      out[l] = on?.textContent?.trim() ?? "(none checked)";
    }
    return out;
  }, labels);
}

/** What one AREA switch is set to. */
async function areaState(page: Page, areaLabel: string) {
  return page.evaluate((areaLabel) => {
    const g = Array.from(document.querySelectorAll('[role="radiogroup"]')).find(
      (x) => x.getAttribute("aria-label") === areaLabel,
    );
    const on = g?.querySelector('[aria-checked="true"]');
    return on?.textContent?.trim() ?? "(none checked)";
  }, areaLabel);
}

function watchConsole(page: Page, sink: string[]) {
  page.on("console", (m) => {
    if (m.type() === "error") sink.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => sink.push(`pageerror: ${e.message}`));
}

async function openSection(page: Page, label: string) {
  await page.locator("nav button").filter({ hasText: label }).first().click();
  await page.waitForTimeout(400);
}

test("a) the FALSE case is now silent, b) the TRUE case still explains", async ({ browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  watchConsole(page, errors);
  await signIn(page);

  // ------------------------------------------------------------------ CASE A
  await page.goto(`${BASE}/staff`);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Create a role/ }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "e2e-out/acf-a0-new-role.png" });

  const start = await counter(page);
  console.log(`A) fresh role, nothing on: counter = "${start}"`);

  // Switch ON only "Sales & till" (Money section is the first one shown).
  await openSection(page, "Money");
  const sales = page.locator('[role="radiogroup"][aria-label="Sales & till"]').first();
  await sales.getByRole("radio", { name: "Can change", exact: true }).click();
  await page.waitForTimeout(600);
  const afterOn = await counter(page);
  console.log(`A) Sales & till = Can change: counter = "${afterOn}"`);
  await page.screenshot({ path: "e2e-out/acf-a1-sales-on.png" });

  // Kitchen / "Orders & parties" must be OFF for this to be the false case.
  await openSection(page, "Kitchen");
  const ordersState = await areaState(page, "Orders & parties");
  console.log(`A) Orders & parties (Kitchen) is: "${ordersState}"`);
  await openSection(page, "Money");

  // Hide Online Orders through the per-page popup.
  await page.locator('[data-testid="setpages-sales"]').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "e2e-out/acf-a2-popup.png" });
  await page.locator('[data-testid="pagelevel-online-orders-none"]').first().click();
  await page.waitForTimeout(500);
  await page
    .locator('[role="dialog"][aria-label="Sales & till"] button[aria-label="Close"]')
    .first()
    .click();
  await page.waitForTimeout(700);

  const afterHide = await counter(page);
  const chipA = await chip(page, "Sales & till", "Online Orders");
  console.log(`A) after hiding Online Orders: counter = "${afterHide}"`);
  console.log(`A) chip text = ${JSON.stringify(chipA.text)}`);
  console.log(`A) chip title = ${JSON.stringify(chipA.title)}`);
  console.log(`A) chip arrow=${chipA.arrow} struck=${chipA.struck}`);
  await page.screenshot({ path: "e2e-out/acf-a3-hidden.png" });

  expect(chipA.found, "the Online Orders chip should exist").toBe(true);
  expect(afterOn, "switching on Sales & till should reach its 3 pages").toBe("3 of 33");
  expect(afterHide, "with Kitchen off, hiding really does cost a page").toBe("2 of 33");
  expect(chipA.arrow, "no other route is open, so no ↗").toBe(false);
  expect(chipA.title, "the reassurance must not be shown when it is false").toBe(
    "Online Orders: hidden",
  );

  // Leave without saving. Nothing was created, so there is nothing to delete.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // ------------------------------------------------------------------ CASE B
  // Full reload so no draft from case A can leak into case B.
  await page.goto(`${BASE}/staff`);
  await page.waitForTimeout(2500);
  await page.locator('div[role="button"]').filter({ hasText: /sub-admin/i }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "e2e-out/acf-b0-subadmin.png" });

  await openSection(page, "Kitchen");
  const ordersOn = await areaState(page, "Orders & parties");
  console.log(`B) sub-admin: Orders & parties = "${ordersOn}"`);
  expect(ordersOn, "case B needs the other route switched ON").not.toBe("No access");

  await openSection(page, "Money");
  const bBefore = await counter(page);
  console.log(`B) before hiding: counter = "${bBefore}"`);

  await page.locator('[data-testid="setpages-sales"]').first().click();
  await page.waitForTimeout(800);
  await page.locator('[data-testid="pagelevel-online-orders-none"]').first().click();
  await page.waitForTimeout(500);
  await page
    .locator('[role="dialog"][aria-label="Sales & till"] button[aria-label="Close"]')
    .first()
    .click();
  await page.waitForTimeout(700);

  const bAfter = await counter(page);
  const chipB = await chip(page, "Sales & till", "Online Orders");
  console.log(`B) after hiding: counter = "${bAfter}"`);
  console.log(`B) chip text = ${JSON.stringify(chipB.text)}`);
  console.log(`B) chip title = ${JSON.stringify(chipB.title)}`);
  console.log(`B) chip arrow=${chipB.arrow} struck=${chipB.struck}`);
  await page.screenshot({ path: "e2e-out/acf-b1-hidden.png" });

  expect(bAfter, "another switch still opens it, so the count must not move").toBe(bBefore);
  expect(chipB.arrow, "the other route is real, so ↗ must be there").toBe(true);
  expect(chipB.title).toContain("Still reachable through");
  expect(chipB.title, "the sentence must name the section, not just the switch").toContain(
    "Orders & parties (under Kitchen)",
  );

  // NEVER save an existing role.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  console.log(`CONSOLE ERRORS (a+b): ${errors.length ? JSON.stringify(errors) : "none"}`);
  await ctx.close();
});

test("c) regression: the three-click sequence still lands where he asked", async ({ browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  watchConsole(page, errors);
  await signIn(page);

  await page.goto(`${BASE}/staff`);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Create a role/ }).first().click();
  await page.waitForTimeout(1200);

  await openSection(page, "Money");
  const sales = page.locator('[role="radiogroup"][aria-label="Sales & till"]').first();
  await sales.getByRole("radio", { name: "Can see", exact: true }).click();
  await page.waitForTimeout(500);
  console.log(`C) area set to: "${await areaState(page, "Sales & till")}" — counter ${await counter(page)}`);

  const LABELS = ["Sales & Cash", "Online Orders", "Money"];
  await page.locator('[data-testid="setpages-sales"]').first().click();
  await page.waitForTimeout(800);
  console.log(`C) opening state: ${JSON.stringify(await pageStates(page, LABELS))}`);

  await page.locator('[data-testid="pagelevel-online-orders-view"]').first().click();
  await page.waitForTimeout(400);
  const s1 = await pageStates(page, LABELS);
  console.log(`C) after click 1 (Online Orders -> Can look): ${JSON.stringify(s1)}`);

  await page.locator('[data-testid="pagelevel-sales-and-cash-edit"]').first().click();
  await page.waitForTimeout(400);
  const s2 = await pageStates(page, LABELS);
  console.log(`C) after click 2 (Sales & Cash -> Can change): ${JSON.stringify(s2)}`);

  await page.locator('[data-testid="pagelevel-money-edit"]').first().click();
  await page.waitForTimeout(400);
  const s3 = await pageStates(page, LABELS);
  console.log(`C) after click 3 (Money -> Can change): ${JSON.stringify(s3)}`);
  await page.screenshot({ path: "e2e-out/acf-c-final.png" });

  expect(s1["Online Orders"]).toBe("Can look");
  expect(s2["Sales & Cash"]).toBe("Can change");
  expect(s2["Money"], "Money must NOT be promoted behind him").toBe("Can look");
  expect(s3["Sales & Cash"]).toBe("Can change");
  expect(s3["Online Orders"]).toBe("Can look");
  expect(s3["Money"]).toBe("Can change");

  await page
    .locator('[role="dialog"][aria-label="Sales & till"] button[aria-label="Close"]')
    .first()
    .click();
  await page.waitForTimeout(600);
  console.log(`C) area is now: "${await areaState(page, "Sales & till")}" — counter ${await counter(page)}`);
  console.log(`C) chips: ${JSON.stringify(await chip(page, "Sales & till", "Online Orders"))}`);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  console.log(`CONSOLE ERRORS (c): ${errors.length ? JSON.stringify(errors) : "none"}`);
  await ctx.close();
});
