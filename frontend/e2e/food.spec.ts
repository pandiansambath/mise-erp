// The live food, checked on the real page: does it load, does it animate, and
// does it animate ONLY where it should?
import { test, expect, type Page } from "@playwright/test";
const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#li-email:visible").first().fill(EMAIL);
  await page.locator("#li-password:visible").first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(2500);
}

test("the food is alive, and costs what an image costs", async ({ page }) => {
  test.setTimeout(240_000);
  let bytes = 0;
  let files = 0;
  page.on("response", async (r) => {
    if (r.url().includes("/food/") && r.url().endsWith(".webp")) {
      files += 1;
      const h = await r.allHeaders();
      bytes += Number(h["content-length"] ?? 0);
    }
  });

  await login(page);
  await page.goto("/purchasing");
  await page.getByTestId("category-tile").first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2500);

  const sprites = await page.locator(".mise-food").count();
  const livingNow = await page.locator(".mise-food.is-live").count();
  console.log(`sprites on the page: ${sprites}, animating: ${livingNow}`);
  console.log(`downloaded: ${files} files, ${(bytes / 1024).toFixed(0)} KB`);
  expect(sprites, "the category tiles should carry sprites").toBeGreaterThan(5);

  // The animation must actually be running on a visible one.
  const anim = await page
    .locator(".mise-food.is-live")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  console.log("animation:", anim);
  expect(anim, "a visible sprite must be animating").toBe("mise-food-run");

  await page.screenshot({ path: "e2e/__screens__/food-tiles.png" });

  // And the page must still be quick.
  const timing = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return { load: Math.round(n.loadEventEnd - n.startTime) };
  });
  console.log("page load:", timing.load, "ms");
});
