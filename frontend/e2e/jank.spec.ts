import { test, type Page } from "@playwright/test";

/**
 * WHY A CLICK LOOKS LATE.
 *
 *   "if i click any button i can notice there is a delay in opening that.
 *    actually click representation itself is delayed — like i clicked but after
 *    few sec only it sensing that i clicked that button."
 *
 * That is not the network. A press state is painted by the browser without
 * asking a server anything, so if it arrives late the MAIN THREAD was busy.
 * Something is running long enough to postpone the paint.
 *
 * So: record long tasks (anything over 50ms blocks input), count how much time
 * the thread spends blocked, and measure the actual gap between dispatching a
 * click and the handler running.
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

test("what is blocking the main thread", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page);

  await page.addInitScript(() => {
    (window as unknown as { __long: number[] }).__long = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          (window as unknown as { __long: number[] }).__long.push(Math.round(e.duration));
        }
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      /* not supported */
    }
  });

  for (const path of ["/dashboard", "/inventory", "/sales"]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(6000);

    const blocking = await page.evaluate(() => {
      const long = (window as unknown as { __long?: number[] }).__long ?? [];
      return {
        longTasks: long.length,
        worst: long.length ? Math.max(...long) : 0,
        // Total Blocking Time: what each long task costs input beyond 50ms.
        tbt: long.reduce((s, d) => s + Math.max(0, d - 50), 0),
      };
    });

    // How long between asking for a click and the handler running?
    const clickLag = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        const btn = document.querySelector("main button, main a") as HTMLElement | null;
        if (!btn) return resolve(-1);
        const t0 = performance.now();
        const onClick = () => {
          btn.removeEventListener("click", onClick, true);
          resolve(Math.round(performance.now() - t0));
        };
        btn.addEventListener("click", onClick, true);
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
    });

    // How many things are listening to every mouse move? A custom cursor that
    // runs on mousemove can saturate a thread on its own.
    const listeners = await page.evaluate(() => {
      const counts: Record<string, number> = {};
      const anim = document.getAnimations?.() ?? [];
      counts.runningAnimations = anim.filter((a) => a.playState === "running").length;
      counts.blurredElements = Array.from(document.querySelectorAll("*")).filter((el) => {
        const f = getComputedStyle(el).backdropFilter;
        return f && f !== "none";
      }).length;
      counts.domNodes = document.querySelectorAll("*").length;
      return counts;
    });

    console.log(
      `JANK ${path} ${JSON.stringify({ ...blocking, clickLag, ...listeners })}`,
    );
  }
});
