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
    // The popup is master/detail now: the rail item carries its own live
    // count in the same button, so match the text, not the whole name.
    await sheet.getByText(tab, { exact: true }).first().click();
    await page.waitForTimeout(600);
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

test("a job that reaches almost nothing can still be given anything", async ({ page }) => {
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

  // The controls are THERE, which is the whole point — the Till reaches 2 of
  // 17 and every one of the other 15 is still switchable rather than absent.
  expect(await sheet.getByText(/^No access$/).count()).toBe(4);

  // AND each of them offers the middle. Expenses was "No access / Can change"
  // with no way to say "let him look at the bills without adding any", because
  // `expenses:read` was not a grantable permission — only implied by the write.
  // Match the LABEL. The popup row shows each screen as its own tick where the
  // one-line blurb used to be, so filtering on the blurb finds nothing.
  const expenses = sheet.locator("li").filter({ hasText: "Expenses" }).first();
  await expect(expenses.getByText("No access")).toBeVisible();
  await expect(expenses.getByText("Can see")).toBeVisible();
  await expect(expenses.getByText("Can change")).toBeVisible();
});

test("the standard job sheet got the same treatment as the others", async ({ page }) => {
  // THE SHEET I MISSED. Clicking "Manager" on the By job board opens JobSheet,
  // a third file that does the same work as RoleBuilder and AccessSheet. I
  // rebuilt those two, screenshotted them, called all seven done — and never
  // opened this one, which is the most obvious thing on the page.
  await signIn(page);
  await page.goto(`${BASE}/staff`);
  await page.getByText("Manager", { exact: false }).first().click();

  const sheet = page.getByRole("dialog").last();
  await sheet.getByText(/^No access$/).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: "e2e/__screens__/jobsheet-manager.png", fullPage: true });

  const text = await sheet.innerText();
  // 6 + 10 — counted in pages he can check against the sidebar, and the unit is
  // NAMED, because "13 of 33" over 17 visible switches read as 16 missing ones.
  expect(text).toMatch(/pages they can open/i);
  expect(text).toMatch(/sit behind the/i);
  expect(text).not.toMatch(/areas of the app/i);
  // 1 + 1b — one consolidated row, at the top.
  expect(await sheet.getByText(/every page in dineai:/i).count()).toBe(1);
  expect(await sheet.getByText(/everything in this group:/i).count()).toBe(0);
  // 8 + 9 — a centred POPUP with master/detail, so every group is reachable in
  // one click and neither pane scrolls. All five sit in the left rail at once
  // with a live count; the one you tap fills the right.
  for (const group of ["Money", "Stock & buying", "People", "Their own", "Kitchen"]) {
    await expect(sheet.getByText(group, { exact: true }).first()).toBeVisible();
  }
  expect(text).toMatch(/\d+ of \d+ on/);

  // Clicking a group swaps the right pane — no scrolling to reach it.
  await sheet.getByText("Kitchen", { exact: true }).first().click();
  await page.waitForTimeout(500);
  await expect(sheet.getByText("Food safety").first()).toBeVisible();
  await expect(sheet.getByText("The assistant").first()).toBeVisible();
});

test("the batch-3 fixes are actually on the page", async ({ page }) => {
  // Every one of these was a thing he pointed at in a screenshot, so each is
  // checked by looking rather than by trusting the diff.
  await signIn(page);
  await page.goto(`${BASE}/staff`);
  await page.getByRole("button", { name: /create a role/i }).waitFor({ timeout: 60_000 });
  // The board fetches users, roles and jobs separately; wait for the real data
  // rather than for the shell, or this screenshots a fading empty page.
  await page.getByText(/Chef \/ kitchen/i).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);

  // 2 — "Create a role" is the FIRST card, not the last.
  const cards = page.locator("main li, main > div li");
  const firstText = await cards.first().innerText();
  expect(firstText).toMatch(/create a role/i);

  await page.screenshot({ path: "e2e/__screens__/batch3-board.png", fullPage: true });

  // 7 — the board cards wear the popup's inset shadow now.
  expect(await page.locator(".mise-card-inset").count()).toBeGreaterThan(0);
  expect(await page.locator("main .mise-card3d").count()).toBe(0);

  // open a job to check the popup itself
  await page.getByText("Manager", { exact: false }).first().click();
  const sheet = page.getByRole("dialog").last();
  await sheet.getByText(/^No access$/).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);

  // 5a — every screen behind a switch is its own tick. Inventory's screens live
  // in Stock & buying, so go there first; the whole point of the rail is that
  // this is one click rather than a scroll.
  await sheet.getByText("Stock & buying").first().click();
  await page.waitForTimeout(600);
  await expect(sheet.getByRole("button", { name: "Stock-take" }).first()).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Waste" }).first()).toBeVisible();

  // 5b — the people count opens into names.
  await sheet.getByRole("button", { name: /people with this job/i }).first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "e2e/__screens__/batch3-people.png", fullPage: true });
  await expect(page.getByRole("dialog").last().getByText(/@/).first()).toBeVisible();
});

test("the owner keeps their whole sidebar", async ({ page }) => {
  // THE ONE I BROKE. The page filter asked `levelOf(area, held)` first, and
  // `levelOf` looks for an area's own permission strings — the owner holds the
  // wildcard and none of those, so every area came back "none" and the sidebar
  // collapsed to three items. The end-to-end test sailed past it because the
  // probe account held real permissions; the only account it broke was the one
  // I was signed in as.
  await signIn(page);
  await page.goto(`${BASE}/staff`);
  await page.getByRole("button", { name: /create a role/i }).waitFor({ timeout: 60_000 });

  const nav = page.locator("nav, aside").first();
  const text = await nav.innerText();
  for (const item of ["Inventory", "Purchasing", "Vendors", "Recipes", "Employees", "Payroll"]) {
    expect(text, `the owner lost ${item} from their own sidebar`).toContain(item);
  }
});
