import { expect, test } from "@playwright/test";

// "the chat conversation box is very small — that's why I'm saying it's tight."
// Five times now. So this stops being an opinion and becomes a number: the
// conversation is the thing the page is FOR, and it has to get most of the page.

const BASE = "https://nirai1.dineai.cloud";

test("the conversation gets most of the page", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
    } catch {
      /* ignore */
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  await page.goto(`${BASE}/ai-scan`);
  await page.waitForTimeout(3000);

  const m = await page.evaluate(() => {
    const px = (el: Element | null) => (el ? el.getBoundingClientRect().height : 0);
    const shell = document.querySelector(".mise-page-grow");
    return {
      shell: Math.round(px(shell)),
      // NOT querySelector("header") — that finds the app's own top bar, which
      // is not on this page's column at all. Measuring the wrong element and
      // believing the number is the mistake that has cost the most here.
      header: Math.round(px(shell?.querySelector("header") ?? null)),
      log: Math.round(px(document.querySelector(".mise-chat-shell"))),
      composer: Math.round(px(document.querySelector(".mise-chat-composer"))),
      viewport: window.innerHeight,
    };
  });
  const share = m.log / m.shell;
  console.log("chat geometry:", JSON.stringify({ ...m, share: +share.toFixed(2) }));

  await page.screenshot({ path: "e2e/__screens__/chat-room.png" });

  expect(m.header, `the header is ${m.header}px of a ${m.shell}px column`).toBeLessThan(90);
  expect(
    share,
    `the conversation is only ${(share * 100).toFixed(0)}% of the page`,
  ).toBeGreaterThan(0.68);
});
