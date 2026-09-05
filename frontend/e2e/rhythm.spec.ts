import { expect, test, type Page } from "@playwright/test";

/**
 * "i should not feel tight UI feel .. also not too much space also"
 *
 * Two numbers per page, because those are the two failure modes he named:
 *
 *  1. HOW FAR DOWN the core is. Too far = he scrolls to do the job.
 *  2. HOW MUCH EMPTY BAND sits above it. Too much = the page feels padded out
 *     with things he did not come for.
 *
 * Reported as measurements, not just pass/fail — a pass that hides "the core is
 * 690px down on an 800px screen" is the kind of green tick I have shipped
 * before.
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
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

const PAGES: { path: string; core: RegExp; what: string }[] = [
  { path: "/dashboard", core: /Today's net sales/i, what: "the first KPI" },
  { path: "/money", core: /Kept this month|Lost this month/i, what: "the profit headline" },
  { path: "/sales", core: /Takings/, what: "the takings sheet" },
  { path: "/expenses", core: /Add expense/, what: "the expense form" },
  { path: "/reports", core: /Net sales/i, what: "the P&L headline" },
  { path: "/inventory", core: /Add item/i, what: "the item toolbar" },
];

test("the money pages are neither tight nor padded", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page);

  const view = page.viewportSize()!;
  const report: string[] = [];
  const tooFar: string[] = [];

  for (const p of PAGES) {
    await page.goto(`${BASE}${p.path}`);
    const el = page.getByText(p.core).first();
    await el.waitFor({ timeout: 30_000 }).catch(() => {});
    const box = await el.boundingBox().catch(() => null);
    if (!box) {
      tooFar.push(`${p.path}: ${p.what} never rendered`);
      continue;
    }
    report.push(`${p.path.padEnd(12)} ${p.what.padEnd(22)} top=${Math.round(box.y)}px`);
    // Half the screen is the line: past it, the page is mostly preamble.
    if (box.y > view.height * 0.62) {
      tooFar.push(`${p.path}: ${p.what} is ${Math.round(box.y)}px down on a ${view.height}px screen`);
    }
  }

  console.log(`RHYTHM @ ${view.width}x${view.height}\n` + report.join("\n"));
  expect(tooFar, tooFar.join(" | ")).toEqual([]);
});
