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
  await page.locator('[data-testid="login-email"]:visible').first().fill(EMAIL);
  await page.locator('[data-testid="login-password"]:visible').first().fill(PASSWORD);
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

test("nothing inside the popup scrolls", async ({ page }) => {
  // MEASURED, NOT EYEBALLED.
  //
  //   "I need to scroll over cards to reach the 3rd or 4th card. Just 4 cards
  //    we having, even for this also we need to scroll?"
  //
  // A screenshot cannot tell you whether a pane scrolls — it looks identical
  // either way until you try. scrollHeight vs clientHeight can, so the test
  // asks the browser instead of asking me.
  await signIn(page);
  await page.goto(`${BASE}/staff`);
  await page.getByText(/Chef \/ kitchen/i).first().waitFor({ timeout: 60_000 });
  await page.getByText("Manager", { exact: false }).first().click();

  const sheet = page.getByRole("dialog").last();
  await sheet.getByText(/^No access$/).first().waitFor({ timeout: 60_000 });

  for (const group of ["Money", "Stock & buying", "People", "Their own", "Kitchen"]) {
    await sheet.getByText(group, { exact: true }).first().click();
    await page.waitForTimeout(400);

    const overflowing = await sheet.evaluate((el) => {
      const bad: string[] = [];
      el.querySelectorAll("*").forEach((n) => {
        const e = n as HTMLElement;
        // 2px of slack for sub-pixel rounding
        if (e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 40) {
          const style = getComputedStyle(e);
          if (style.overflowY === "auto" || style.overflowY === "scroll") {
            bad.push(`${e.className}`.slice(0, 60));
          }
        }
      });
      return bad;
    });

    expect(overflowing, `${group} has a scrolling pane`).toEqual([]);
  }

  await page.screenshot({ path: "e2e/__screens__/noscroll-kitchen.png", fullPage: true });
});

test("the toolbar actually moves right when the rail condenses", async ({ page }) => {
  // 4.3, MEASURED — and measured on the thing that actually scrolls.
  //
  // Two earlier readings of "32 -> 32" were both worthless: the first scrolled
  // the sidebar (Playwright's mouse starts at 0,0, which is over it), and the
  // second ran at a viewport where the page FITS, so nothing scrolled and the
  // rail was never asked to condense. The scroller is `main.lg:overflow-y-auto`,
  // and it only has anything to scroll when the content is taller than it.
  await signIn(page);
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.goto(`${BASE}/staff`);
  await page.getByRole("button", { name: /by person/i }).first().click();
  await page.waitForTimeout(2000);

  const rail = page.locator(".mise-bench-rail").first();
  // Measure the FIRST BUTTON, not the row's box. The box already spans the
  // rail, which is exactly why four attempts at translating it did nothing —
  // its left edge is fixed whatever you do. Where the buttons START is the
  // thing he can actually see move.
  const firstButtonLeft = () =>
    page.evaluate(() => {
      const row = document.querySelector(".mise-bench-tools")!;
      const b = row.querySelector("button")!.getBoundingClientRect();
      const r = document.querySelector(".mise-bench-rail")!.getBoundingClientRect();
      return Math.round(b.left - r.left);
    });

  // ESTABLISH THE STARTING STATE. Run on its own this passed; run after the
  // other specs it compared 592 to 592, because the rail was ALREADY condensed
  // when the "before" reading was taken. A measurement is only a comparison if
  // you know where you started.
  await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  });
  await page.waitForTimeout(900);
  expect(await rail.getAttribute("data-condensed"), "did not start expanded").not.toBe("true");
  const before = await firstButtonLeft();

  await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 600;
  });

  // WAIT FOR THE STATE, NOT FOR A DURATION. A fixed 1500ms wait passed until
  // the transition slowed from 280ms to 420ms and then started racing it —
  // which reads as "the rail never condensed" when the rail was condensing
  // perfectly well, just not by the time I looked.
  await expect
    .poll(async () => rail.getAttribute("data-condensed"), { timeout: 20_000 })
    .toBe("true");
  await page.waitForTimeout(700); // let the move finish before measuring it
  const after = await firstButtonLeft();
  await page.screenshot({ path: "e2e/__screens__/toolbar-condensed.png" });

  // Condensed, the row gives up the search box's stretch and slides right, so
  // the gap to the rail's right edge shrinks towards nothing.
  expect(
    after,
    `the buttons did not move right (first button at ${before}px -> ${after}px from the rail's left edge)`,
  ).toBeGreaterThan(before + 40);

  // ...and they are not sitting ON the rail's bottom edge. "that button is
  // placed very edge to below card" — the row was dragged onto the border by a
  // -0.7rem margin, so it touched whatever scrolled underneath.
  const floor = await page.evaluate(() => {
    const b = document
      .querySelector(".mise-bench-tools")!
      .querySelector("button")!
      .getBoundingClientRect();
    const r = document.querySelector(".mise-bench-rail")!.getBoundingClientRect();
    return Math.round(r.bottom - b.bottom);
  });
  expect(floor, `only ${floor}px between the buttons and the rail's edge`).toBeGreaterThan(4);

  // ...and they sit ON THE TITLE'S LINE.
  //
  //   "can you see that word heading — ROLES & ACCESS? Why can't you keep this
  //    as a measurement and keep our buttons straight to that, so they will be
  //    in a straight line when in shrink mode."
  //
  // He is describing the measurement I should have taken from the start. It was
  // 43px out: the buttons had their own row below the heading.
  const drift = await page.evaluate(() => {
    const t = document.querySelector(".mise-bench-title")!.getBoundingClientRect();
    const b = document
      .querySelector(".mise-bench-tools")!
      .querySelector("button")!
      .getBoundingClientRect();
    return Math.round(b.top + b.height / 2 - (t.top + t.height / 2));
  });
  expect(
    Math.abs(drift),
    `buttons are ${drift}px off the heading's line`,
  ).toBeLessThanOrEqual(10);
});
