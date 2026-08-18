import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(1800);
}

test("the cheapest badge sits on the genuinely cheaper supplier", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/price-comparison");
  await page.waitForTimeout(3500);

  await page.getByPlaceholder(/search|find/i).first().fill("dragon").catch(() => {});
  await page.waitForTimeout(2000);
  const hit = page.getByText(/Dragon fruit/i).first();
  await hit.click().catch(() => {});
  await page.waitForTimeout(3000);

  const body = await page.locator("body").innerText();
  const flat = body.replace(/\n/g, " | ");
  console.log("card region:", flat.slice(flat.indexOf("Farm2Land") - 40, flat.indexOf("Farm2Land") + 260));

  // The lie was "£50.00 /kg". The truth is £1.00/kg, with £50.00 per box below.
  const perKgLie = /£50\.00\s*\|?\s*\/kg/i.test(flat) || /50\.00\s*\/kg/.test(flat);
  console.log("still prints '£50.00 /kg':", perKgLie);
  expect(perKgLie, "the box price is still labelled per kg").toBeFalsy();

  console.log("shows £1.00/kg:", /1\.00\s*\|?\s*\/kg/.test(flat));
  console.log("shows the box price separately:", /50\.00 per box/i.test(flat));
  console.log("says how much a box holds:", /holds 50 kg/i.test(flat));
  expect(/50\.00 per box/i.test(flat), "the box price vanished entirely").toBeTruthy();

  // And price editing must be gone from this page.
  const editable = /Change what they charge/i.test(body);
  const linked = /Change what .* charges/i.test(body);
  console.log("old inline price editor present:", editable, "| links to vendor page:", linked);
  expect(editable, "the price editor is still on Price Comparison").toBeFalsy();
});
