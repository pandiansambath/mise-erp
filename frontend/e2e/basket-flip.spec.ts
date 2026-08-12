// The card with a back, and the reveal that teaches it.
import { test, expect, type Page } from "@playwright/test";
const EMAIL = "owner@nirai.com";
const PASSWORD = "StrongPass123!";
async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#li-email:visible").first().fill(EMAIL);
  await page.locator("#li-password:visible").first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(2500);
}

test("the basket card turns over and carries the detail", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/purchasing");
  await page.getByTestId("category-tile").first().waitFor({ timeout: 60_000 });

  // Put something in the basket.
  await page.getByTestId("category-tile").first().click();
  await page.waitForTimeout(800);
  await page.getByTestId("item-tile").first().click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /Add to basket/ }).first().click();
  await page.waitForTimeout(1800);

  await page.locator("#mise-basket").click();
  // The reveal runs for ~2s; let it finish so we test the resting state.
  await page.waitForTimeout(3600);
  await page.screenshot({ path: "e2e/__screens__/basket-front.png" });

  const flip = page.locator(".mise-flip").first();
  await expect(flip, "a basket line should be a flip card").toHaveCount(1);
  expect(await flip.getAttribute("data-flipped"), "should rest on the front").not.toBe("true");

  // Turn it with the i.
  await page.getByRole("button", { name: /costs, in every size/ }).first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "e2e/__screens__/basket-back.png" });

  expect(await flip.getAttribute("data-flipped"), "the card should now be turned").toBe("true");
  const rotated = await page
    .locator(".mise-flip-inner")
    .first()
    .evaluate((el) => getComputedStyle(el).transform);
  console.log("inner transform:", rotated);
  expect(rotated, "a turned card must actually be rotated, not just marked").not.toBe("none");

  const back = page.locator(".mise-flip-back").first();
  const seen = await back.evaluate((el) => getComputedStyle(el).opacity);
  console.log("back opacity:", seen);
  expect(Number(seen), "the back must be VISIBLE, not merely present").toBeGreaterThan(0.9);
  const m = await back.evaluate((el) => getComputedStyle(el).transform);
  console.log("back transform:", m);
  // A mirrored face has a negative horizontal scale in its matrix. Readable
  // text needs the back's own half-turn to survive hover.
  const firstCell = Number(m.replace(/^matrix3?d?\(/, "").split(",")[0]);
  expect(firstCell, "the back must not render mirrored").toBeLessThan(0);

  const txt = await back.innerText();
  console.log("back of the card:", txt.replace(/\s+/g, " ").slice(0, 160));
  expect(txt).toMatch(/in stock/);
  expect(txt).toMatch(/after this/);

  // Both faces share one box, so the grid cannot go ragged.
  const box = await flip.boundingBox();
  const backBox = await back.boundingBox();
  console.log(
    `card ${Math.round(box!.width)}x${Math.round(box!.height)}, ` +
      `back ${Math.round(backBox!.width)}x${Math.round(backBox!.height)}`,
  );
  expect(box!.height, "the card must not grow into a page").toBeLessThan(220);
  // Everything on the back has to FIT — it was rendering with its last rows cut off.
  const overflow = await back.evaluate(
    (el) => el.scrollHeight - el.clientHeight,
  );
  console.log("back clipped by:", overflow, "px");
  expect(overflow, "the back must not be clipped").toBeLessThanOrEqual(1);
});
