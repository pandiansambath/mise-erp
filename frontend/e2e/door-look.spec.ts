import { expect, test } from "@playwright/test";

/**
 * The hotel's own front door.
 *
 *   "seriously looking awkward (you literally copied the dineai login page
 *    here... worst bro)"
 *   "also see this: i can see scroll bar here. why the hell. i hate scroll"
 *
 * So this checks the two things he actually said: that the door is the HOTEL's
 * page and not the product's, and that it does not scroll. A sign-in screen is
 * one screen; if it scrolls, something is the wrong size.
 */

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";

for (const [label, width, height] of [
  ["desktop", 1280, 800],
  ["phone", 390, 844],
] as const) {
  test(`the door fits on one screen — ${label}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({
      viewport: { width, height },
      isMobile: label === "phone",
      hasTouch: label === "phone",
    });
    const page = await ctx.newPage();

    await page.goto(`${BASE}/login`);
    await page.waitForLoadState("domcontentloaded");
    // The door decides what to paint only once it knows which hotel it is, so
    // wait for the field rather than a timer.
    await page
      .locator('[data-testid="login-email"]:visible, #li-email:visible')
      .first()
      .waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);

    const overflow = await page.evaluate(() => ({
      down:
        document.documentElement.scrollHeight - document.documentElement.clientHeight,
      across:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      register: !!document.body.innerText.match(/create (an )?account|register|sign up/i),
    }));

    console.log(`DOOR ${label}:`, JSON.stringify(overflow));
    await page.screenshot({ path: `e2e-out/door-${label}.png`, fullPage: false });

    expect(overflow.across, `${label}: the door scrolls sideways`).toBeLessThanOrEqual(2);
    expect(overflow.down, `${label}: the door scrolls down`).toBeLessThanOrEqual(2);
    // "if they open their hotel's subdomain, here login only need to show. it
    // should not show register and all."
    expect(overflow.register, `${label}: the hotel door offered to register`).toBe(false);

    await ctx.close();
  });
}
