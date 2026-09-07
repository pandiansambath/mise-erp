import { test, type Page } from "@playwright/test";

/** WHICH calls each page makes, and whether any are duplicates. Fifteen calls
 *  is three waves of latency; knowing which fifteen is how you cut them. */

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

test("which calls, and which are repeats", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page);

  for (const path of ["/dashboard", "/money", "/attendance"]) {
    const seen: string[] = [];
    const on = (r: import("@playwright/test").Request) => {
      const u = r.url();
      if (u.includes("/api/")) seen.push(u.replace(BASE, "").split("?")[0]);
    };
    page.on("request", on);
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(6000);
    page.off("request", on);

    const counts = new Map<string, number>();
    for (const u of seen) counts.set(u, (counts.get(u) ?? 0) + 1);
    const dupes = [...counts.entries()].filter(([, n]) => n > 1);
    console.log(
      `CALLS ${path} total=${seen.length} distinct=${counts.size}` +
        (dupes.length ? ` DUPES=${JSON.stringify(dupes)}` : " DUPES=none") +
        ` :: ${[...counts.keys()].join(" | ")}`,
    );
  }
});
