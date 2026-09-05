import { test } from "@playwright/test";
const BASE = "https://nirai1.dineai.cloud";
test("measure the clock popup", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => { try { localStorage.setItem("mise.tour.done","1"); } catch {} });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.waitForTimeout(3000);
  await page.locator("[aria-label^='Restaurant time']").first().click();
  await page.waitForTimeout(1500);
  const d = await page.evaluate(() => {
    const dlg = document.querySelector("[role='dialog']") as HTMLElement | null;
    if (!dlg) return { found: false };
    const r = dlg.getBoundingClientRect();
    const cs = getComputedStyle(dlg);
    const body = dlg.querySelector(".overflow-y-auto") as HTMLElement | null;
    const svg = dlg.querySelector("svg") as SVGElement | null;
    return {
      found: true,
      top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
      maxHeight: cs.maxHeight, transform: cs.transform, position: cs.position,
      viewport: window.innerHeight,
      bodyScrollH: body ? body.scrollHeight : -1,
      bodyClientH: body ? body.clientHeight : -1,
      svgH: svg ? Math.round(svg.getBoundingClientRect().height) : -1,
    };
  });
  console.log(JSON.stringify(d, null, 1));
  await page.screenshot({ path: "e2e/__screens__/clock-diag.png" });
});
