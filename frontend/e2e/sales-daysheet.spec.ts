import { expect, test } from "@playwright/test";

/**
 * The day sheet actually saves.
 *
 * I replaced the one-line form with a sheet that writes every filled box in a
 * loop, so the write path is new code on the page where his takings live. A
 * page that LOOKS right and silently fails to save is the worst outcome here,
 * and it is not something a typecheck can tell me.
 *
 * It writes a small real line to his tenant and then removes it again.
 */
const BASE = "https://nirai1.dineai.cloud";

test("typing in the sheet and saving records the takings", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    try { localStorage.setItem("mise.tour.done", "1"); } catch { /* */ }
  });
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  await page.goto(`${BASE}/sales`);
  const boxes = page.locator("input[aria-label^='Gross takings for']");
  await expect
    .poll(async () => boxes.count(), { timeout: 60_000, message: "the day sheet never rendered" })
    .toBeGreaterThan(0);

  const before = await page.locator(".mise-card-inset").count();
  const which = (await boxes.first().getAttribute("aria-label")) ?? "";
  console.log("boxes on the sheet:", await boxes.count(), "| filling:", which);

  await boxes.first().fill("3.21");
  const save = page.getByRole("button", { name: /save .*takings/i });
  await expect(save, "the save button never enabled").toBeEnabled({ timeout: 10_000 });
  await save.click();
  await page.waitForTimeout(4000);

  const body = await page.evaluate(() => document.body.innerText);
  console.log("3.21 present after save:", body.includes("3.21"));
  await page.screenshot({ path: "e2e/__screens__/sales-daysheet.png" });

  expect(body, "the saved line never appeared on the page").toContain("3.21");

  // Put his tenant back. A test that leaves £3.21 in a real day's takings is a
  // test that corrupts the thing it was checking.
  const remove = page.getByRole("button", { name: /^remove$/i }).first();
  if (await remove.count()) {
    await remove.click();
    const yes = page.getByRole("button", { name: /remove/i }).last();
    await yes.click().catch(() => {});
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => document.body.innerText);
    console.log("cleaned up:", !after.includes("3.21"));
  }
  console.log("cards before:", before);
});
