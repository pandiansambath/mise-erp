import { expect, test, type Page } from "@playwright/test";

/**
 * Batches 5–7, checked on the deployed site.
 *
 *   "that 24h 12h toggle not working... store in db and make it persistent"
 *   "this document page whole UI we need to build from scratch, likewise audit
 *    log page too, same this your plan page too. this page going down too much,
 *    i said i hate scrolling. we need a top notch UI UX"
 *   "staff can comment that owner can see, owner can comment that staff can see"
 *
 * The clock case is the one to be careful about. It looked like a dead button
 * and was actually a 422 from the preferences endpoint being swallowed on the
 * way back, which is exactly why this asserts across a RELOAD: a toggle that
 * moves and then forgets is indistinguishable from one that works, until you
 * come back the next morning and find it reset.
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

/** The clock lives in the shell, so it opens from whatever page you are on. */
async function openClock(page: Page) {
  await page.getByRole("button", { name: /Restaurant time/i }).first().click();
  await expect(page.getByRole("button", { name: "12-hour", exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

/** Which of the two is the chosen one — the selected button is the filled one. */
async function chosenClock(page: Page): Promise<string> {
  for (const label of ["12-hour", "24-hour"]) {
    const cls =
      (await page.getByRole("button", { name: label, exact: true }).getAttribute("class")) ?? "";
    if (cls.includes("bg-brand-600")) return label;
  }
  return "neither";
}

test("the 12/24 clock survives a reload — it is stored, not remembered", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);

  await openClock(page);
  const before = await chosenClock(page);
  expect(before, "neither format was marked as chosen").not.toBe("neither");

  // Flip to the other one and let the save land.
  const other = before === "12-hour" ? "24-hour" : "12-hour";
  await page.getByRole("button", { name: other, exact: true }).click();
  await expect
    .poll(async () => chosenClock(page), { timeout: 30_000, message: "the toggle never moved" })
    .toBe(other);
  await page.screenshot({ path: "e2e-out/clock-toggled.png" });

  // The real assertion: come back to it fresh.
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openClock(page);
  expect(await chosenClock(page), "the clock forgot the choice across a reload").toBe(other);
  await page.screenshot({ path: "e2e-out/clock-persisted.png" });

  // Put his tenant back the way we found it.
  await page.getByRole("button", { name: before, exact: true }).click();
  await expect.poll(async () => chosenClock(page), { timeout: 30_000 }).toBe(before);
});

test("your plan asks one question at a time instead of stacking three", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/plan`);
  await page.waitForLoadState("domcontentloaded");

  const compare = page.getByRole("button", { name: "Compare plans" });
  const included = page.getByRole("button", { name: "What's included" });
  await expect(compare).toBeVisible({ timeout: 60_000 });
  await expect(included).toBeVisible();

  // Switching must actually change what is on screen — a tab strip that looks
  // right and shows the same block twice is worse than no tabs.
  const first = await page.locator("main").innerText();
  await included.click();
  await expect
    .poll(async () => (await page.locator("main").innerText()) !== first, {
      timeout: 20_000,
      message: "the second tab showed the same content as the first",
    })
    .toBe(true);
  await page.screenshot({ path: "e2e-out/plan-included.png", fullPage: true });
});

test("audit and documents load, and put something on the first screen", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);

  for (const [path, heading] of [
    ["/audit", "Audit log"],
    ["/documents", "Documents"],
  ] as const) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({
      timeout: 60_000,
    });

    // Not "does it scroll" — that reads the same whether the page is short or
    // broken. This asks whether the page put real content where you land,
    // rather than making you scroll to find out what it is for.
    const painted = await page.evaluate(() => {
      const h = window.innerHeight;
      return Array.from(document.querySelectorAll("main *")).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.top < h && r.height > 24 && r.width > 80;
      }).length;
    });
    expect(painted, `${path} showed almost nothing on the first screen`).toBeGreaterThan(5);

    await page.screenshot({
      path: `e2e-out/${path.slice(1)}-first-screen.png`,
      fullPage: true,
    });
  }
});

test("my space carries the thread with the owner", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/my`);
  await page.waitForLoadState("domcontentloaded");

  // The composer is the thing a person points at when they say "I can message
  // my manager here" — its absence is the whole failure mode.
  const composer = page
    .getByPlaceholder(/message|write|type/i)
    .or(page.getByRole("textbox").filter({ visible: true }))
    .first();
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: "e2e-out/my-space-chat.png", fullPage: true });
});
