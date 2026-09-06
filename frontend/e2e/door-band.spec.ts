import { test } from "@playwright/test";

/** Diagnostic: a dark strip runs down the right edge of the hotel door, and
 *  scrollWidth is 10px NARROWER than clientWidth. Something is sized against a
 *  width that is not the window's. */

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";

test("what is 10px short on the door", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator('[data-testid="login-email"]:visible, #li-email:visible')
    .first()
    .waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);

  const out = await page.evaluate(() => {
    const de = document.documentElement;
    const rows: Record<string, unknown>[] = [];
    const walk = (el: Element, depth: number) => {
      if (depth > 4) return;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.height > 200) {
        rows.push({
          tag: el.tagName,
          cls: (el.className || "").toString().slice(0, 90),
          w: Math.round(r.width),
          left: Math.round(r.left),
          right: Math.round(r.right),
          pos: cs.position,
          bg: cs.backgroundColor,
        });
      }
      for (const c of Array.from(el.children)) walk(c, depth + 1);
    };
    walk(document.body, 0);
    return {
      innerWidth: window.innerWidth,
      htmlClientW: de.clientWidth,
      htmlScrollW: de.scrollWidth,
      bodyW: Math.round(document.body.getBoundingClientRect().width),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      htmlBg: getComputedStyle(de).backgroundColor,
      boxes: rows.slice(0, 12),
    };
  });
  console.log("BAND", JSON.stringify(out, null, 1));
});
