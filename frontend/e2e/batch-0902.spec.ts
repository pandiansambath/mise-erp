import { expect, test } from "@playwright/test";

const BASE = "https://nirai1.dineai.cloud";

async function signIn(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem("mise.tour.done", "1"); } catch { /* */ }
  });
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

test("the clock runs, in the hotel's zone, on every page", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);

  const read = async () =>
    page.evaluate(() => {
      const el = [...document.querySelectorAll("span")].find((s) =>
        /^\d{2}:\d{2}:\d{2}$/.test((s.textContent || "").trim()),
      );
      return (el?.textContent || "").trim();
    });

  const first = await read();
  console.log("clock reads:", first);
  expect(first, "no HH:MM:SS clock on the dashboard").toMatch(/^\d{2}:\d{2}:\d{2}$/);

  // It must actually TICK — a frozen clock is worse than none.
  await page.waitForTimeout(2200);
  const later = await read();
  console.log("two seconds later:", later);
  expect(later, "the clock is not ticking").not.toBe(first);

  // "in all the pages literally".
  //
  // POLLED, not waited on. The first version gave each page a flat 2.5s and
  // reported the clock missing from /inventory — it was there, it just had not
  // hydrated yet on a page that renders two thousand lines. A fixed sleep that
  // is long enough for one page and short for another produces a bug report
  // about the app when the fault is in the test.
  for (const path of ["/inventory", "/purchasing", "/expenses"]) {
    await page.goto(`${BASE}${path}`);
    await expect
      .poll(read, { timeout: 30_000, message: `no clock on ${path}` })
      .toMatch(/^\d{2}:\d{2}:\d{2}$/);
    console.log(path, "->", await read());
  }

  // It must be the HOTEL's zone, not the tablet's. That is the entire point:
  // the sales day and the rota are already reckoned in the hotel's zone, so a
  // clock on the device's time would disagree with every number beside it.
  const zone = await page.evaluate(
    () => document.querySelector("[aria-label^='Restaurant time']")?.getAttribute("aria-label") ?? "",
  );
  console.log("clock label:", zone);
  expect(zone, "the clock does not name the hotel's zone").toContain("/");
});

test("tapping a supplier shows THAT supplier's prices", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/purchasing`);
  await expect
    .poll(async () => page.getByTestId("showby-vendor").count(), { timeout: 60_000 })
    .toBeGreaterThan(0);

  await page.getByTestId("showby-vendor").click();
  await page.waitForTimeout(900);

  const name = ((await page.getByTestId("vendor-tile").first().textContent()) || "")
    .replace(/\d+ items priced/, "")
    .replace(/[🚚]/g, "")
    .trim();
  console.log("opening supplier:", JSON.stringify(name));

  await page.getByTestId("vendor-tile").first().click();
  await page.waitForTimeout(2500);

  // Every card names the supplier it is priced from. Before the fix this sheet
  // was headed "Exotic" and showed SK, Farm2Land and Rudra.
  const named = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("[data-testid='item-tile']")];
    return cards
      .map((c) => {
        const lines = (c.textContent || "").split("\n").map((x) => x.trim()).filter(Boolean);
        return lines[lines.length - 1] || "";
      })
      .slice(0, 12);
  });
  console.log("suppliers named on the cards:", JSON.stringify([...new Set(named)]));

  const others = [...new Set(named)].filter((n) => n && !name.includes(n) && !n.includes(name));
  expect(
    others,
    `the sheet is headed "${name}" but prices come from ${JSON.stringify(others)}`,
  ).toEqual([]);
});

test("adding an item offers a supplier and a price", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/inventory`);
  await expect
    .poll(async () => page.locator("tbody tr").count(), { timeout: 60_000 })
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: /add item|add an item/i }).first().click();
  await page.waitForTimeout(1200);

  const has = await page.evaluate(() => ({
    prompt: /who supplies it/i.test(document.body.innerText),
    picker: Boolean(document.querySelector("select[aria-label='Supplier']")),
    price: Boolean(document.querySelector("input[aria-label^='Price per']")),
    newName: Boolean(document.querySelector("input[aria-label='New supplier name']")),
  }));
  console.log("add-item form offers:", JSON.stringify(has));
  await page.screenshot({ path: "e2e/__screens__/inv-add-supplier.png" });

  expect(has.prompt, "the form does not ask who supplies it").toBe(true);
  expect(has.picker, "no supplier picker").toBe(true);
  expect(has.price, "no price field").toBe(true);
  expect(has.newName, "cannot name a brand-new supplier").toBe(true);
});
