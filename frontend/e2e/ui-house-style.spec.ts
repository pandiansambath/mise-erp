import { expect, test } from "@playwright/test";

/**
 * "take /staff and /purchasing as reference for the UI — the cards, shadow,
 *  popup."
 *
 * Two references and three pages that were meant to follow them. This shoots
 * all five so the comparison is something I can LOOK at rather than assert
 * about — the difference between an inset card and a drop shadow does not
 * survive being turned into a boolean.
 *
 * The one thing worth asserting is that the reference class is actually
 * present, because a page can look plausible and still be built out of
 * something else entirely.
 */

const BASE = "https://nirai1.dineai.cloud";

const PAGES = [
  { path: "/staff", name: "ref-staff", reference: true },
  { path: "/purchasing", name: "ref-purchasing", reference: true },
  { path: "/expenses", name: "swept-expenses", reference: false },
  { path: "/vendors", name: "swept-vendors", reference: false },
  { path: "/price-comparison", name: "swept-price-comparison", reference: false },
];

test("every swept page is built from the reference card", async ({ page }) => {
  test.setTimeout(300_000);
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

  const report: Record<string, unknown>[] = [];

  for (const p of PAGES) {
    await page.goto(`${BASE}${p.path}`);
    await page.waitForLoadState("domcontentloaded");
    // Wait for CONTENT. A screenshot of a spinner has caught me twice already.
    await expect
      .poll(async () => page.locator("main *").count(), {
        timeout: 60_000,
        message: `${p.path} never rendered`,
      })
      .toBeGreaterThan(40);
    await page.waitForTimeout(3000);

    const counts = await page.evaluate(() => {
      const n = (sel: string) => document.querySelectorAll(sel).length;
      return {
        cardInset: n(".mise-card-inset"),
        card3d: n(".mise-card3d"),
        neoRaised: n(".mise-neo-raised"),
        press: n(".mise-press"),
        // The thing the sweep was meant to remove: bare rules doing the job a
        // card should do.
        hairlineRows: n("tr.border-b, div.border-b.border-line"),
      };
    });
    report.push({ page: p.path, ...counts });
    await page.screenshot({ path: `e2e/__screens__/house-${p.name}.png`, fullPage: false });
  }

  console.log("\nHOUSE STYLE AUDIT");
  for (const r of report) console.log(" ", JSON.stringify(r));

  // Each swept page must actually be built from the reference card, not merely
  // look tidy in a screenshot.
  for (const p of PAGES.filter((x) => !x.reference)) {
    const row = report.find((r) => r.page === p.path)!;
    const cards = (row.cardInset as number) + (row.card3d as number);
    expect(cards, `${p.path} has no reference cards at all`).toBeGreaterThan(0);
  }
});
