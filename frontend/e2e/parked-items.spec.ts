import { test, expect, type Page } from "@playwright/test";

/** The three Sales/Expenses items he parked behind the voice work, checked on
 *  the live site before anything is changed.
 *
 *  Two of them were raised on 24 Aug and the code has moved since: the pinned
 *  "IN THE CASH BOX" band has been folded into the totals strip, and Expenses
 *  never adopted the range memory that the other pages use. So the honest first
 *  step is to look, not to write a fix for a fault that may already be gone —
 *  inventing a change for a symptom nobody can still reproduce is how a page
 *  acquires a workaround it does not need.
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

test("cash: the carry shows without pressing the dead-looking Save", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);

  await page.goto(`${BASE}/sales`);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: "e2e-out/p-sales.png", fullPage: true });

  // Straight from the API, so this is what every OTHER consumer sees too — the
  // day PDF, the reports, the auto-close and the assistant. The browser used to
  // patch the arithmetic locally, which made the panel right and left the API
  // wrong, and only the panel was ever looked at.
  const day = await page.evaluate(async () => {
    const iso = new Date().toISOString().slice(0, 10);
    const r = await fetch(`/api/sales/days/${iso}`, { credentials: "include" });
    if (!r.ok) return { status: r.status };
    const d = await r.json();
    return {
      status: r.status,
      opening_cash: d.opening_cash,
      suggested_opening: d.suggested_opening,
      expected_cash: d.expected_cash,
      drawer_opening: d.drawer?.opening,
    };
  });
  console.log(`CASH DAY ${JSON.stringify(day)}`);

  // The strip's fourth cell must not read zero while a float is being offered.
  const strip = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll("*")).filter((el) =>
      (el.textContent || "").trim().startsWith("In the cash box"),
    );
    const el = cells[cells.length - 1] as HTMLElement | undefined;
    return el ? el.textContent?.replace(/\s+/g, " ").trim().slice(0, 90) : null;
  });
  console.log(`CASH STRIP ${strip}`);
  await ctx.close();
});

test("expenses: does the range come back to today", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);

  await page.goto(`${BASE}/expenses`);
  await page.waitForTimeout(3000);

  const read = () =>
    page.evaluate(() => {
      const dates = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
      return dates.slice(0, 2).map((d) => d.value);
    });

  const atFirst = await read();
  console.log(`EXPENSES on arrival ${JSON.stringify(atFirst)}`);

  // Widen it the way he would when investigating something.
  const first = page.locator('input[type="date"]').first();
  if ((await first.count()) > 0) {
    await first.fill("2026-08-01");
    await page.waitForTimeout(1500);
    console.log(`EXPENSES after changing ${JSON.stringify(await read())}`);

    // Away and back — in-app navigation, not a reload. A reload would remount
    // everything and prove nothing; the question is whether the router's cached
    // segment hands back the state he left behind.
    await page.getByRole("link", { name: /Dashboard/i }).first().click();
    await page.waitForTimeout(2500);
    await page.getByRole("link", { name: /Expenses/i }).first().click();
    await page.waitForTimeout(2500);

    const back = await read();
    console.log(`EXPENSES on returning ${JSON.stringify(back)}`);
    await page.screenshot({ path: "e2e-out/p-expenses.png" });

    const today = new Date().toISOString().slice(0, 10);
    // Reported, not asserted: this test exists to SEE the behaviour. Asserting
    // an answer before knowing which way it goes is how a check ends up
    // enforcing the bug.
    console.log(`EXPENSES snapped back to today? ${back[0] === today}`);
  } else {
    console.log("EXPENSES — no date inputs found; the filter is a different control");
  }
  expect(true).toBe(true);
  await ctx.close();
});
