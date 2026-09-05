// Three suppliers, three different boxes. What does inventory dare to claim?
import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(1800);
}

test("inventory stops claiming one box size when suppliers disagree", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/inventory");
  await page.waitForTimeout(3500);

  await page.getByPlaceholder(/search|find/i).first().fill("guava").catch(() => {});
  await page.waitForTimeout(1500);
  const card = page.getByRole("button").filter({ hasText: /avg/ }).filter({ visible: true }).first();
  await card.click();
  await page.waitForTimeout(3000);

  const body = await page.locator("body").innerText();
  const flat = body.replace(/\n/g, " | ");

  // Every claim about a box size, in context. "their 1 box = 50 kg" on Exotic's
  // delivery is TRUE — their box really is 50. Only an UNQUALIFIED claim, the
  // kind that speaks for all suppliers at once, is the bug he reported.
  const claims = [...flat.matchAll(/.{0,60}1 box = \d+ kg/gi)].map((m) => m[0].trim());
  for (const c of claims) console.log("  claim >>>", c);

  const unqualified = claims.filter((c) => !/their/i.test(c));
  console.log("unqualified claims:", JSON.stringify(unqualified));

  const saysDiffer = /packs differ by supplier/i.test(body);
  const note = body.match(/a box is[^\n]{0,200}/i);
  console.log("says 'packs differ by supplier':", saysDiffer);
  if (note) console.log("the note:", note[0]);

  const rudra = flat.match(/RUDRA EXIM LTD.{0,90}/);
  console.log("RUDRA EXIM LTD row:", rudra ? rudra[0] : "(not found)");

  expect(
    unqualified,
    "something still states one box size on behalf of every supplier",
  ).toHaveLength(0);
  expect(saysDiffer, "never said the packs differ").toBeTruthy();
  expect(/500 kg/.test(body), "the 500 kg box is still missing").toBeTruthy();
});
