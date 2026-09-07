import { test, type Page } from "@playwright/test";

/**
 * NAVIGATION AS HE ACTUALLY DOES IT — clicking the sidebar.
 *
 * My first measurement used `page.goto()`, which is a full browser reload: it
 * throws away the JS module state, and with it the in-memory read cache. So it
 * measured the one case the cache cannot help, and reported that the cache had
 * done nothing.
 *
 * Clicking a link is a CLIENT-side navigation. The cache survives, the shell
 * does not re-ask who he is, and that is the journey between pages he was
 * complaining about.
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

test("moving between pages the way a person does", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page);
  await page.waitForTimeout(4000);

  // There and back again: the second visit is the one that should be instant,
  // and "going back to a page I just left" is the complaint in one sentence.
  const walk = ["Inventory", "Sales & Cash", "Inventory", "Rota", "Sales & Cash"];

  for (const label of walk) {
    const calls: string[] = [];
    const on = (r: import("@playwright/test").Request) => {
      if (r.url().includes("/api/")) calls.push(r.url().replace(BASE, "").split("?")[0]);
    };
    page.on("request", on);

    const link = page.getByRole("link", { name: label, exact: true }).first();
    if ((await link.count()) === 0) {
      page.off("request", on);
      continue;
    }

    const t0 = Date.now();
    await link.click();
    await page.waitForTimeout(2500);
    page.off("request", on);

    // Was a spinner ever shown? That is the thing he says he should not see.
    const spinner = await page.locator('[class*="animate-spin"]').count();

    console.log(
      `NAV -> ${label.padEnd(14)} calls=${String(calls.length).padStart(2)}  ` +
        `ms=${Date.now() - t0}  spinnerNow=${spinner}  ${calls.join(" ")}`,
    );
  }
});
