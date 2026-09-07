import { expect, test, type Page } from "@playwright/test";

/**
 * The 2026-09-07 batch, on the deployed site.
 *
 * Every one of these is something he found by looking, so every one ends in a
 * screenshot rather than only a number. The numbers are here to fail fast; the
 * pictures are what decide whether it is actually fixed.
 */

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";

async function signIn(page: Page) {
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
}

test("the AI panel is inside the assistant card, on a role he made", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await page.goto(`${BASE}/staff`);
  await page.waitForLoadState("domcontentloaded");

  // Open a custom role — the sheet that had no AI panel at all.
  // WAIT for it: the roles list is fetched, and counting before the fetch
  // returns skipped this test while reporting a tidy green run.
  await expect
    .poll(async () => page.getByText("A role you made").count(), {
      timeout: 45_000,
      message: "no custom role appeared on /staff",
    })
    .toBeGreaterThan(0);
  await page.getByText("A role you made").first().click();
  await page.getByRole("button", { name: /assistant/i }).first().click().catch(() => {});
  await page.waitForTimeout(1500);

  const model = page.getByTestId("role-ai-model");
  await expect(model, "the AI settings never appeared on a custom role").toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({ path: "e2e-out/v-role-ai.png" });
});

test("the chat has the screen, and the popup header is not washed out", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);

  await page.goto(`${BASE}/chat`);
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("chat-room").first().waitFor({ timeout: 60_000 });

  const room = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="chat-input"]')?.closest(".flex-col");
    const r = list?.getBoundingClientRect();
    return {
      conversationHeight: r ? Math.round(r.height) : -1,
      viewport: window.innerHeight,
    };
  });
  console.log("CHAT", JSON.stringify(room));
  // It used to be about 380 of a 900px screen — two messages.
  expect(room.conversationHeight).toBeGreaterThan(room.viewport * 0.6);
  await page.screenshot({ path: "e2e-out/v-chat.png", fullPage: false });

  // A popup, for the header contrast.
  await page.getByTestId("new-direct").click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "e2e-out/v-popup.png" });
});

test("my space offers one messaging entry, not two", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/my`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(4000);

  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main [role='tab'], main a"))
      .map((el) => (el.textContent || "").trim())
      .filter((s) => /message|chat/i.test(s)),
  );
  console.log("MY SPACE MESSAGING ENTRIES:", JSON.stringify(labels));
  expect(labels.length, `expected one messaging entry, saw ${labels.join(" | ")}`).toBeLessThan(2);
  await page.screenshot({ path: "e2e-out/v-my.png", fullPage: false });
});

test("settings shows the preview dock with four combinations", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);

  await expect(page.getByTestId("preview-site")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("preview-door")).toBeVisible();
  await expect(page.getByTestId("preview-wide")).toBeVisible();
  await expect(page.getByTestId("preview-tall")).toBeVisible();
  await page.screenshot({ path: "e2e-out/v-settings-wide.png", fullPage: false });

  await page.getByTestId("preview-tall").click();
  await page.waitForTimeout(1200);
  await page.getByTestId("preview-door").click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "e2e-out/v-settings-tall-door.png", fullPage: false });
});
