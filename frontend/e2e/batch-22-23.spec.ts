import { expect, test, type Page } from "@playwright/test";

/**
 * Rota, Attendance, Menu and the unified Messages page — on the live site.
 *
 * The point of the rebuild was that each page buried the thing it is FOR, so
 * these assert what is on screen when you land, not merely that the page loads.
 * Measured beforehand: /attendance ran 4.41 screens on a phone, /menu 4.27, and
 * Rota's week grid started ~900px down with Saturday clipped off the right.
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

/** How many viewports tall the scrolling area is. */
async function screensTall(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector("main")!;
    const el = main.scrollHeight > window.innerHeight ? main : document.documentElement;
    return +(el.scrollHeight / window.innerHeight).toFixed(2);
  });
}

test("22 — attendance puts the people on the first screen", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await page.goto(`${BASE}/attendance`);
  await page.waitForLoadState("domcontentloaded");

  await expect(page.getByTestId("att-count")).toBeVisible({ timeout: 60_000 });
  const cards = page.getByTestId("att-person");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  expect(await cards.count(), "nobody was listed").toBeGreaterThan(0);

  // The first person must be reachable without scrolling — that is the whole
  // change. It used to take about a thousand pixels to reach them.
  await expect(cards.first()).toBeInViewport();

  // The table is gone; it is what made the phone four screens.
  expect(await page.locator("main table").count(), "the table came back").toBe(0);

  await page.screenshot({ path: "e2e-out/new-attendance.png", fullPage: true });

  // Opening a person gives their day and their history in one place.
  await cards.first().click();
  // role="tab", not "button" — Segmented sets it explicitly, and asking for a
  // button here finds nothing while looking exactly like a missing feature.
  await expect(page.getByRole("tab", { name: "History" })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "e2e-out/new-attendance-person.png" });
});

test("22 — rota shows the whole week, and Saturday is not off the edge", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await page.goto(`${BASE}/rota`);
  await page.waitForLoadState("domcontentloaded");

  await expect(page.getByTestId("rota-week")).toBeVisible({ timeout: 60_000 });
  const days = page.getByTestId("rota-day");
  await expect(days.first()).toBeVisible({ timeout: 30_000 });
  expect(await days.count(), "a week is seven days").toBe(7);

  // Every day fits inside the window. Sat and Sun used to be off the right.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the week runs off the side").toBeLessThanOrEqual(2);

  // The first day is on the first screen — it used to start ~900px down.
  await expect(days.first()).toBeInViewport();
  await page.screenshot({ path: "e2e-out/new-rota.png", fullPage: true });
});

test("23 — messages holds both sides, and a chat can be started with anyone", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page);
  await page.goto(`${BASE}/chat`);
  await page.waitForLoadState("domcontentloaded");

  await expect(page.getByTestId("chat-room").first()).toBeVisible({ timeout: 60_000 });
  // Both sides of the same page, rather than two pages.
  await expect(page.getByTestId("scope-hotel")).toBeVisible();
  await expect(page.getByTestId("scope-network")).toBeVisible();

  // A real emoji picker: categories AND a search, not thirty characters.
  await page.getByRole("button", { name: "Emoji" }).click();
  await expect(page.getByTestId("emoji-search")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("emoji-search").fill("thumbs");
  await expect
    .poll(async () => page.getByTestId("emoji-option").count(), {
      timeout: 15_000,
      message: "searching emoji found nothing",
    })
    .toBeGreaterThan(0);
  await page.screenshot({ path: "e2e-out/new-emoji.png" });

  // The GIF tab exists and answers — honestly, whether or not a key is set.
  await page.getByTestId("pick-gif").click();
  await expect(page.getByTestId("gif-search")).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: "e2e-out/new-gif.png" });
  await page.keyboard.press("Escape");

  // One-to-one with anybody — the thing that used to live on an admin page.
  await page.getByTestId("new-direct").click();
  await expect(page.getByTestId("direct-person")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "e2e-out/new-direct.png" });
});

test("22/23 — the phone versions fit", async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await signIn(page);

  for (const [path, ceiling] of [
    ["/attendance", 2.6],
    ["/menu", 3.0],
    ["/rota", 3.4],
  ] as const) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(4000);
    const tall = await screensTall(page);
    await page.screenshot({ path: `e2e-out/new-${path.slice(1)}-phone.png`, fullPage: true });
    // Not "must not scroll" — a list of people is allowed to be a list. The
    // check is that it is no longer a manual you scroll past to reach the tool.
    expect(tall, `${path} is still ${tall} screens tall on a phone`).toBeLessThan(ceiling);
  }

  await ctx.close();
});
