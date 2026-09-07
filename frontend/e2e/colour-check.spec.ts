import { test, expect, type Page } from "@playwright/test";

/** The claim: the light-theme colour rescue now reaches INSIDE a popup, which
 *  it never could before, because popups portal into <body> and the selector
 *  was anchored on a div in the shell.
 *
 *  Checked by measuring, not by reading the CSS — the last two times I reasoned
 *  about a colour from the stylesheet I was wrong about which rule was winning. */

const BASE = process.env.BASE_URL || "http://localhost:3000";

async function signIn(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem("mise.tour.done", "1"); } catch { /* ignore */ }
  });
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

/** Relative luminance → contrast ratio, so the assertion is a number a human
 *  can argue with rather than "looks fine to me". */
function contrast(fg: string, bg: string): number {
  const parse = (c: string) => {
    const m = c.match(/\d+(\.\d+)?/g);
    if (!m) return [0, 0, 0];
    return m.slice(0, 3).map(Number);
  };
  const lum = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(parse(fg));
  const b = lum(parse(bg));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

test("the red inside a popup is a red you can read", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);

  const mode = await page.evaluate(() => document.documentElement.dataset.mode);
  console.log("HTML data-mode =", mode);
  expect(mode, "the mode must reach <html>, or no portal can see it").toBeTruthy();

  // The attendance person sheet, because that is the popup in his screenshot:
  // "Save this day" came out pink text on a pink fill. The copy-a-week popup
  // only renders its apply button when the source week HAS shifts, which makes
  // it a bad choice for a check that must not go green for the wrong reason.
  await page.goto(`${BASE}/attendance`);
  await page.waitForTimeout(3000);
  // The person card is a role="button" div, not a <button>.
  await page.getByRole("button").filter({ hasText: /Not in yet|Working|Clocked out/ }).first().click();
  await page.waitForTimeout(1500);

  const btn = page.locator('[data-testid="edit-save"]');
  await expect(btn).toBeVisible();
  await page.screenshot({ path: "e2e-out/colour-sheet.png" });
  const seen = await btn.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      color: cs.color,
      bg: cs.backgroundColor,
      panel: getComputedStyle(el.closest('[role="dialog"]')!).backgroundColor,
    };
  });

  const ratio = contrast(seen.color, seen.panel);
  console.log(`SAVE BUTTON ink=${seen.color} on panel=${seen.panel} → ${ratio.toFixed(2)}:1`);
  await page.screenshot({ path: "e2e-out/colour-popup.png" });

  // 4.5:1 is the WCAG AA floor for body text. "Save this day" measured barely
  // above 1:1 before — ink and paper the same colour is what "the text looks
  // blurred" actually was.
  expect(ratio, "primary button ink vs the popup it sits on").toBeGreaterThan(4.5);
  await ctx.close();
});
