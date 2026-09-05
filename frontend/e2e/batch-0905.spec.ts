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
  await page.getByText("Stock value").first().waitFor({ timeout: 30_000 });

  // The bug was per-ROW, so one row is not a test. Take several and require all
  // of them to open: Bay Leaves (has purchases) opened before, Brinjal (has
  // suppliers, never bought) did not, and nothing on screen said why.
  const rows = page.locator("tbody tr[aria-expanded]");
  const total = await rows.count();
  expect(total, "no inventory rows rendered at all").toBeGreaterThan(3);

  const sample = Math.min(total, 6);
  const failures: string[] = [];
  for (let i = 0; i < sample; i += 1) {
    const row = rows.nth(i);
    const name = (await row.locator("td").first().innerText()).split("\n")[0].trim();
    await row.click();
    const opened = page.getByRole("dialog").first();
    try {
      await expect(opened).toBeVisible({ timeout: 8_000 });
      await page.keyboard.press("Escape");
      await expect(opened).toBeHidden({ timeout: 8_000 });
    } catch {
      failures.push(name);
      await page.keyboard.press("Escape");
    }
  }
  expect(failures, `these rows did not open: ${failures.join(", ")}`).toEqual([]);
});

test("choosing a supplier happens in place, not on another page", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/inventory`);
  await page.getByText("Stock value").first().waitFor({ timeout: 30_000 });

  const chip = page
    .getByTestId("inv-choose-supplier")
    .or(page.getByTestId("inv-add-supplier"))
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
  await page.getByText("Stock value").first().waitFor({ timeout: 30_000 });

  await page.locator("tbody tr[aria-expanded]").first().click();
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

test("my space shows this person's own attendance history and rota", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/my`);

  // A superadmin may not be linked to an employee record; that page states so
  // plainly and there is nothing else to check on this tenant.
  const notLinked = page.getByText(/isn't linked to an employee record/i);
  if (await notLinked.isVisible({ timeout: 15_000 }).catch(() => false)) {
    test.skip(true, "this login has no employee record linked - nothing to assert");
  }

  await expect(page.getByRole("heading", { name: /My attendance/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /My rota/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /My documents/i })).toBeVisible({ timeout: 20_000 });

  // The history filter is the ask ("he can use filter to go back"), so the
  // totals have to be present, not just the table.
  await expect(page.getByText(/Hours worked/i).first()).toBeVisible({ timeout: 15_000 });
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
