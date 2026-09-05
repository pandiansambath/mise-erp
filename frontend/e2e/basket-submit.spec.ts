import { expect, test, type Page } from "@playwright/test";

/**
 * The basket bug he reported on 2026-09-05, tested for real.
 *
 *   "you can notice that basket is missing in 2nd pic... if i move cursor that
 *    basket is flickering and hidden. somehow i tried and clicked basket, now
 *    when i click submit indent nothing is happening. please use playwright to
 *    test the functionality. this is real bug."
 *
 * Two faults, so two tests:
 *
 *  1. SUBMIT DOES NOTHING. The button is passed as `footer` down into
 *     SheetPopup, which renders through createPortal(…, document.body). A
 *     portal keeps the React tree but not the DOM tree, so `type="submit"`
 *     had no form to submit — silently, with no error anywhere. The test
 *     watches the NETWORK: pressing the button must produce a POST. Asserting
 *     on a toast or a cleared basket would pass on a page that merely looks
 *     tidy; only the request proves the order left.
 *
 *  2. THE BASKET GOES OFF SCREEN. Its remembered position was applied blind on
 *     load, and the drag clamped against window.innerWidth, which includes the
 *     scrollbar. So the test plants a deliberately hostile position — far
 *     outside any real screen — and requires the basket to come back inside
 *     and to leave the page without horizontal overflow.
 */

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";

async function signIn(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
    } catch {
      /* a tour we cannot suppress is not a reason to fail */
    }
  });
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

test("submit indent actually posts the order", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);

  await page.goto(`${BASE}/purchasing`);
  await page.getByText("Show by").first().waitFor({ timeout: 30_000 });

  // "Add all" pulls every low-stock item in at once: one click, several lines,
  // no dependence on which items happen to exist on his tenant this week.
  const addAll = page.getByRole("button", { name: "Add all" }).first();
  await expect(addAll).toBeVisible({ timeout: 20_000 });
  await addAll.click();

  const basket = page.locator("#mise-basket");
  await expect(basket).toBeEnabled({ timeout: 15_000 });
  await basket.click();

  // By NAME, not by test id: the id is part of this fix, so a test that keyed
  // on it could not tell "the bug" from "not deployed yet" — and the first run
  // did exactly that. The visible words are on both builds.
  const submit = page.getByRole("button", { name: /Submit indent/i }).first();
  await expect(submit).toBeVisible({ timeout: 15_000 });

  // The precise check first, so a failure says WHY rather than just "no
  // request came". A portalled submit button has no <form> ancestor, so the
  // browser decides its owner from the `form` attribute — and if that name
  // resolves to anything that is not a form, the owner is silently null and the
  // click does nothing. That is how the first fix failed: the id it named was
  // already on the Card wrapper, so getElementById returned a DIV.
  const owner = await submit.evaluate(
    (b) => (b as HTMLButtonElement).form?.id ?? null,
  );
  expect(owner, "the submit button is not attached to any form").not.toBeNull();

  // THE ASSERTION THAT MATTERS. Before the fix this request never happened and
  // the click was swallowed in silence.
  const posted = page.waitForRequest(
    (r) => r.method() === "POST" && /\/purchasing\/indents\b/.test(r.url()),
    { timeout: 20_000 },
  );
  await submit.click();
  const req = await posted;
  expect(req.method()).toBe("POST");

  const res = await req.response();
  expect(res, "the indent POST got no response at all").not.toBeNull();
  expect(res!.status(), `indent POST returned ${res!.status()}`).toBeLessThan(300);
});

test("a remembered basket position can never park it off screen", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);

  // A position from a much wider window — or from the strip under the
  // scrollbar, which is what actually happened to him.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.basket.pos", JSON.stringify({ x: 6000, y: 4000 }));
    } catch {
      /* nothing to plant, nothing to prove */
    }
  });

  await page.goto(`${BASE}/purchasing`);
  await page.getByText("Show by").first().waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Add all" }).first().click();

  const basket = page.locator("#mise-basket");
  await expect(basket).toBeEnabled({ timeout: 15_000 });

  const box = await basket.boundingBox();
  expect(box, "the basket has no box at all").not.toBeNull();

  const view = page.viewportSize()!;
  expect(box!.x, "basket starts off the left edge").toBeGreaterThanOrEqual(0);
  expect(box!.y, "basket starts above the top edge").toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, "basket runs off the right edge").toBeLessThanOrEqual(view.width);
  expect(box!.y + box!.height, "basket runs below the bottom edge").toBeLessThanOrEqual(view.height);

  // And it must not have dragged the page sideways on its way out — the
  // horizontal scrollbar in his screenshots was the visible symptom.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls horizontally").toBeLessThanOrEqual(1);

  // It is still a working control, not just an on-screen one.
  await basket.click();
  await expect(page.getByRole("button", { name: /Submit indent/i }).first()).toBeVisible({ timeout: 15_000 });
});
