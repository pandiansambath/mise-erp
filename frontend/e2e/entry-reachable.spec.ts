import { expect, test } from "@playwright/test";

/**
 * Can he SAVE without scrolling?
 *
 * "I need to scrollllll till down to reach that expense entering card." The
 * card was always beside the entries — its HEIGHT was the problem, so the
 * measurement that matters is not "is the form on screen" but "is the button
 * that commits it on screen".
 */
const BASE = "https://nirai1.dineai.cloud";

test("the save button is reachable without scrolling", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    try { localStorage.setItem("mise.tour.done", "1"); } catch { /* */ }
  });
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  for (const [path, label] of [
    ["/expenses", /add expense|save changes/i],
    ["/sales", /save .*takings/i],
  ] as const) {
    await page.goto(`${BASE}${path}`);
    await expect
      .poll(async () => page.getByRole("button", { name: label }).count(), {
        timeout: 60_000,
        message: `${path}: the commit button never rendered`,
      })
      .toBeGreaterThan(0);
    await page.waitForTimeout(1500);

    const r = await page.evaluate((sel) => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        new RegExp(sel, "i").test(b.textContent || ""),
      );
      if (!btn) return { found: false, top: -1, fold: window.innerHeight };
      const box = btn.getBoundingClientRect();
      return { found: true, top: Math.round(box.top), fold: window.innerHeight };
    }, path === "/expenses" ? "add expense|save changes" : "save .*takings");

    const ok = r.found && r.top >= 0 && r.top < r.fold;
    console.log(
      `${ok ? "REACHABLE" : "BELOW FOLD"} ${path.padEnd(12)} save button top=${r.top}px fold=${r.fold}`,
    );
    expect(ok, `${path}: the save button is at ${r.top}px, fold is ${r.fold}`).toBe(true);
  }
});
