import { expect, test } from "@playwright/test";

/**
 * Nothing should be shouting in the console.
 *
 * A React key warning or a failed request does not stop the page rendering, so
 * it survives every screenshot and every assertion — and then turns into "it
 * flickers sometimes" weeks later. This is the check that catches the class of
 * fault a passing test cannot see.
 */

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";

test("the chat page loads without complaining", async ({ page }) => {
  test.setTimeout(180_000);

  const shouts: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") shouts.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => shouts.push(`pageerror: ${e.message}`));
  const badRequests: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().includes("/api/")) {
      badRequests.push(`${r.status()} ${r.url().replace(BASE, "")}`);
    }
  });

  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
    } catch {
      /* ignore */
    }
  });
  await page.goto(`${BASE}/login`);
  await page
    .locator('[data-testid="login-email"]:visible, #li-email:visible')
    .first()
    .fill("superadmin@gmail.com");
  await page
    .locator('[data-testid="login-password"]:visible, #li-password:visible')
    .first()
    .fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  await page.goto(`${BASE}/chat`);
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("chat-room").first().waitFor({ timeout: 60_000 });
  await page.getByTestId("chat-room").first().click();
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 });

  // Let one poll cycle go by — a duplicate-key or stale-state fault shows up on
  // the SECOND render, not the first.
  await page.waitForTimeout(9000);

  console.log("CONSOLE:", JSON.stringify(shouts.slice(0, 15), null, 2));
  console.log("FAILED REQUESTS:", JSON.stringify(badRequests.slice(0, 15), null, 2));

  expect(badRequests, "the chat page made failing API calls").toEqual([]);
  const real = shouts.filter((s) => !/favicon|third-party|DevTools/i.test(s));
  expect(real, "the chat page logged errors or warnings").toEqual([]);
});
