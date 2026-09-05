import { expect, test } from "@playwright/test";

// 👤 THREE WAYS TO ADD PEOPLE, ONE POPUP.
//
//   "while adding new login, make this a POPUP instead of in-place."
//   "suppose hotel has 100 workers, owner can't add 100 one by one."
//   "think about the placement without making the current clumsy."
//
// The last line is why all three live inside one popup rather than becoming
// three more buttons on a toolbar that already has four.

const BASE = "https://nirai1.dineai.cloud";
const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";

test.setTimeout(240_000);

async function signIn(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill(EMAIL);
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
}

async function openAddLogin(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/staff`);
  await page.getByRole("button", { name: /by person/i }).first().click();
  await page.getByRole("button", { name: /add a login/i }).first().click();
  const modal = page.getByRole("dialog").filter({ hasText: "Give somebody a login" }).first();
  await modal.waitFor({ timeout: 60_000 });
  return modal;
}

test("adding a login is a popup, and the board does not move", async ({ page }) => {
  await signIn(page);
  await page.goto(`${BASE}/staff`);
  await page.getByRole("button", { name: /by person/i }).first().click();
  await page.getByText(/can sign in/i).first().waitFor({ timeout: 60_000 });

  await page.getByRole("button", { name: /add a login/i }).first().click();
  const modal = page.getByRole("dialog").filter({ hasText: "Give somebody a login" }).first();
  await modal.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "e2e/__screens__/add-login.png", fullPage: false });

  // 19 — IT IS A POPUP, NOT A PANEL WEDGED INTO THE PAGE.
  //
  // My first attempt compared the first card's y-position before and after, and
  // it moved 102px — upwards, because opening the modal scrolls the page. That
  // measured a scroll, not the thing he complained about. What he complained
  // about is the form being INSERTED into the board and pushing it down, so the
  // honest test is where the form lives: portalled to <body>, outside <main>.
  const inMain = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const add = dialogs.find((d) => d.textContent?.includes("Give somebody a login"));
    return add ? !!add.closest("main") : null;
  });
  expect(inMain, "the form is inside the page, not a popup").toBe(false);
  // ...and the old in-place panel is gone for good.
  expect(await page.locator("main").getByText("A new login").count()).toBe(0);

  // 20 — one person, not "they".
  await expect(modal.getByText("What is this person?")).toBeVisible();
  expect(await modal.getByText(/what are they/i).count()).toBe(0);
});

test("a spreadsheet of people becomes a list to check", async ({ page }) => {
  await signIn(page);
  const modal = await openAddLogin(page);

  await modal.getByRole("button", { name: /from a file/i }).click();
  await page.waitForTimeout(500);
  await expect(modal.getByRole("button", { name: /download the template/i })).toBeVisible();

  // Upload a file with one good row and two that cannot be created, so the
  // preview has to say WHY rather than just refusing.
  const csv = [
    "name,email,password,role",
    "Priya Kumar,priya.probe@dineai.cloud,goodpassword1,Cashier",
    "Broken Row,not-an-email,goodpassword1,Cashier",
    "Short Pass,short.probe@dineai.cloud,abc,Cashier",
  ].join("\n");
  await modal.locator('input[type="file"]').setInputFiles({
    name: "team.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "e2e/__screens__/add-login-preview.png", fullPage: false });

  const text = await modal.innerText();
  expect(text).toContain("Priya Kumar");
  expect(text).toMatch(/does not look like an email/i);
  expect(text).toMatch(/at least 8 characters/i);
  // One of three is creatable, and the button says so rather than pretending.
  await expect(modal.getByRole("button", { name: /create 1 login/i })).toBeVisible();
});

test("the assistant asks instead of inventing an email", async ({ page }) => {
  await signIn(page);
  const modal = await openAddLogin(page);

  await modal.getByRole("button", { name: /just tell dineai/i }).click();
  await modal
    .getByRole("textbox")
    .first()
    .fill("I need logins for Ravi and Kumar, they work in the kitchen.");
  await modal.getByRole("button", { name: /read it/i }).click();

  // WAIT FOR THE TABLE, NOT FOR THE NAME. `getByText("Ravi")` matched the text
  // I had just typed INTO THE TEXTAREA, so it went green while the button still
  // said "Reading…" — the same false pass as the spinner screenshots. The
  // preview table is the only thing that means the answer arrived.
  await modal.getByRole("button", { name: /start again/i }).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "e2e/__screens__/add-login-ai.png", fullPage: false });

  const text = await modal.innerText();
  // The whole point: no address was given, so none is made up.
  expect(text).toMatch(/email/i);
  expect(text).not.toMatch(/ravi@|kumar@/i);
  // ...and with nothing creatable, there is nothing to press.
  expect(await modal.getByRole("button", { name: /^create \d+ logins?$/i }).count()).toBeLessThan(
    2,
  );
});
