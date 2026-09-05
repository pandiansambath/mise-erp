// The exact journey he walked, on the box that serves it.
//
// "did you see the total in that basket, it showing as 0.99 pound instead of
// 1 pounds... we need exact values in all the places."
//
// A unit test would have passed the old code too — the arithmetic was never
// wrong, the ROUND TRIP through a rounded display was. So this drives the real
// controls and reads the real numbers off the screen.
import { test, expect, type Page } from "@playwright/test";

const EMAIL = "owner@nirai.com";
const PASSWORD = "StrongPass123!";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('[data-testid="login-email"]:visible').first().fill(EMAIL);
  await page.locator('[data-testid="login-password"]:visible').first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);
}

test("a piece stays a piece, through edit and a unit swap", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  // Start clean, or a leftover basket makes the totals unreadable.
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("mise.basket.")) localStorage.removeItem(k);
  });
  await page.goto("/purchasing");
  await page.getByTestId("category-tile").first().waitFor({ timeout: 60_000 });

  // Find a category holding an item that comes in packs — that is the only
  // shape this bug lives in.
  let found = false;
  const cats = await page.getByTestId("category-tile").count();
  for (let i = 0; i < cats && !found; i++) {
    await page.getByTestId("category-tile").nth(i).click();
    await page.waitForTimeout(700);
    const packItem = page.getByTestId("item-tile").filter({ hasText: /1 bottle|1 box|1 case|1 pack/ }).first();
    if (await packItem.count()) {
      await packItem.click();
      await page.waitForTimeout(700);
      found = true;
    } else {
      await page.getByRole("button", { name: "Close" }).first().click();
      await page.waitForTimeout(400);
    }
  }
  test.skip(!found, "no pack-chain item priced in this tenant");

  // Order ONE base unit, whatever the popup opened in.
  const sizeButtons = page.locator("[role=dialog]").filter({ has: page.locator("input") }).last().locator("button").filter({ hasText: /^(piece|kg|g|ml|litre|unit)$/ });
  if (await sizeButtons.count()) await sizeButtons.first().click();
  await page.waitForTimeout(300);
  const box = page.locator("[role=dialog]").filter({ has: page.locator("input") }).last().locator("input").first();
  await box.fill("1");
  await page.waitForTimeout(400);

  const addLabel = await page.getByRole("button", { name: /Add to basket/ }).first().innerText();
  console.log("add button says:", addLabel.replace(/\s+/g, " "));
  const priced = addLabel.match(/([\d.]+)/g)?.pop();
  await page.getByRole("button", { name: /Add to basket/ }).first().click();
  await page.waitForTimeout(1600);

  // Reopen it for editing — the step that used to turn 1 into 0.033.
  await page.locator("#mise-basket").click();
  await page.waitForTimeout(900);
  const basketTotal = await page.locator("[role=dialog]").last().innerText();
  console.log("basket shows:", basketTotal.replace(/\s+/g, " ").slice(0, 200));

  const rowName = (await page.locator("#mise-basket").innerText()).trim();
  await page.getByRole("button", { name: /Change how much/ }).first().click();
  await page.waitForTimeout(1200);
  // NOT .last(): the item popup is rendered before the basket in the tree, so
  // "the last dialog" is the basket, which has no quantity box at all.
  const edit = page.locator("[role=dialog]").filter({ has: page.locator("input") }).last();
  const reopened = await edit.locator("input").first().inputValue();
  console.log("(basket badge:", rowName.replace(/\s+/g, " "), ")");
  console.log("edit reopened with:", reopened);
  expect(reopened, "editing 1 piece must reopen as 1, not 0.033").toBe("1");

  const totalNow = await page.getByRole("button", { name: /Add to basket/ }).first().innerText();
  console.log("after reopen:", totalNow.replace(/\s+/g, " "));
  expect(totalNow.replace(/\s+/g, " ")).toContain(priced ?? "");

  // Swap to the pack size and back — the amount must not move.
  const packBtn = edit.locator("button").filter({ hasText: /^(bottle|box|case|pack)$/ }).first();
  if (await packBtn.count()) {
    await packBtn.click();
    await page.waitForTimeout(400);
    const afterSwap = await page.getByRole("button", { name: /Add to basket/ }).first().innerText();
    console.log("swapped to pack :", afterSwap.replace(/\s+/g, " "));
    expect(afterSwap.replace(/\s+/g, " "), "swapping the unit must not change the order").toContain(priced ?? "");

    const baseBtn = edit.locator("button").filter({ hasText: /^(piece|kg|g|ml|litre|unit)$/ }).first();
    await baseBtn.click();
    await page.waitForTimeout(400);
    const back = await edit.locator("input").first().inputValue();
    console.log("swapped back   :", back);
    expect(back, "coming back to the base unit must read 1 again").toBe("1");
  }
});
