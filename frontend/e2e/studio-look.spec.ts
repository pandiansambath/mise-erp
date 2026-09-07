import { expect, test, type Page } from "@playwright/test";

/** The page studio, on the live site. He reported three things about it, and
 *  all three are the kind that a passing assertion cannot settle — so this
 *  measures, then photographs. */

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

test("the studio fits, and the preview scrolls itself", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(4000);

  // One entry, not two.
  expect(await page.getByTestId("open-studio-door").count(), "the second card is back").toBe(0);
  await page.getByTestId("open-studio-site").click();
  await expect(page.getByTestId("preview-site")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500);

  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const frame = document.querySelector(".mise-noscrollbar.overflow-y-auto.overscroll-contain");
    const r = frame?.getBoundingClientRect();
    return {
      pageScroll: doc.scrollHeight - doc.clientHeight,
      frameBottom: r ? Math.round(r.bottom) : -1,
      viewport: window.innerHeight,
      frameScrollable: frame ? frame.scrollHeight > frame.clientHeight : false,
    };
  });
  console.log("STUDIO", JSON.stringify(m));

  // The studio must not scroll to reveal its own preview.
  expect(m.pageScroll, "the studio page scrolls").toBeLessThanOrEqual(2);
  expect(m.frameBottom, "the preview runs off the bottom").toBeLessThanOrEqual(m.viewport);
  // ...and the page inside it must be the thing that scrolls.
  expect(m.frameScrollable, "the preview has nothing to scroll").toBe(true);

  await page.screenshot({ path: "e2e-out/studio-wide.png" });

  await page.getByTestId("preview-tall").click();
  await page.waitForTimeout(1500);
  const phone = await page.evaluate(() => {
    const frame = document.querySelector(".mise-noscrollbar.overflow-y-auto.overscroll-contain");
    const r = frame?.getBoundingClientRect();
    return { bottom: r ? Math.round(r.bottom) : -1, viewport: window.innerHeight };
  });
  console.log("PHONE", JSON.stringify(phone));
  expect(phone.bottom, "the phone frame runs off the bottom").toBeLessThanOrEqual(phone.viewport);
  await page.screenshot({ path: "e2e-out/studio-phone.png" });

  await page.getByTestId("preview-door").click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "e2e-out/studio-door.png" });
});
