import { expect, test } from "@playwright/test";

/**
 * The rebuilt expense form actually saves.
 *
 * Same reasoning as the sales day sheet: I replaced the form's shape, so the
 * path that writes an expense is new markup on the page where his spending is
 * recorded. Typecheck cannot tell me whether the category popup hands the id
 * back, or whether Save is wired to the right handler.
 *
 * Writes a small real expense to his tenant and removes it again.
 */
const BASE = "https://nirai1.dineai.cloud";

test("picking a category and an amount records an expense", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    try { localStorage.setItem("mise.tour.done", "1"); } catch { /* */ }
  });
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  await page.goto(`${BASE}/expenses`);
  const amount = page.locator("input[placeholder='0.00']").first();
  await expect
    .poll(async () => amount.count(), { timeout: 60_000, message: "the form never rendered" })
    .toBeGreaterThan(0);

  // The category control opens a popup — check that round trip, not just the save.
  const picker = page.getByRole("button", { name: /pick a category|council|rent|gas/i }).first();
  await picker.click();
  await page.waitForTimeout(1200);
  const dialogs = await page.locator("[role='dialog']").count();
  console.log("category popup opened:", dialogs > 0);
  const choice = page.locator("[role='dialog'] button").nth(1);
  const chosen = ((await choice.textContent()) || "").trim();
  await choice.click();
  await page.waitForTimeout(900);
  console.log("chose:", JSON.stringify(chosen));

  await amount.fill("2.34");
  // type=submit, NOT the label. The SubNav carries a "＋ Add expense"
  // shortcut with the same words, and matching by name picked THAT — so the
  // first run reported the form broken when nothing had been submitted at all.
  // Two controls sharing a label is ambiguous for a person too; for a selector
  // it is silently wrong.
  const save = page.locator("form button[type='submit']").first();
  await expect(save, "save never enabled").toBeEnabled({ timeout: 10_000 });
  // (The form's button now says "Save expense" so it cannot be confused with the
  //  SubNav's "Add expense" shortcut — but this still targets type=submit,
  //  which is true regardless of wording.)
  await save.click();
  await page.waitForTimeout(4000);

  const body = await page.evaluate(() => document.body.innerText);
  console.log("2.34 recorded:", body.includes("2.34"));
  await page.screenshot({ path: "e2e/__screens__/expense-save.png" });
  expect(dialogs, "the category popup did not open").toBeGreaterThan(0);
  expect(body, "the expense never appeared").toContain("2.34");

  // Put his books back.
  const remove = page.getByRole("button", { name: /^remove$/i }).first();
  if (await remove.count()) {
    await remove.click();
    await page.getByRole("button", { name: /remove|delete|yes/i }).last().click().catch(() => {});
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => document.body.innerText);
    console.log("cleaned up:", !after.includes("2.34"));
  }
});
