import { test } from "@playwright/test";
const BASE = "https://nirai1.dineai.cloud";

test("purchasing tabs", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => { try { localStorage.setItem("mise.tour.done","1"); } catch { /* */ } });
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  await page.goto(`${BASE}/purchasing`);
  await page.waitForTimeout(7000);

  for (const [label, file] of [["Indents", "tab-indents"], ["Orders", "tab-orders"]] as const) {
    await page.getByRole("button", { name: new RegExp(label, "i") }).first().click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `e2e/__screens__/${file}.png` });
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("button, div")]
        .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 20 && t.length < 130)
        .slice(0, 6),
    );
    console.log(`--- ${label}`);
    rows.slice(0, 4).forEach((r) => console.log("   ", r));
  }
});
