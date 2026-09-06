import { test } from "@playwright/test";

/** Diagnostic only: which box is short? The screenshot says the panes stop a
 *  third of the way down, but "the wrapper is short" and "the wrapper is right
 *  and the grid row is short" look identical from outside. */

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";

test("measure the chat height chain", async ({ page }) => {
  test.setTimeout(180_000);
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

  const out = await page.evaluate(() => {
    const rect = (el: Element | null) =>
      el ? Math.round(el.getBoundingClientRect().height) : -1;
    const main = document.querySelector("main");
    const rooms = document.querySelector('[data-testid="chat-room"]');
    const grid = rooms?.closest(".grid") ?? null;
    const wrapper = grid?.parentElement ?? null;
    const card = rooms?.closest("div.grid > *") ?? null;
    return {
      viewport: window.innerHeight,
      main: rect(main),
      mainComputed: main ? getComputedStyle(main).height : "",
      wrapper: rect(wrapper),
      wrapperClass: wrapper?.className ?? "",
      grid: rect(grid),
      gridRows: grid ? getComputedStyle(grid).gridTemplateRows : "",
      card: rect(card),
    };
  });
  console.log("MEASURED", JSON.stringify(out, null, 2));
});
