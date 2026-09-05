import { expect, test } from "@playwright/test";

// CloudWatch showed /voice/hello firing every few seconds, which means the
// panel is being destroyed and rebuilt. Rather than keep reasoning about WHY
// from the symptom, count the calls and see exactly which action causes one.

const BASE = "https://nirai1.dineai.cloud";

test("the panel survives navigation without restarting itself", async ({ page }) => {
  const hellos: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/voice/hello")) hellos.push(new Date().toISOString());
  });

  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
    } catch {
      /* ignore */
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  await page.getByRole("button", { name: /talk to dineai/i }).click();
  await page.waitForTimeout(3000);
  console.log(`after opening      : ${hellos.length}`);

  // Just sitting there. If it climbs here, something is re-rendering on a timer.
  await page.waitForTimeout(8000);
  console.log(`after 8s idle      : ${hellos.length}`);

  // A navigation — which the voice itself performs constantly.
  await page.getByRole("link", { name: /^Expenses/ }).first().click();
  await page.waitForTimeout(3000);
  console.log(`after navigating   : ${hellos.length}`);

  await page.getByRole("link", { name: /^Inventory/ }).first().click();
  await page.waitForTimeout(3000);
  console.log(`after 2nd navigate : ${hellos.length}`);
  console.log("timestamps:", JSON.stringify(hellos));

  // The voice NAVIGATES for a living — "open expenses", "take me to sales" —
  // so a panel that restarts on every route change would lose the conversation
  // mid-sentence and greet him again. It must greet exactly once per session.
  expect(hellos.length, `it greeted ${hellos.length} times: ${hellos.join(", ")}`).toBe(1);
});
