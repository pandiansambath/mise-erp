import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

// TEMP QA SPEC — not part of the suite, deleted after this run.
// Export the live Inventory CSV, re-import it unmodified, and report the
// exact "already here" summary — must be zero rows that differ. Cancels
// before commit; writes NOTHING.

const DOWNLOAD_DIR = "e2e/__screens__";

test("export CSV then re-import unmodified — summary check", async ({ page }) => {
  const pw = process.env.QA_SUPERADMIN_PW;
  if (!pw) throw new Error("QA_SUPERADMIN_PW env var not set");

  await page.goto("/login");
  await page.getByTestId("login-email").locator("visible=true").fill("superadmin@gmail.com");
  await page.getByTestId("login-password").locator("visible=true").fill(pw);
  await Promise.all([
    page.waitForURL(/\/dashboard|\/setup/, { timeout: 20000 }),
    page.getByRole("button", { name: /^sign in$/i }).locator("visible=true").click(),
  ]);

  await page.goto("/inventory");
  await page.waitForLoadState("networkidle").catch(() => {});

  // Open the "More actions" bench menu and export CSV.
  await page.getByRole("button", { name: "More actions" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByText("Export as CSV", { exact: true }).click(),
  ]);
  const savedPath = path.join(DOWNLOAD_DIR, "inventory-export.csv");
  await download.saveAs(savedPath);
  const csvSize = fs.statSync(savedPath).size;
  console.log("CSV_SAVED=" + savedPath + " bytes=" + csvSize);

  // Re-import that exact file, unmodified.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByText("Import a filled template", { exact: true }).click();
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(savedPath);

  const dialog = page.getByRole("dialog", { name: "Import stock items" });
  await expect(dialog).toBeVisible({ timeout: 20000 });

  // The summary line is the first <p> inside the dialog body.
  const summary = await dialog.locator("p").first().innerText();
  console.log("IMPORT_SUMMARY=" + summary);

  // Any rows still flagged as "already here, and different"?
  const changedSection = dialog.getByText(/Already here, and different/i);
  const hasChangedSection = await changedSection.first().isVisible().catch(() => false);
  console.log("HAS_CHANGED_SECTION=" + hasChangedSection);

  if (hasChangedSection) {
    const rows = dialog.locator("li.mise-well");
    const count = await rows.count();
    console.log("CHANGED_ROW_COUNT=" + count);
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).innerText();
      console.log("CHANGED_ROW[" + i + "]=" + text.replace(/\n/g, " | "));
    }
  }

  await page.screenshot({ path: "e2e/__screens__/qa-import-plan.png", fullPage: true });

  // Cancel — commit nothing.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10000 });

  // Always check the search box for "Aluminium" per the brief — using the
  // page's own search box, never the database.
  await page.getByPlaceholder("Search items…").fill("Aluminium");
  await page.waitForTimeout(600);
  const rowNames = await page.locator("#inventory-list tbody tr td:first-child").allInnerTexts();
  console.log("ALUMINIUM_SEARCH_COUNT=" + rowNames.length);
  console.log("ALUMINIUM_SEARCH_NAMES=" + JSON.stringify(rowNames.map((s) => s.trim())));
  await page.getByPlaceholder("Search items…").fill("");
});
