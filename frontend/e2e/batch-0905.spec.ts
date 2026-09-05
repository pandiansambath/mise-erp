import { expect, test, type Page } from "@playwright/test";

/**
 * The 2026-09-05 batch, checked on the deployed site.
 *
 * Written to fail for the RIGHT reason. Past runs of mine have passed on a
 * spinner, measured the login page twenty times, and matched a placeholder that
 * getByText cannot see — so every assertion here names something a person would
 * point at, and the mobile checks run the same steps rather than a reduced set:
 *
 *   "whatever we're seeing in inventory page (all the feature popups, click to
 *    show etc etc), all these the exact same thing need to be in mobile view
 *    too. so please don't miss in mobile by focusing only on desktop view."
 */

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";

async function signIn(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
    } catch {
      /* a tour we cannot suppress is not a reason to fail */
    }
  });
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

test("every inventory row opens, not only the ones with purchase history", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/inventory`);
  // ONE MARKER, BOTH LAYOUTS. The phone list is separate markup (`lg:hidden`
  // cards, because a six-column table on a 390px screen is not a table), so
  // naming the <tr> tested nothing at mobile width — it resolved to a hidden
  // element and sat there for 30s. `:visible` picks whichever list is actually
  // on screen, which is the only honest way to check parity.
  await page.locator('[data-testid="inv-row"]:visible').first().waitFor({ timeout: 30_000 });

  // The bug was per-ROW, so one row is not a test. Take several and require all
  // of them to open: Bay Leaves (has purchases) opened before, Brinjal (has
  // suppliers, never bought) did not, and nothing on screen said why.
  const rows = page.locator('[data-testid="inv-row"]:visible');
  const total = await rows.count();
  expect(total, "no inventory rows rendered at all").toBeGreaterThan(3);

  // Read the names FIRST, then open one at a time.
  //
  // The earlier version called innerText() inside the loop, and on a phone the
  // open sheet covers the list — so once a sheet was slow to close, the next
  // row was no longer visible and innerText waited until the test died. It
  // reported a 180s timeout, which reads like a broken page and was a broken
  // loop. Names up front, and each close is awaited explicitly.
  const sample = Math.min(total, 5);
  const names: string[] = [];
  for (let i = 0; i < sample; i += 1) {
    names.push((await rows.nth(i).innerText()).split("\n")[0].trim());
  }

  const failures: string[] = [];
  for (let i = 0; i < sample; i += 1) {
    const sheet = page.getByRole("dialog").first();
    try {
      await rows.nth(i).click();
      await expect(sheet).toBeVisible({ timeout: 10_000 });
    } catch {
      failures.push(names[i]);
    }
    // Always leave the page closed, whatever happened, or the next iteration
    // is testing a covered list rather than a row.
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  }
  expect(failures, `these rows did not open: ${failures.join(", ")}`).toEqual([]);
});

test("choosing a supplier happens in place, not on another page", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/inventory`);
  // ONE MARKER, BOTH LAYOUTS. The phone list is separate markup (`lg:hidden`
  // cards, because a six-column table on a 390px screen is not a table), so
  // naming the <tr> tested nothing at mobile width — it resolved to a hidden
  // element and sat there for 30s. `:visible` picks whichever list is actually
  // on screen, which is the only honest way to check parity.
  await page.locator('[data-testid="inv-row"]:visible').first().waitFor({ timeout: 30_000 });

  // :visible on BOTH, because both lists carry these ids now. The phone cards
  // come first in the DOM, so at desktop width .first() resolved to the hidden
  // mobile chip and the test reported "no supplier chip on any row" while the
  // page had plenty. The same locator trap as before, pointing the other way.
  const chip = page
    .locator('[data-testid="inv-choose-supplier"]:visible, [data-testid="inv-add-supplier"]:visible')
    .first();
  await expect(chip, "no supplier chip on any row").toBeVisible({ timeout: 20_000 });

  const before = page.url();
  await chip.click();

  // The whole point: a popup here, and the URL unchanged. It used to navigate
  // to /price-comparison or /vendors?new=1.
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 10_000 });
  expect(page.url(), "clicking the chip navigated away").toBe(before);
  await expect(
    page.getByTestId("inv-popup-add-supplier").or(page.getByTestId("inv-popup-supplier")).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test("the item popup is sections, not one long scroll", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/inventory`);
  // ONE MARKER, BOTH LAYOUTS. The phone list is separate markup (`lg:hidden`
  // cards, because a six-column table on a 390px screen is not a table), so
  // naming the <tr> tested nothing at mobile width — it resolved to a hidden
  // element and sat there for 30s. `:visible` picks whichever list is actually
  // on screen, which is the only honest way to check parity.
  await page.locator('[data-testid="inv-row"]:visible').first().waitFor({ timeout: 30_000 });

  await page.locator('[data-testid="inv-row"]:visible').first().click();
  const sheet = page.getByRole("dialog").first();
  await expect(sheet).toBeVisible({ timeout: 15_000 });

  for (const label of ["Item", "Suppliers", "Purchases"]) {
    await expect(
      sheet.getByRole("button", { name: new RegExp(label, "i") }).first(),
      `no "${label}" section in the item popup`,
    ).toBeVisible({ timeout: 10_000 });
  }

  // Switching sections must actually change what is on screen — a rail that
  // scrolls to a heading instead of swapping the body is the same long scroll
  // wearing a hat.
  await sheet.getByRole("button", { name: /Suppliers/i }).first().click();
  await expect(sheet.getByText(/costing uses this price|Add another supplier/i).first())
    .toBeVisible({ timeout: 10_000 });
});

test("my space renders that person's own attendance history and rota", async ({ page }) => {
  test.setTimeout(180_000);

  // WHY THIS ONE IS STUBBED, WHEN NOTHING ELSE HERE IS.
  //
  // /my needs a login LINKED to an employee record. The superadmin is not
  // linked — /me/employee returns 404 on his tenant and the page correctly says
  // so — and a new staff account cannot sign in until its email is verified,
  // which needs an inbox I do not have. Creating a half-working login on his
  // live tenant to satisfy a test is not a trade worth making.
  //
  // So the SERVER side is covered by backend/tests/test_selfservice_rota.py
  // (scoping, the range filter, the totals), and this checks the other half:
  // that the deployed page renders those payloads. The bundle is the real one
  // from prod; only the three /me responses are supplied.
  const day = (o: number) => {
    const d = new Date();
    d.setDate(d.getDate() + o);
    return d.toISOString().slice(0, 10);
  };
  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

  await page.route("**/api/me/employee", (r) =>
    r.fulfill(json({ id: "e1", full_name: "Selvi Kumar", employee_code: "EMP-001", salary_type: "HOURLY" })),
  );
  await page.route("**/api/me/attendance/history*", (r) =>
    r.fulfill(
      json({
        date_from: day(-30),
        date_to: day(0),
        totals: {
          present: 12, half_days: 1, absent: 2, recorded_days: 15,
          total_hours: "96.5", indicative_pay: "965.00", basis: "96.5h x £10/h",
        },
        days: [
          {
            employee_id: "e1", employee_name: "Selvi Kumar", date: day(-1),
            clock_in: null, clock_out: null, break_minutes: 0,
            working_hours: "8.00", status: "PRESENT",
          },
        ],
      }),
    ),
  );
  await page.route("**/api/me/rota*", (r) =>
    r.fulfill(
      json([
        {
          id: "s1", employee_id: "e1", employee_name: "Selvi Kumar", date: day(0),
          start_time: "09:00:00", end_time: "17:00:00", break_minutes: 30,
          hours: "7.50", cost: "75.00", notes: null,
        },
      ]),
    ),
  );
  await page.route("**/api/me/attendance", (r) => r.fulfill(json([])));
  await page.route("**/api/me/payslips", (r) => r.fulfill(json([])));
  await page.route("**/api/me/documents", (r) => r.fulfill(json([])));
  await page.route("**/api/me/document-requests", (r) => r.fulfill(json([])));

  await signIn(page);
  await page.goto(`${BASE}/my`);

  await expect(page.getByRole("heading", { name: /My attendance/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /My rota/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /My documents/i })).toBeVisible({ timeout: 20_000 });

  // The figures have to ARRIVE, not just the headings — response_model has
  // silently dropped declared-looking fields four times in this project, and a
  // heading over an empty box would look identical to a working page.
  // "96.5" is never on the screen: fmtHours turns it into "96h 30m", which is
  // the string a person actually reads. Asserting the raw decimal was my test
  // describing the payload rather than the page.
  await expect(page.getByText("96h 30m").first(), "the hours total never rendered")
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/rostered/i).first(), "the rota shift never rendered")
    .toBeVisible({ timeout: 15_000 });
});

test("the money pages put their core on the first screen", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);

  // Measured against the SCROLL CONTAINER, not the window: this app scrolls an
  // inner element, so window.scrollY is always 0 and any test reading it is
  // measuring nothing. Reported as "the core is Npx down", which is the number
  // he actually cares about.
  const checks: { path: string; core: RegExp; what: string }[] = [
    { path: "/sales", core: /Takings/, what: "the takings sheet" },
    { path: "/expenses", core: /Add expense/, what: "the expense form" },
    { path: "/reports", core: /Net profit/, what: "the P&L headline" },
  ];

  const bad: string[] = [];
  for (const c of checks) {
    await page.goto(`${BASE}${c.path}`);
    const el = page.getByText(c.core).first();
    await el.waitFor({ timeout: 30_000 }).catch(() => {});
    const box = await el.boundingBox().catch(() => null);
    if (!box) {
      bad.push(`${c.path}: ${c.what} never rendered`);
      continue;
    }
    const view = page.viewportSize()!;
    if (box.y > view.height) {
      bad.push(`${c.path}: ${c.what} is ${Math.round(box.y)}px down, below a ${view.height}px screen`);
    }
  }
  expect(bad, bad.join(" | ")).toEqual([]);
});
