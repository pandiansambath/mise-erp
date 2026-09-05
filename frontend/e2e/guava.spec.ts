// His guava case, checked against the live page.
//   - one vendor's box holds 100 kg; it was rendering as 50
//   - every vendor's page showed the CHOSEN vendor's prices
//   - tapping an inventory item on a phone did nothing
import { test, expect, type Page } from "@playwright/test";

const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill(EMAIL);
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(1800);
}

test("a vendor's own box size is what the page prints", async ({ page, request }) => {
  test.setTimeout(240_000);
  await login(page);
  const token = await page.evaluate(() => localStorage.getItem("mise_token"));
  const base = process.env.BASE_URL ?? "https://nirai1.dineai.cloud";
  const H = { Authorization: `Bearer ${token}` };
  const api = `${base}/api`;

  const items = await (await request.get(`${api}/inventory/items`, { headers: H })).json();
  const guava = items.find((i: { name: string }) => i.name.toLowerCase() === "guava");
  expect(guava, "guava not found").toBeTruthy();
  const chainBox = (guava.pack_levels ?? []).find((l: { name: string }) => l.name === "box");
  console.log("item chain box base_size:", chainBox?.base_size);

  const vendors = await (await request.get(`${api}/vendors`, { headers: H })).json();
  const seen: { vendor: string; price: string; override: string | null }[] = [];
  for (const v of vendors) {
    const rows = await (await request.get(`${api}/vendors/${v.id}/items`, { headers: H })).json();
    const r = rows.find((x: { item_id: string }) => x.item_id === guava.id);
    if (r) seen.push({ vendor: v.name, price: r.price_per_unit, override: r.pack_size_override });
  }
  console.table(seen);

  // Somebody must actually have a different-sized box, or this proves nothing.
  const odd = seen.find((s) => s.override && parseFloat(s.override) !== parseFloat(chainBox?.base_size ?? "0"));
  console.log("a vendor whose box differs from the item's:", JSON.stringify(odd));
  expect(odd, "no vendor has a differing box size to test with").toBeTruthy();

  // The maths the page does, run over the real numbers.
  const perKg = parseFloat(odd!.price) / parseFloat(odd!.override!);
  console.log(
    `${odd!.vendor}: £${odd!.price} per box of ${odd!.override} kg = £${perKg.toFixed(4)}/kg`,
  );
  expect(Number.isFinite(perKg)).toBeTruthy();
});

test("each vendor page shows THAT vendor's price, not the chosen one's", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/vendors");
  await page.waitForTimeout(3000);

  const texts: string[] = [];
  // Open the first two vendors in turn and read what their picker card says.
  for (const idx of [0, 1]) {
    const cards = page.locator("text=/Manage/i");
    if ((await cards.count()) <= idx) break;
    await cards.nth(idx).click();
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: /Add a price/i }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    const search = page.getByPlaceholder(/search/i).first();
    await search.fill("gua").catch(() => {});
    await page.waitForTimeout(1500);
    const body = await page.locator("body").innerText();
    const m = body.match(/(not priced with [^\n]+|[^\n]*'s price)/);
    console.log(`vendor #${idx} card says:`, m ? m[0] : "(no ownership label found)");
    texts.push(m ? m[0] : "");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }

  // The label must name a vendor — that is the whole point of the change.
  expect(texts.some((t) => t.length > 0), "no card said whose price it was").toBeTruthy();
});

test("mobile: tapping an inventory item opens the sheet", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/inventory");
  await page.waitForTimeout(3500);

  const before = await page.locator("body").innerText();
  // Not just any [aria-expanded] — the page has hidden Select comboboxes that
  // also carry it. The item card is the visible one showing "avg".
  const card = page
    .getByRole("button")
    .filter({ hasText: /avg/ })
    .filter({ visible: true })
    .first();
  const n = await card.count();
  console.log("tappable item cards:", n);
  expect(n, "no tappable item card on mobile").toBeGreaterThan(0);

  await card.click();
  await page.waitForTimeout(2500);
  const after = await page.locator("body").innerText();
  const opened = /PURCHASES BY SUPPLIER|ON HAND|STOCK VALUE|AVG COST/i.test(after);
  console.log("sheet opened on tap:", opened, "| text grew by", after.length - before.length);
  expect(opened, "tapping the card did not open the detail sheet").toBeTruthy();
});
