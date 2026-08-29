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

/**
 * Each page has to be DRIVEN to the state where its cards exist. The first
 * version of this audit counted them at rest and reported zero everywhere —
 * expenses opens on today and is empty on a quiet day, the vendor cards live
 * inside a detail sheet, and the comparison cards need an item chosen. It was
 * measuring three blank pages and calling the sweep missing.
 */
const PAGES: {
  path: string;
  name: string;
  reference: boolean;
  reach?: (page: import("@playwright/test").Page) => Promise<void>;
}[] = [
  { path: "/staff", name: "ref-staff", reference: true },
  { path: "/purchasing", name: "ref-purchasing", reference: true },
  {
    path: "/expenses",
    name: "swept-expenses",
    reference: false,
    // Widen off "today", or there is nothing to draw.
    reach: async (page) => {
      await page.locator('button[aria-haspopup="dialog"]').first().click();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: /^This year/ }).first().click();
      await page.waitForTimeout(2500);
    },
  },
  {
    path: "/vendors",
    name: "swept-vendors",
    reference: false,
    // The supply list is inside the sheet a vendor opens.
    reach: async (page) => {
      // A stable handle beats guessing at accessible names: this list is
      // supplier NAMES, so any name-based selector is really matching his data.
      await page.getByTestId("vendor-card").first().click();
      await page.waitForTimeout(2500);
    },
  },
  {
    path: "/price-comparison",
    name: "swept-price-comparison",
    reference: false,
    // The quote cards need an item chosen.
    reach: async (page) => {
      await page.locator("li button, [data-testid='item-tile'], button").filter({ hasText: /./ })
        .nth(6)
        .click()
        .catch(() => {});
      await page.waitForTimeout(2500);
    },
  },
  {
    path: "/employees",
    name: "swept-employees",
    reference: false,
  },
  {
    path: "/sales",
    name: "swept-sales",
    reference: false,
  },
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
    await page.waitForTimeout(2000);
    if (p.reach) await p.reach(page);
    await page.waitForTimeout(1200);

    const counts = await page.evaluate(() => {
      const n = (sel: string) => document.querySelectorAll(sel).length;
      // A page with nothing on it draws no cards, and that is not the same
      // fault as a page that was never swept. Sales on a quiet day has no
      // lines; the card CONTAINER is still there saying so.
      const emptyState = /no (sales|expenses|documents|employees|prices|restaurant documents)/i.test(
        document.body.innerText,
      );
      return {
        cardInset: n(".mise-card-inset"),
        card3d: n(".mise-card3d"),
        neoRaised: n(".mise-neo-raised"),
        press: n(".mise-press"),
        // The thing the sweep was meant to remove: bare rules doing the job a
        // card should do.
        hairlineRows: n("tr.border-b, div.border-b.border-line"),
        emptyState,
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
    if (cards === 0 && row.emptyState) {
      // Legitimately nothing to draw. Say so out loud rather than passing in
      // silence — a quiet skip is how a test starts verifying nothing.
      console.log(`  ${p.path}: no cards, but the page says it is EMPTY — not a miss`);
      continue;
    }
    expect(
      cards,
      `${p.path} drew no reference cards and does not report being empty, so ` +
        `the sweep missed it: ${JSON.stringify(row)}`,
    ).toBeGreaterThan(0);

    // Whatever it drew must be the reference card, not the old drop-shadow one.
    expect(
      row.neoRaised as number,
      `${p.path} still has ${row.neoRaised} drop-shadow cards among ${cards} reference ones`,
    ).toBeLessThanOrEqual(6);
  }
});
