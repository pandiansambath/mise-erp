import { expect, test } from "@playwright/test";

// 🔎 "I created a new role called super master, but this is not reflecting."
//
// It existed. It just could not be SEEN in either of the two places you would
// go to use it — the new-login form and the person's own card. A role you
// cannot pick is a role you have to remember to apply afterwards, which is how
// the last attempt at this quietly died.

const BASE = "https://nirai1.dineai.cloud";
const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";

test.setTimeout(240_000);

async function signIn(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill(EMAIL);
  await page.locator("#li-password:visible").first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
}

test("a role you made can be picked when creating a login", async ({ page }) => {
  await signIn(page);
  await page.goto(`${BASE}/staff`);
  // "Add a login" only exists in the By person view — creating a person is a
  // people job, not a jobs-board one.
  await page.getByRole("button", { name: /by person/i }).first().click();
  await page.getByRole("button", { name: /add a login/i }).first().click();
  const modal = page.getByRole("dialog").filter({ hasText: "Give somebody a login" }).first();
  await modal.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "e2e/__screens__/role-in-newlogin.png", fullPage: true });

  // The form is a popup now, and its job picker is a NATIVE select — so the
  // options are in the DOM without opening it. The old version clicked
  // "What are they?" to open a custom Select; both the wording and the control
  // changed underneath this test.
  const picker = modal.locator("select").first();
  const options = await picker.locator("option").allInnerTexts();

  // A role of his own, offered right where the person is created.
  expect(options.join(" | ")).toMatch(/\(yours\)/i);
  // And never the tablet by the door.
  expect(options.join(" | ")).not.toMatch(/kiosk/i);
});

test("a role you made can be given to a person", async ({ page }) => {
  await signIn(page);
  await page.goto(`${BASE}/staff`);
  await page.getByRole("button", { name: /by person/i }).first().click();
  await page.waitForTimeout(1500);

  // Open somebody who is not the owner.
  await page.getByText(/cashier@|manager@|accountant@/i).first().click();
  const sheet = page.getByRole("dialog").last();
  // What somebody IS is one line now — the full chooser was costing a third of
  // the popup and pushing the switches out of reach, so it opens on demand.
  // Exact: the Dashboard note further down also contains "they are".
  await sheet.getByText("They are", { exact: true }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: "e2e/__screens__/role-in-person.png", fullPage: true });

  await sheet.getByRole("button", { name: /^change$/i }).first().click();
  await page.waitForTimeout(700);
  // The picker renders INLINE while the access modal is portalled to <body>,
  // so `.last()` reaches the modal, not the picker. Find it by what it says.
  const picker = page.getByRole("dialog").filter({ hasText: "Roles you made" }).first();
  await picker.waitFor({ timeout: 30_000 });
  const text = await picker.innerText();
  // Both halves of the ONE chooser, in its own popup.
  expect(text).toMatch(/roles you made/i);
  expect(text).toMatch(/or a standard job/i);
  await picker.getByRole("button", { name: "Close" }).first().click();
  await page.waitForTimeout(400);
  // And the bulk control he asked for.
  const sheetText = await sheet.innerText();
  expect(sheetText).toMatch(/give everything/i);
  // The ceiling-era promise is gone.
  expect(sheetText).not.toMatch(/never past what the job should ever reach/i);
});

test("give everything actually gives everything", async ({ page }) => {
  // A control that renders is not a control that works. This one exists to
  // save taps, so the only thing worth asserting is that ONE tap moves the
  // counter to the top.
  await signIn(page);
  await page.goto(`${BASE}/staff`);
  await page.getByRole("button", { name: /create a role/i }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: /create a role/i }).click();

  const sheet = page.getByRole("dialog").last();
  await sheet.getByPlaceholder(/poori master/i).waitFor({ timeout: 30_000 });

  // A new role starts blank. Counted in PAGES now, not in our word "areas" —
  // "why 17? I thought we have more."
  await expect(sheet.getByText("0 of 33")).toBeVisible();

  // The bulk buttons ASK first now — one tap moves every switch on the page and
  // there is no way to tell by looking what it was before. Confirming is part
  // of the flow, so the test does it the way a person would.
  await sheet.getByRole("button", { name: /^give everything$/i }).last().click();
  await page.getByRole("button", { name: /yes, do it/i }).first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: "e2e/__screens__/bulk-give-all.png", fullPage: true });

  await expect(sheet.getByText("33 of 33")).toBeVisible();

  // ...and back down again, so it is not a one-way door.
  await sheet.getByRole("button", { name: /^take it all away$/i }).last().click();
  await page.getByRole("button", { name: /take it away/i }).last().click();
  await page.waitForTimeout(700);
  await expect(sheet.getByText("0 of 33")).toBeVisible();
});
