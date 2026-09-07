import { test, type Page } from "@playwright/test";

/**
 * WHY A BUTTON NEEDS TWO OR THREE TAPS.
 *
 *   "i need to click one any button 2 or 3 times to make it click. dont know
 *    why. please solve this too."
 *
 * A control that ignores the first press is nearly always one of three things,
 * and they need different fixes:
 *
 *   1. SOMETHING IS ON TOP OF IT. An invisible overlay eats the first tap and
 *      is dismissed by it, so the second tap reaches the button. Found by
 *      asking the browser what is actually at the button's centre.
 *   2. IT MOVES. A hover transform shifts it out from under the finger between
 *      pointerdown and click.
 *   3. IT IS TOO SMALL. Measured before; worth re-checking.
 *
 * So this asks the page rather than guessing.
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

test("what is sitting on top of the buttons", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page);

  for (const path of ["/dashboard", "/sales", "/inventory", "/rota"]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3500);

    const report = await page.evaluate(() => {
      const blocked: string[] = [];
      const moving: string[] = [];
      const tiny: string[] = [];

      const controls = Array.from(
        document.querySelectorAll("main button, main a, aside a, header button"),
      ).slice(0, 120) as HTMLElement[];

      for (const el of controls) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.top < 0 || r.bottom > window.innerHeight) continue;

        // Too small for a thumb.
        if (r.height < 32 || r.width < 32) {
          tiny.push(`${el.tagName} "${(el.textContent || "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }

        // What would actually receive the tap?
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && hit !== el && !el.contains(hit)) {
          const owner = hit as HTMLElement;
          blocked.push(
            `${el.tagName} "${(el.textContent || "").trim().slice(0, 22)}" <- ${owner.tagName}.${(owner.className || "").toString().slice(0, 46)}`,
          );
        }

        // Does it move on hover? A transform between pointerdown and click is
        // how a press lands next to the thing it was aimed at.
        const cs = getComputedStyle(el);
        if (cs.transform !== "none" && cs.transform !== "matrix(1, 0, 0, 1, 0, 0)") {
          moving.push(`${el.tagName} "${(el.textContent || "").trim().slice(0, 22)}" ${cs.transform}`);
        }
      }

      // Anything covering a large part of the screen that is not obviously a
      // backdrop — the classic first-tap thief.
      const covers: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll("*")) as HTMLElement[]) {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed" && cs.position !== "absolute") continue;
        if (cs.pointerEvents === "none") continue;
        const r = el.getBoundingClientRect();
        if (r.width > window.innerWidth * 0.6 && r.height > window.innerHeight * 0.6) {
          covers.push(
            `${el.tagName}.${(el.className || "").toString().slice(0, 60)} z=${cs.zIndex} op=${cs.opacity}`,
          );
        }
      }

      return { blocked: blocked.slice(0, 8), moving: moving.slice(0, 6), tiny: tiny.slice(0, 8), covers: covers.slice(0, 6) };
    });

    console.log(`CLICKS ${path} ` + JSON.stringify(report, null, 1));
  }
});
