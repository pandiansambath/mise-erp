import { test, expect } from "@playwright/test";

// Smoke test for the WebGL landing journey: it must mount, scroll through every
// beat, and reach the CTA without throwing — on both the high-quality (desktop)
// and low-quality (mobile) paths. Screenshots are saved for visual review.
test("landing journey mounts, scrolls and reaches the CTA without errors", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto("/");
  await page.waitForTimeout(1600); // let the intro veil lift

  const path = (await page.locator("canvas").count()) > 0 ? "JOURNEY (webgl)" : "CLASSIC (fallback)";
  console.log(`[${testInfo.project.name}] rendered path: ${path}`);

  // Hero copy is shared by both the journey overlay and the classic fallback.
  await expect(page.getByText(/Especially the profit\./i).first()).toBeVisible();

  const dir = testInfo.project.name;
  let i = 0;
  for (const frac of [0, 0.3, 0.55, 0.72, 0.85, 0.98]) {
    await page.evaluate((f) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: max * f, behavior: "instant" as ScrollBehavior });
    }, frac);
    await page.waitForTimeout(650);
    await page.screenshot({ path: `e2e/__screens__/${dir}-${i++}.png` });
  }

  // The closing CTA must be reachable after the full scroll.
  await expect(page.getByRole("link", { name: /Register your hotel/i }).first()).toBeVisible();

  const real = errors.filter(
    (e) => !/DEP0205|React DevTools|Lighthouse|favicon|net::ERR_/i.test(e),
  );
  expect(real, "console/page errors:\n" + real.join("\n")).toEqual([]);
});
