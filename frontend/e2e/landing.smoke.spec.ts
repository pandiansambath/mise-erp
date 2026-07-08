import { test, expect } from "@playwright/test";

// Smoke test for the premium landing: it must mount, scroll through every
// section, and reach the closing CTA without console/page errors — on desktop
// and mobile. Screenshots are saved for visual review.
test("premium landing mounts, scrolls and reaches the CTA without errors", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto("/");
  await page.waitForTimeout(2000); // let the intro veil lift

  // The brand line is shared by the premium landing and the classic fallback.
  await expect(page.getByText(/Especially the profit\./i).first()).toBeVisible();

  const dir = testInfo.project.name;
  let i = 0;
  for (const frac of [0, 0.12, 0.3, 0.45, 0.6, 0.75, 0.9, 0.99]) {
    await page.evaluate((f) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: max * f, behavior: "instant" as ScrollBehavior });
    }, frac);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `e2e/__screens__/${dir}-${i++}.png` });
  }

  // The closing CTA must be reachable after the full scroll.
  await expect(page.getByRole("link", { name: /Register your hotel/i }).first()).toBeVisible();

  const real = errors.filter(
    (e) => !/DEP0205|React DevTools|Lighthouse|favicon|net::ERR_|AbortError|play\(\) request/i.test(e),
  );
  expect(real, "console/page errors:\n" + real.join("\n")).toEqual([]);
});
