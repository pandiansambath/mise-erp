import { test, type Page } from "@playwright/test";

/** Look at the voice orb on its stage. The rings only draw once it is awake, so
 *  this grants a fake microphone and starts it — guessing at "not correctly
 *  fitting" from the CSS alone has a poor record on this project. */

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

test("the voice orb, awake", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ["microphone"],
  });
  const page = await ctx.newPage();
  await signIn(page);
  await page.waitForTimeout(2500);

  await page.getByRole("button", { name: "Talk to DineAI" }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "e2e-out/voice-closed.png" });

  const start = page.getByRole("button", { name: "Start listening" });
  if ((await start.count()) > 0) {
    await start.click();
    await page.waitForTimeout(4000);
  }

  const box = await page.evaluate(() => {
    const orb = document.querySelector(".mise-voice-orb") as HTMLElement | null;
    const rings = document.querySelector(".mise-voice-rings") as HTMLElement | null;
    const card = document.querySelector(".mise-voice-card") as HTMLElement | null;
    const wrap = document.querySelector(".mise-voice") as HTMLElement | null;
    const r = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        x: Math.round(b.left),
        y: Math.round(b.top),
        w: Math.round(b.width),
        h: Math.round(b.height),
      };
    };
    return {
      orb: r(orb),
      rings: r(rings),
      card: r(card),
      wrap: r(wrap),
      phase: orb?.getAttribute("data-phase"),
      staged: wrap?.hasAttribute("data-staged"),
      cardOverflow: card ? getComputedStyle(card).overflow : null,
    };
  });
  console.log("VOICE " + JSON.stringify(box, null, 1));
  await page.screenshot({ path: "e2e-out/voice-stage.png" });
  await ctx.close();
});
