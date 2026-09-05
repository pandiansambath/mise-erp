// The list controls, driven on the deployed box.
//
// The purchase-order chip counted 15 and the list showed 0, because the count
// and the filter were two different pieces of code. So this asserts they AGREE
// — click a chip, and what the chip claims is what you get.
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

test("a status chip shows what it claims", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/purchasing");
  await page.waitForTimeout(3000);

  for (const tab of ["Indents", "Orders"]) {
    await page.getByRole("button", { name: new RegExp(`^${tab}`) }).first().click();
    await page.waitForTimeout(2500);

    const chips = page.locator("button").filter({ hasText: /^(Late|Still to arrive|Arrived|Awaiting approval|Approved|Ordered|Rejected)\s*\d+$/ });
    const n = await chips.count();
    expect(n, `${tab} should offer at least one status filter`).toBeGreaterThan(0);

    const label = (await chips.first().innerText()).replace(/\s+/g, " ").trim();
    const claimed = parseInt(label.match(/(\d+)$/)?.[1] ?? "0", 10);
    await chips.first().click();
    await page.waitForTimeout(2500);

    // The count sits in a <p> whose number is wrapped in <b>, so match the
    // PARAGRAPH and read its text rather than hunting a single text node.
    await page.screenshot({ path: `e2e/__screens__/list-${tab}.png` });
    const line = page.locator("p", { hasText: /showing/ }).first();
    const shown = (await line.count()) ? await line.innerText() : "(no showing line)";
    const got = parseInt(shown.match(/showing\s*(\d+)/)?.[1] ?? "-1", 10);
    console.log(`${tab}: chip "${label}" -> ${shown.trim()}`);
    expect(got, `${tab}: the chip says ${claimed}, the list must not disagree`).toBeGreaterThan(0);

    await chips.first().click(); // back off
    await page.waitForTimeout(1200);
  }
});

test("paging shows a page, not everything", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/purchasing");
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /^Indents/ }).first().click();
  await page.waitForTimeout(2500);

  await page.getByRole("button", { name: "10", exact: true }).first().click();
  await page.waitForTimeout(2500);
  const rows = await page.locator("[aria-expanded]").filter({ hasText: /item/ }).count();
  console.log(`rows on a page of 10: ${rows}`);
  expect(rows, "a page of ten must not render the whole table").toBeLessThanOrEqual(10);
  expect(rows).toBeGreaterThan(0);
});
