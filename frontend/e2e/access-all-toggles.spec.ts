import { expect, test } from "@playwright/test";

// 🔐 EVERY PAGE, READ AND WRITE — seen, not assumed.
//
//   "for manager we have only expense can change option and can see option...
//    bro we need literally ALL the pages access with read and write that super
//    admin can choose to give. Give all toggles please."
//
// The failure was an ABSENCE: areas outside the job's envelope were not drawn
// at all, so there was nothing to assert against and nothing to see. A test
// that counts what IS there is the only kind that catches that.

const BASE = "https://nirai1.dineai.cloud";
const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";

test.setTimeout(240_000);

async function signIn(page: import("@playwright/test").Page) {
  // The login form renders twice (mobile + desktop copies), so every selector
  // must be :visible or it fills the hidden one and waits forever.
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill(EMAIL);
  await page.locator("#li-password:visible").first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
}

test("a manager's sheet offers every section, not just the usual ones", async ({ page }) => {
  await signIn(page);
  await page.goto(`${BASE}/staff`);
  await page.getByText(/manager|chef|staff/i).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "e2e/__screens__/access-staff-list.png", fullPage: true });

  // It is a board of JOB cards ("Manager - runs the venue day to day"), and you
  // open one by clicking the card itself, not a button on it.
  await page.getByText("Manager", { exact: false }).first().click();
  // The three-way control is the thing being counted; wait for a real one.
  await page.getByText(/No access|Can see|Can change/).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "e2e/__screens__/access-sheet.png", fullPage: true });

  // Walk every section and count what is actually drawn. The whole failure was
  // an ABSENCE, so the assertion has to be "how many controls are here".
  // Scoped to the SHEET. The sidebar behind it also has a "Money" and a
  // "Kitchen", so an unscoped click waits forever on the wrong element.
  const sheet = page.getByRole("dialog").last();
  const tabs = ["Money", "Stock & buying", "People", "Their own", "Kitchen"];
  let total = 0;
  for (const tab of tabs) {
    await sheet.getByRole("button", { name: new RegExp(tab, "i") }).first().click();
    await page.waitForTimeout(700);
    const n = await sheet.getByText(/^No access$/).count();
    total += n;
    expect(n, `${tab} drew no controls at all`).toBeGreaterThan(0);
    if (tab === "People") {
      await page.screenshot({ path: "e2e/__screens__/access-sheet-people.png", fullPage: true });
    }
  }
  // 17 areas, every one of them switchable.
  expect(total).toBe(17);

  const text = await page.locator("body").innerText();
  expect(text).not.toContain("Something went wrong");
  // The old sheet said this instead of drawing the controls.
  expect(text).not.toMatch(/never reaches .* so there is nothing here to switch on/i);
});

test("what a job does not normally do is marked, not hidden", async ({ page }) => {
  // The Till reaches 2 of 17 areas, so almost everything on its sheet is
  // outside the job's usual set. That is exactly the case that used to render
  // as an empty section with "a Till never reaches Money" and no controls.
  await signIn(page);
  await page.goto(`${BASE}/staff`);
  await page.getByText("Till", { exact: false }).first().waitFor({ timeout: 60_000 });
  await page.getByText("Till", { exact: false }).first().click();

  const sheet = page.getByRole("dialog").last();
  await sheet.getByText(/^No access$/).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "e2e/__screens__/access-sheet-unusual.png", fullPage: true });

  const text = await sheet.innerText();
  expect(text).toMatch(/unusual/i);
  expect(text).toMatch(/you can still switch them on/i);
  // The controls are THERE, which is the whole point.
  expect(await sheet.getByText(/^No access$/).count()).toBeGreaterThan(0);
});
