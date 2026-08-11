// Look at the screens he complained about, on the box that is actually serving
// them. Not "does the class exist" — a picture, because "not centred", "feels
// plain" and "cards not visible" are all things only an eye can settle.
import { test, expect, type Page } from "@playwright/test";

const EMAIL = "owner@nirai.com";
const PASSWORD = "StrongPass123!";
const SHOTS = "e2e/__screens__";
// Tag every shot with the width it was taken at — otherwise a mobile run
// silently overwrites the desktop evidence and you compare the wrong picture.
const tag = (page: Page) => `${page.viewportSize()?.width ?? 0}`;

async function login(page: Page) {
  await page.goto("/login");
  // The page carries the sign-in AND sign-up forms, so target the sign-in
  // fields by id rather than by label — "Email" matches both.
  // NOTE: the login page renders #li-email TWICE (a desktop and a mobile
  // variant both in the DOM), so the id is not unique. Take the visible one.
  await page.locator("#li-email:visible").first().fill(EMAIL);
  await page.locator("#li-password:visible").first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  // A first-run tour sits over the app and swallows every click, and it appears
  // on a delay — so racing it with a click is unreliable. Set the flag it reads
  // and reload, which is the same thing a returning user has.
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2500);
}

test("purchasing: the popup is centred and the cards carry detail", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/purchasing");
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${SHOTS}/pur-1-page-${tag(page)}.png` });

  // Layer one: a category tile.
  const cat = page.locator("button").filter({ hasText: /^\S.*\d+ items$/ }).first();
  await cat.scrollIntoViewIfNeeded();
  await cat.click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/pur-2-category-popup-${tag(page)}.png` });

  // The floating launcher must stand down while a popup is up. On a phone it
  // sat bottom-left, directly on top of a sheet's own Save button.
  const launcher = page.locator(".mise-launcher-in").first();
  if (await launcher.count()) {
    const hidden = await launcher.evaluate(
      (el) => getComputedStyle(el).opacity === "0" || getComputedStyle(el).pointerEvents === "none",
    );
    expect(hidden, "the Copilot launcher should stand down under a popup").toBe(true);
  }

  // CENTRED? Measure it rather than believe it. This is the exact class of
  // claim that a class name can satisfy while the screen does not.
  const box = await page.locator("[role=dialog]").first().boundingBox();
  // Measure against the containing block a FIXED element actually sees, not
  // the viewport. The app sets scrollbar-gutter: stable, which reserves 10px
  // that documentElement.clientWidth still counts — so a perfectly centred
  // panel reads as 5px off and you go hunting a bug that is not there.
  const vp = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;inset:0;pointer-events:none;visibility:hidden";
    document.body.appendChild(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    return { width: r.width, height: r.height, left: r.left, top: r.top };
  });
  expect(box, "the category popup should be on screen").toBeTruthy();
  const dxCentre = Math.abs(box!.x + box!.width / 2 - (vp.left + vp.width / 2));
  const dyCentre = Math.abs(box!.y + box!.height / 2 - (vp.top + vp.height / 2));
  console.log(`popup centre is off by x=${Math.round(dxCentre)}px y=${Math.round(dyCentre)}px`);
  expect(dxCentre, "horizontally centred").toBeLessThan(4);
  expect(dyCentre, "vertically centred").toBeLessThan(4);

  // Layer two: an item, which is where the price detail has to be legible.
  const item = page.locator("[role=dialog] button").filter({ hasText: /have/ }).first();
  if (await item.count()) {
    await item.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${SHOTS}/pur-3-item-popup-${tag(page)}.png` });
    const inner = await page.locator("[role=dialog]").last().boundingBox();
    const dx2 = Math.abs(inner!.x + inner!.width / 2 - (vp.left + vp.width / 2));
    console.log(`item popup off-centre x=${Math.round(dx2)}px`);
    expect(dx2).toBeLessThan(4);
  }
});

test("vendors: a price says what it buys", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/vendors");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${SHOTS}/ven-1-page-${tag(page)}.png`, fullPage: true });

  // Into a vendor, to its Supplies, and onto a price — which is the row he was
  // looking at when he asked what the £3 was for.
  const vendor = page.locator("button, tr").filter({ hasText: /exotic|farm2land/i }).first();
  if (await vendor.count()) {
    await vendor.click();
    await page.waitForTimeout(1800);
    const supplies = page.getByRole("button", { name: /supplies/i }).first();
    if (await supplies.count()) {
      await supplies.click();
      await page.waitForTimeout(1200);
    }
    await page.screenshot({ path: `${SHOTS}/ven-2-supplies-${tag(page)}.png` });

    const priceRow = page.locator("tbody tr").first();
    if (await priceRow.count()) {
      await priceRow.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${SHOTS}/ven-3-price-detail-${tag(page)}.png` });
    }
  }
});
