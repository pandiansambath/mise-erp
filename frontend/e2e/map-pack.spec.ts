/** The map must never draw one bubble on top of another.
 *
 *  This has happened, on this page, in production: six node labels
 *  superimposed in a 200x90px region with one disc inside another. It
 *  survived because the only overlap check was compiled out of the shipping
 *  build — `if (process.env.NODE_ENV === "production") return;` — so the one
 *  assertion that would have caught it ran nowhere near the build that had
 *  it.
 *
 *  The check now runs in production and publishes its result as
 *  `data-map-overlap` on the <svg>. This asserts that attribute, which is
 *  the difference between a guarantee and a hope.
 *
 *  A real Playwright spec, not a scratch file: it is named without the
 *  `_`/`tmp-`/`qa-` prefixes the agent scratch specs use, so it is tracked
 *  and linted like any other source.
 */

import { expect, test } from "@playwright/test";

test("no two bubbles overlap on the platform map", async ({ page }) => {
  await page.goto("/control-room/graph");

  // The map draws once the payload lands; the attribute is written by an
  // effect after layout, so wait for the <svg> rather than a fixed delay.
  const svg = page.locator("svg[data-map-overlap]");
  await expect(svg).toBeVisible({ timeout: 20_000 });

  // ZERO, not "few". An overlap here is two restaurants at one coordinate,
  // and there is no number of those that is acceptable.
  await expect(svg).toHaveAttribute("data-map-overlap", "0");
});
