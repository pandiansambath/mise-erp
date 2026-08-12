// A survey of the purchasing page, on his own tenant, at both widths.
// Written to LOOK at every corner he named rather than to assert anything.
import { test, type Page } from "@playwright/test";

const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";
const S = "e2e/__screens__/audit";

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

test("survey the whole purchasing page", async ({ page }, info) => {
  test.setTimeout(300_000);
  const w = page.viewportSize()?.width ?? 0;
  await login(page);
  await page.goto("/purchasing");
  // Wait for DATA. Four seconds caught a spinner on his tenant and I nearly
  // audited a loading screen.
  await page.getByTestId("category-tile").first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${S}/${w}-1-top.png` });
  await page.screenshot({ path: `${S}/${w}-2-full.png`, fullPage: true });

  // How much room does the header take before any work is visible?
  const metrics = await page.evaluate(() => {
    const firstTile = document.querySelector("[data-testid=category-tile]");
    const r = firstTile?.getBoundingClientRect();
    return {
      viewportH: window.innerHeight,
      firstCategoryTop: r ? Math.round(r.top) : null,
      docScrollY: window.scrollY,
    };
  });
  console.log(`[${w}] first category tile starts at ${metrics.firstCategoryTop}px of ${metrics.viewportH}px`);

  // Category popup
  const tile = page.getByTestId("category-tile").first();
  if (await tile.count()) {
    await tile.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${S}/${w}-3-category.png` });
    const scroll = await page.evaluate(() => {
      const d = document.querySelector("[role=dialog]") as HTMLElement;
      const body = d?.querySelector(".overflow-y-auto") as HTMLElement;
      return {
        dialogW: Math.round(d?.getBoundingClientRect().width ?? 0),
        bodyScrollW: body ? body.scrollWidth - body.clientWidth : -1,
        bodyScrollH: body ? body.scrollHeight - body.clientHeight : -1,
      };
    });
    console.log(`[${w}] category popup ${scroll.dialogW}px, overflows across ${scroll.bodyScrollW}px, down ${scroll.bodyScrollH}px`);

    // Item popup
    const item = page.getByTestId("item-tile").first();
    if (await item.count()) {
      await item.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${S}/${w}-4-item.png` });
      const it = await page.evaluate(() => {
        const ds = Array.from(document.querySelectorAll("[role=dialog]")) as HTMLElement[];
        const d = ds[ds.length - 1];
        const body = d?.querySelector(".overflow-y-auto") as HTMLElement;
        return {
          h: Math.round(d?.getBoundingClientRect().height ?? 0),
          scrolls: body ? body.scrollHeight - body.clientHeight : -1,
        };
      });
      console.log(`[${w}] item popup ${it.h}px tall, body overflows by ${it.scrolls}px`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // Indents
  await page.getByRole("button", { name: /^Indents/ }).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${S}/${w}-5-indents.png` });
  const row = page.locator("[aria-expanded]").filter({ hasText: /item/ }).first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${S}/${w}-6-indent-sheet.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // Orders
  await page.getByRole("button", { name: /^Orders/ }).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${S}/${w}-7-orders.png` });
  const run = page.locator("button").filter({ hasText: /Purchase ·|Other orders/ }).first();
  if (await run.count()) {
    await run.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${S}/${w}-8-run-open.png` });
    const po = page.locator("button").filter({ hasText: /PO-\d{4}-\d+/ }).first();
    if (await po.count()) {
      await po.click();
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `${S}/${w}-9-po-sheet.png` });
    }
  }
  console.log(`[${w}] survey done — ${info.title}`);
});
