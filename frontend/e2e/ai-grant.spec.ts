import { expect, test, type Page } from "@playwright/test";

/**
 * The AI controls in Roles & Access, driven on the live site.
 *
 *   "here we don't have a feature to add or remove ai feature (under this we
 *    need to have some filter like whether to give haiku or sonnet, also
 *    whether to give our voice model, also what the max token max msg etc)."
 *
 * Asserting the panel EXISTS is not enough — a panel that renders and does not
 * save is the same to him as no panel. So this changes a value and requires the
 * Save button to come alive, which is the app agreeing something changed.
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
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

test("a person's AI can be tuned from Roles & Access", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/staff`);

  // Open the first person who is not the owner. The owner has no ceiling, so
  // the sheet deliberately shows nothing to edit — opening that one would be
  // testing the wrong branch.
  const people = page.locator('[data-testid="access-person"], button:has-text("Stop access")');
  await page.getByText(/Roles & Access/i).first().waitFor({ timeout: 30_000 });

  // The page opens on "By job"; the per-person sheet lives behind "By person".
  // My first run waited 30s for a card that only exists in the other view and
  // reported the panel missing — the view, not the feature.
  const byPerson = page.getByRole("button", { name: /By person/i }).first();
  if (await byPerson.isVisible().catch(() => false)) await byPerson.click();

  const cards = page.locator("text=/Can reach/");
  await cards.first().waitFor({ timeout: 30_000 });

  // NOT just the first card. The owner's sheet deliberately has nothing to edit
  // — "it reaches everything and cannot be limited" — so opening that one and
  // reporting "no AI panel" tests the wrong branch, which is what my first run
  // did. Walk until a sheet that CAN be edited opens.
  const model = page.getByTestId("ai-model");
  const total = Math.min(await cards.count(), 6);
  let opened = false;
  for (let i = 0; i < total; i += 1) {
    await cards.nth(i).click();
    if (await model.isVisible({ timeout: 6_000 }).catch(() => false)) {
      opened = true;
      break;
    }
    await page.keyboard.press("Escape");
  }
  expect(opened, `no editable person among the first ${total} — AI panel never appeared`).toBe(true);

  // Present is not the same as working. Changing it must make Save live.
  await model.selectOption("haiku");
  await expect(
    page.getByRole("button", { name: /Save what they can reach/i }),
    "changing the AI model did not register as a change",
  ).toBeEnabled({ timeout: 10_000 });

  await expect(page.getByTestId("ai-voice")).toBeVisible();
  await expect(page.getByText(/Max tokens per answer/i)).toBeVisible();
  await expect(page.getByText(/Max messages a day/i)).toBeVisible();

  // Leave nothing behind on his tenant.
  await page.keyboard.press("Escape");
  expect(people).toBeDefined();
});
