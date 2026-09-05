// The whole loop he described, driven on the live site:
//   new item -> vendor says "1 bottle = 20 kg for £5" -> inventory reads it back
// plus the mobile rail and the wide-panel depth.
import { test, expect, type Page } from "@playwright/test";

const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('[data-testid="login-email"]:visible').first().fill(EMAIL);
  await page.locator('[data-testid="login-password"]:visible').first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(1800);
}

test("the vendor names the pack, and inventory reads it back", async ({ page, request }) => {
  test.setTimeout(300_000);
  await login(page);

  // Drive it through the API the page uses, so this proves the MODEL end to end
  // rather than my ability to find a button.
  const token = await page.evaluate(() => localStorage.getItem("mise_token"));
  expect(token, "no auth token in localStorage").toBeTruthy();
  const base = process.env.BASE_URL ?? "https://nirai1.dineai.cloud";
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const api = `${base}/api`;

  const name = `packtest-${Date.now().toString().slice(-6)}`;
  const mk = await request.post(`${api}/inventory/items`, {
    headers: H,
    data: { name, unit: "kg", category: "Other" },
  });
  expect(mk.ok(), `create item failed: ${mk.status()}`).toBeTruthy();
  const item = await mk.json();
  console.log(`created ${name} (${item.id}) — pack_levels:`, JSON.stringify(item.pack_levels));
  expect(item.pack_levels, "a brand-new item should have no chain").toHaveLength(0);

  const vres = await request.get(`${api}/vendors`, { headers: H });
  const vendors = await vres.json();
  expect(vendors.length, "need at least two vendors").toBeGreaterThan(1);
  const [v1, v2] = vendors;

  // Vendor 1: 1 bottle = 20 kg for £5.  Nothing was created in Inventory first.
  const p1 = await request.post(`${api}/vendors/${v1.id}/items`, {
    headers: H,
    data: { item_id: item.id, price_per_unit: "5.00", pack_name: "bottle", pack_size: "20" },
  });
  expect(p1.ok(), `vendor 1 price failed: ${p1.status()} ${await p1.text()}`).toBeTruthy();
  console.log("vendor 1:", JSON.stringify(await p1.json()));

  // Vendor 2 says "bottle" too — but THEIR bottle holds 10, for £4.
  const p2 = await request.post(`${api}/vendors/${v2.id}/items`, {
    headers: H,
    data: { item_id: item.id, price_per_unit: "4.00", pack_name: "bottle", pack_size: "10" },
  });
  expect(p2.ok(), `vendor 2 price failed: ${p2.status()}`).toBeTruthy();
  const r2 = await p2.json();
  console.log("vendor 2:", JSON.stringify(r2));

  // The item now has a "bottle" rung nobody typed into Inventory.
  const after = await (await request.get(`${api}/inventory/items`, { headers: H })).json();
  const mine = after.find((i: { id: string }) => i.id === item.id);
  console.log("chain after:", JSON.stringify(mine.pack_levels));
  expect(mine.pack_levels.length, "the vendor's pack should have joined the chain").toBe(1);
  expect(mine.pack_levels[0].name).toBe("bottle");

  // THE POINT: both said "bottle", and they hold different amounts.
  const r1 = await (await request.get(`${api}/vendors/${v1.id}/items`, { headers: H })).json();
  const mine1 = r1.find((x: { item_id: string }) => x.item_id === item.id);
  console.log(`v1 bottle = ${mine1.pack_size_override}, v2 bottle = ${r2.pack_size_override}`);
  expect(String(mine1.pack_size_override)).toMatch(/^20/);
  expect(String(r2.pack_size_override)).toMatch(/^10/);

  // And a plain price edit must not wipe either of them.
  await request.post(`${api}/vendors/${v1.id}/items`, {
    headers: H,
    data: { item_id: item.id, price_per_unit: "5.50" },
  });
  const r1b = await (await request.get(`${api}/vendors/${v1.id}/items`, { headers: H })).json();
  const keep = r1b.find((x: { item_id: string }) => x.item_id === item.id);
  console.log("after a price-only edit:", keep.price_per_unit, "size", keep.pack_size_override);
  expect(String(keep.pack_size_override), "price edit erased the pack size").toMatch(/^20/);

  // Inventory shows it back, per supplier.
  await page.goto("/inventory");
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/search|find/i).first().fill(name).catch(() => {});
  await page.waitForTimeout(1200);
  const body = await page.locator("body").innerText();
  console.log("inventory mentions the item:", body.includes(name));

  // Clean up so his tenant is not littered with test rows.
  await request.delete(`${api}/inventory/items/${item.id}`, { headers: H }).catch(() => {});
});

test("mobile: the condensed rail keeps its buttons on screen", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/purchasing");
  await page.getByTestId("category-tile").first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(800);

  await page.mouse.move(195, 600);
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(900);

  const m = await page.evaluate(() => {
    const rail = document.querySelector(".mise-bench-rail") as HTMLElement;
    const tools = document.querySelector(".mise-bench-tools") as HTMLElement;
    const r = tools.getBoundingClientRect();
    return {
      vw: window.innerWidth,
      condensed: rail.getAttribute("data-condensed"),
      left: +r.left.toFixed(0),
      right: +r.right.toFixed(0),
      offRight: +Math.max(0, r.right - window.innerWidth).toFixed(0),
    };
  });
  console.log("mobile condensed tools:", JSON.stringify(m));
  expect(m.condensed).toBe("true");
  expect(m.offRight, "the buttons hang off the right edge").toBe(0);
  expect(m.left, "the row starts off-screen to the left").toBeGreaterThanOrEqual(0);
});

test("wide panels carry a shallower band than the tiles", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/purchasing");
  await page.getByTestId("category-tile").first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(800);

  const d = await page.evaluate(() => {
    const wide = document.querySelector(".mise-card3d-wide") as HTMLElement;
    const tile = document.querySelector("[data-testid='category-tile']") as HTMLElement;
    const read = (el: HTMLElement) => ({
      depth: getComputedStyle(el).getPropertyValue("--tile-depth").trim(),
      w: Math.round(el.getBoundingClientRect().width),
    });
    return { wide: wide ? read(wide) : null, tile: read(tile) };
  });
  console.log("depths:", JSON.stringify(d));
  expect(d.wide, "no wide panel found").not.toBeNull();
  expect(d.wide!.depth).toBe("5px");
  expect(d.tile.depth).toBe("8px");
  // The point of the change: the wide one really is much wider.
  expect(d.wide!.w).toBeGreaterThan(d.tile.w);
});
