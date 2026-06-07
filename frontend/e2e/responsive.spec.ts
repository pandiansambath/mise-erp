import { expect, test, type Page } from "@playwright/test";

const EMAIL = "owner@nirai.com";
const PASSWORD = "StrongPass123!";

/** Assert the page has no horizontal scroll (the #1 responsive bug). */
async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, "page must not scroll horizontally").toBeLessThanOrEqual(2);
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

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
  await expect(page.getByText("Profit & Loss")).toBeVisible();
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
