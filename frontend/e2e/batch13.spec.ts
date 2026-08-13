// The 2026-08-13 batch, checked on his tenant.
import { test, expect, type Page } from "@playwright/test";
const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";
const S = "e2e/__screens__/b13";

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

test("the 13th batch, live", async ({ page }) => {
  test.setTimeout(300_000);
  const w = page.viewportSize()?.width ?? 0;
  const out: string[] = [];
  const ok = (n: string, p: boolean, d = "") => out.push(`${p ? "DONE" : "OPEN"}  ${n}${d ? " — " + d : ""}`);

  await login(page);
  await page.goto("/purchasing");
  await page.getByTestId("category-tile").first().waitFor({ timeout: 90_000 });

  // 1 — the tiles have a real top shadow
  const sh = await page.getByTestId("category-tile").first().evaluate((el) => getComputedStyle(el).boxShadow);
  ok("1 tiles have a top shadow", /0px -\d+px 0px 0px|-\d+px -\d+px/.test(sh), sh.slice(0, 44));

  // 3 — the category popup grows for a big category
  await page.getByTestId("category-tile").filter({ hasText: /Vegetables|Spices|Dairy/ }).first().click();
  await page.waitForTimeout(1100);
  const big = await page.locator("[role=dialog]").first().boundingBox();
  await page.screenshot({ path: `${S}/${w}-category-big.png` });
  ok("3 popup grows for many items", (big?.width ?? 0) > 620, `${Math.round(big?.width ?? 0)}px`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  await page.getByRole("button", { name: /^Orders/ }).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${S}/${w}-orders.png` });

  // 10 — runs name themselves instead of "Other orders"
  const named = await page.locator("text=/Purchase ·/").count();
  const other = await page.locator("text=/Orders with no indent|Other orders/").count();
  ok("10 runs are named", named > other, `${named} named vs ${other} unnamed`);

  // 7.1 — the icon buttons respond
  const listBtn = page.getByRole("button", { name: /See every line on this purchase/ }).first();
  ok("7.1 the list icon exists", (await listBtn.count()) > 0);
  if (await listBtn.count()) {
    await listBtn.click();
    await page.waitForTimeout(1600);
    const opened = await page.locator("[role=dialog]").filter({ hasText: /whole purchase/i }).count();
    await page.screenshot({ path: `${S}/${w}-run-sheet.png` });
    ok("7.1 the list icon OPENS the sheet", opened > 0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }

  // 7 — late orders stay inside "still to arrive"
  const late = page.locator("button:visible", { hasText: /^Late\s*\d+$/ }).first();
  if (await late.count()) {
    const hint = (await late.getAttribute("title")) ?? "";
    ok("7 late explains it is also still-to-arrive", /still to arrive/i.test(hint), hint.slice(0, 44));
  } else {
    ok("7 late chip present", false, "no late orders right now");
  }

  // 9 — the sort control is ours, not the OS's
  const ours = await page.locator("select:visible").first().evaluate((el) => getComputedStyle(el).opacity);
  ok("9 sort dropdown is ours", ours === "0", `select opacity ${ours}`);

  console.log(`\n=== 13th BATCH (${w}px) ===`);
  for (const r of out) console.log("  " + r);
  const open = out.filter((r) => r.startsWith("OPEN"));
  console.log(`  ${out.length - open.length}/${out.length} verified\n`);
  expect(open, `open: ${open.join("; ")}`).toHaveLength(0);
});
