import { expect, test } from "@playwright/test";

// ✨ A ROLE THE HOTEL INVENTED.
//
//   "may be paratha manager, poori manager... anything. In runtime we need to
//    create a new role and give RBAC in runtime."
//
// The last attempt at this died quietly: designing a role and handing it to
// somebody lived on different screens, and the only role this hotel ever
// designed was attached to nobody. So the test walks the whole thing — name
// it, set what it reaches, save, see it on the board — because any step that
// only half works looks fine from the step before it.

const BASE = "https://nirai1.dineai.cloud";
const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";

test.setTimeout(240_000);

async function signIn(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible').first().fill(EMAIL);
  await page.locator('[data-testid="login-password"]:visible').first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
}

test("invent a Poori Master and give it what it needs", async ({ page }) => {
  // A fresh name each run, so a leftover role from a previous run cannot make
  // this pass without creating anything.
  const roleName = `Poori Master ${Date.now().toString().slice(-5)}`;

  await signIn(page);
  await page.goto(`${BASE}/staff`);
  await page.getByRole("button", { name: /create a role/i }).waitFor({ timeout: 60_000 });
  await page.screenshot({ path: "e2e/__screens__/role-board.png", fullPage: true });

  await page.getByRole("button", { name: /create a role/i }).click();

  const sheet = page.getByRole("dialog").last();
  await sheet.getByPlaceholder(/poori master/i).waitFor({ timeout: 30_000 });
  await sheet.getByPlaceholder(/poori master/i).fill(roleName);

  // Give it the kitchen: this is the point of a bespoke role.
  // The starting-point dropdown is gone: a new role begins blank, so nothing
  // is on until it is switched on here.
  expect(await sheet.getByText(/start from/i).count()).toBe(0);

  // It is a popup with a master rail now — every group is one click away and
  // neither pane scrolls, so the test navigates it the way a person would.
  for (const group of ["Money", "Stock & buying", "People", "Their own", "Kitchen"]) {
    await expect(sheet.getByText(group, { exact: true }).first()).toBeVisible();
  }

  // One bulk row for the whole app, not two identical ones stacked.
  expect(await sheet.getByText(/every page in dineai:/i).count()).toBe(1);

  await sheet.getByText("Kitchen", { exact: true }).first().click();
  await page.waitForTimeout(600);

  // The assistant is permission to ASK IT THINGS, not to change anything.
  const ai = sheet.locator("li").filter({ hasText: "The assistant" }).first();
  await expect(ai.getByText("Can use")).toBeVisible();
  expect(await ai.getByText("Can change").count()).toBe(0);

  const recipes = sheet.locator("li").filter({ hasText: "Recipes & dishes" }).first();
  await recipes.getByText("Can change").click();
  // Single switches ask now too — moving somebody from one level to another is
  // a decision about a person, so it is confirmed the way a person would.
  await page.getByRole("button", { name: /^set to "can change"$/i }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e/__screens__/role-builder.png", fullPage: true });

  await sheet.getByRole("button", { name: /create this role/i }).click();
  // Saving asks first — nothing about somebody's access changes on a stray tap.
  await page.getByRole("button", { name: /save it/i }).first().click();

  // It has to come back on the BOARD — a role that saves but never appears is
  // the saved-draft failure all over again.
  await page.getByText(roleName).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "e2e/__screens__/role-created.png", fullPage: true });

  const text = await page.locator("body").innerText();
  expect(text).toContain(roleName);
  expect(text).not.toContain("Something went wrong");
});
