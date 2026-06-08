import { expect, test, type Page } from "@playwright/test";

const EMAIL = "owner@nirai.com";
const PASSWORD = "StrongPass123!";

/** Assert the page has no horizontal scroll (the #1 responsive bug). */
async function assertNoHorizontalOverflow(page: Page) {
  // Use "load" not "networkidle": the live SSE connection is long-lived, so
  // networkidle would never settle. Tests already wait for page content, and
  // the poll below absorbs late renders.
  await page.waitForLoadState("load");
  // Wait for webfonts so text metrics are final (fallback fonts are wider and
  // can briefly overflow under load until Geist loads).
  await page.evaluate(() => document.fonts.ready);
  // Poll the measurement so a transient render/layout blip settles before we
  // judge it, while a *persistent* real overflow still fails (stays > 2 for 4s).
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        ),
      { message: "page must not scroll horizontally", timeout: 8000 }
    )
    .toBeLessThanOrEqual(2);
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

test("landing page renders and fits the viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /symphony/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("signup page renders and fits the viewport", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Register your hotel" })).toBeVisible();
  await expect(page.getByLabel("Restaurant name")).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("login page renders and fits the viewport", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Mise" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("user can log in and see the dashboard", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Quick actions" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("price comparison page fits the viewport", async ({ page }) => {
  await login(page);
  await page.goto("/price-comparison");
  await expect(page.getByRole("heading", { name: "Price Comparison" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("inventory page fits the viewport", async ({ page }) => {
  await login(page);
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("recipes page fits the viewport", async ({ page }) => {
  await login(page);
  await page.goto("/recipes");
  await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("reports P&L page fits the viewport", async ({ page }) => {
  await login(page);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  // Wait for loaded content (the P&L card heading) — use role to avoid matching
  // the page subtitle, which also contains "Profit & Loss".
  await expect(page.getByRole("heading", { name: "Profit & Loss" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("sales page fits the viewport", async ({ page }) => {
  await login(page);
  await page.goto("/sales");
  await expect(page.getByRole("heading", { name: "Sales & Cash" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("expenses page fits the viewport", async ({ page }) => {
  await login(page);
  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("employees page fits the viewport", async ({ page }) => {
  await login(page);
  await page.goto("/employees");
  await expect(page.getByRole("heading", { name: "Employees" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("attendance page fits the viewport", async ({ page }) => {
  await login(page);
  await page.goto("/attendance");
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("payroll page fits the viewport", async ({ page }) => {
  await login(page);
  await page.goto("/payroll");
  await expect(page.getByRole("heading", { name: "Payroll" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("purchasing page fits the viewport", async ({ page }) => {
  await login(page);
  await page.goto("/purchasing");
  await expect(page.getByRole("heading", { name: "Purchasing" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("confirmation dialog gates a destructive action", async ({ page }) => {
  // Use a unique future date per viewport so parallel workers don't share rows.
  const byProject: Record<string, string> = {
    mobile: "2030-02-01",
    tablet: "2030-02-02",
    desktop: "2030-02-03",
  };
  const day = byProject[test.info().project.name] ?? "2030-02-09";

  await login(page);
  await page.goto("/sales");
  await expect(page.getByRole("heading", { name: "Sales & Cash" })).toBeVisible();
  await page.locator('input[type="date"]').first().fill(day);

  // Add a sales line.
  await page.getByPlaceholder("0.00").fill("100");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const removeBtn = page.getByRole("button", { name: "Remove", exact: true });
  await expect(removeBtn).toBeVisible();

  // Clicking Remove opens a confirmation dialog; Cancel keeps the line.
  await removeBtn.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Remove this sales line?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(removeBtn).toBeVisible();

  // Confirming actually removes it.
  await removeBtn.click();
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("No sales entered for this day yet.")).toBeVisible();
});

test("documents page fits the viewport", async ({ page }) => {
  await login(page);
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("staff page: admin can manage the team", async ({ page }) => {
  await login(page);
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: "Staff" })).toBeVisible();
  await expect(page.getByText("Add a team member")).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("navigation adapts: hamburger on mobile, sidebar on desktop", async ({ page }, testInfo) => {
  await login(page);
  const menuButton = page.getByRole("button", { name: "Open menu" });
  // Persistent sidebar appears at the lg breakpoint (1024px); below that
  // (phones + portrait tablets) we use the hamburger drawer.
  if (testInfo.project.name === "desktop") {
    await expect(menuButton).toBeHidden();
    await expect(page.getByRole("link", { name: "Price Comparison" })).toBeVisible();
  } else {
    await expect(menuButton).toBeVisible();
  }
});
