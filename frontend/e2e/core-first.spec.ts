import { expect, test } from "@playwright/test";

/**
 * Is the thing the page is FOR visible when you arrive?
 *
 * "core need to be in top or somewhere that will be shown on entry of that
 *  page." So the test is literal: land, do not scroll, and ask whether the
 *  core is inside the first screenful.
 */
const BASE = "https://nirai1.dineai.cloud";

const PAGES: { path: string; core: string; what: string }[] = [
  // The heading changed with the day-sheet rebuild ("Add today's takings" ->
  // "Today's takings"), and the test kept looking for the old words — so it
  // reported the entry MISSING from a page where it renders at the very top.
  // Matching on the stable noun rather than the sentence.
  { path: "/sales", core: "takings", what: "the takings entry" },
  { path: "/expenses", core: "Add expense", what: "the expense form" },
  // "Search items" is a PLACEHOLDER, and getByText does not read attributes —
  // the first run reported inventory as never rendering when it had. Use text
  // that is actually in the document.
  { path: "/inventory", core: "Stock value", what: "the item list toolbar" },
  { path: "/purchasing", core: "Show by", what: "the order pad" },
  { path: "/vendors", core: "All vendors", what: "the supplier list" },
];

test("the core is on screen when you land", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    try { localStorage.setItem("mise.tour.done", "1"); } catch { /* */ }
  });
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  const bad: string[] = [];
  for (const p of PAGES) {
    await page.goto(`${BASE}${p.path}`);
    await expect
      .poll(async () => page.getByText(p.core, { exact: false }).count(), {
        timeout: 60_000,
        message: `${p.path}: never rendered ${p.what}`,
      })
      .toBeGreaterThan(0);
    await page.waitForTimeout(1800);

    const r = await page.evaluate((needle) => {
      const el = [...document.querySelectorAll("*")].find(
        (e) =>
          (e.textContent || "").includes(needle) &&
          e.children.length < 4 &&
          (e as HTMLElement).offsetParent !== null,
      ) as HTMLElement | undefined;
      if (!el) return { found: false, top: -1, fold: window.innerHeight };
      return {
        found: true,
        top: Math.round(el.getBoundingClientRect().top),
        fold: window.innerHeight,
      };
    }, p.core);

    const ok = r.found && r.top >= 0 && r.top < r.fold;
    if (!ok) bad.push(`${p.path}: ${p.what} at ${r.top}px (fold ${r.fold})`);
    console.log(
      `${ok ? "ON SCREEN" : "BELOW    "} ${p.path.padEnd(18)} ${p.what.padEnd(24)} top=${r.top}px fold=${r.fold}`,
    );
  }
  console.log("\nBELOW THE FOLD:", bad.length);
  bad.forEach((b) => console.log("   " + b));
  expect(bad, `core not visible on arrival: ${bad.join(" | ")}`).toEqual([]);
});
