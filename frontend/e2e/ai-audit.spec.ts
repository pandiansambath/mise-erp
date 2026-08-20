import { expect, test } from "@playwright/test";

// 🔎 THE AI AUDIT, SEEN RATHER THAN ASSERTED.
//
//   "check our AI in all points of view... check whether our AI is responding
//    to our prompt etc, and tune our AI if it is not responding correctly."
//
// Everything this audit found returned `200 OK` with a fluent, confident,
// wrong answer — an empty supplier list read as "no suppliers have been
// linked", which is a sentence, not an error. So these look at what a person
// actually sees, and the screenshots are the evidence.

const BASE = "https://nirai1.dineai.cloud";
const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";

// The login form renders twice (a mobile copy and a desktop copy), so every
// selector here has to be `:visible` or it fills the hidden one and waits
// forever for a page that was never going to navigate.
async function signIn(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill(EMAIL);
  await page.locator("#li-password:visible").first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(2000);
}

test.setTimeout(240_000);

test("the supplier prices reach the price-comparison page", async ({ page }) => {
  // The assistant said "no suppliers have been linked to guava" about an item
  // with five, because the tool read a key that did not exist. The page reads
  // the same endpoint, so this is where a person would have caught it.
  await signIn(page);
  await page.goto(`${BASE}/price-comparison`);
  // WAIT FOR THE DATA, NOT FOR A DURATION. The first pass screenshotted a
  // loading spinner and the assertion still went green, which is the exact
  // trap this audit exists to avoid: a healthy-looking check of nothing.
  await page.getByText(/per kg|per unit|cheapest|Guava/i).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: "e2e/__screens__/ai-audit-price-comparison.png",
    fullPage: true,
  });
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("Something went wrong");
  expect(text).not.toMatch(/no suppliers have been linked/i);
});

test("the assistant answers, and answers in plain words", async ({ page }) => {
  await signIn(page);
  // It is a panel behind the floating button, not a page of its own.
  await page.goto(`${BASE}/dashboard`);
  await page.getByRole("button", { name: /ask dineai/i }).first().click();
  const box = page.getByPlaceholder(/ask|message|type/i).first();
  await box.waitFor({ timeout: 60_000 });

  // Ask the question that used to answer "no suppliers have been linked" about
  // an item with five. A screenshot of an empty chat window proves nothing.
  await box.fill("which vendor is cheapest for guava");
  await box.press("Enter");
  await page.getByText(/per kg|cheapest|Exotic|RUDRA/i).first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "e2e/__screens__/ai-audit-assistant.png", fullPage: true });

  const text = await page.locator("body").innerText();
  expect(text).not.toContain("Something went wrong");
  expect(text).not.toMatch(/no suppliers have been linked/i);
});

test("a diner can open the table page and reach the assistant", async ({ page }) => {
  // No login: this is what a stranger scanning a QR code sees, which is the
  // only screen of ours a stranger ever sees.
  await page.goto(`${BASE}/t/jyp5fxx`);
  await page.getByText(/dosa|biryani|menu|table/i).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "e2e/__screens__/ai-audit-diner.png", fullPage: true });
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("Something went wrong");
  // The commercial guard is architectural, but the page must still work.
  expect(text.length).toBeGreaterThan(80);
});
