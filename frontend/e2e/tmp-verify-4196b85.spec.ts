import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";
const OUT = "e2e-out";

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

test("tables page is tiles, and the QR carries the name", async ({ page }, info) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/tables`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);

  const tiles = page.locator('[data-testid="table-tile"]');
  const n = await tiles.count();
  console.log(`[${info.project.name}] TILE COUNT = ${n}`);
  await page.screenshot({ path: `${OUT}/${info.project.name}-tables-list.png`, fullPage: true });

  // Is the old big-QR-card layout still present on screen? The print sheet is
  // aria-hidden + hidden, so only VISIBLE qr images count as "old cards".
  const visibleQrOnList = await page.locator('img[src*="qr.svg"]:visible').count();
  console.log(`[${info.project.name}] VISIBLE QR IMAGES ON LIST = ${visibleQrOnList}`);

  expect(n).toBeGreaterThan(0);

  // The tile's own name, so we can check it lands in the QR.
  const label = (await tiles.first().locator("p").first().innerText()).trim();
  console.log(`[${info.project.name}] FIRST TILE LABEL = "${label}"`);

  await tiles.first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${info.project.name}-table-popup.png`, fullPage: true });

  const qr = page.locator('img[src*="qr.svg"]:visible').first();
  await expect(qr).toBeVisible({ timeout: 20_000 });
  const src = await qr.getAttribute("src");
  console.log(`[${info.project.name}] QR SRC = ${src}`);

  // Did the image actually LOAD (not a broken img)?
  const dims = await qr.evaluate((el) => {
    const i = el as HTMLImageElement;
    return { complete: i.complete, w: i.naturalWidth, h: i.naturalHeight };
  });
  console.log(`[${info.project.name}] QR NATURAL SIZE = ${JSON.stringify(dims)}`);

  // Fetch the SVG source and look for the label text inside it.
  const abs = new URL(src!, BASE).toString();
  const res = await page.request.get(abs);
  console.log(`[${info.project.name}] QR FETCH STATUS = ${res.status()} ${res.headers()["content-type"]}`);
  const svg = await res.text();
  console.log(`[${info.project.name}] QR SVG BYTES = ${svg.length}`);
  const texts = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].trim());
  console.log(`[${info.project.name}] QR SVG <text> NODES = ${JSON.stringify(texts)}`);
  expect(svg).toContain(label);
});

test("menu page groups by course and does not pill the available dishes", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${BASE}/menu`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${info.project.name}-menu.png`, fullPage: true });

  const dishes = page.locator('[data-testid="menu-dish"]');
  const dn = await dishes.count();
  const heads = page.locator("h2");
  const hn = await heads.count();
  const headTexts: string[] = [];
  for (let i = 0; i < hn; i++) headTexts.push((await heads.nth(i).innerText()).trim());
  console.log(`[${info.project.name}] DISHES = ${dn}; H2 HEADINGS(${hn}) = ${JSON.stringify(headTexts)}`);

  // The old "On the menu" pill should be gone entirely.
  const onMenuPill = await page.getByText("On the menu", { exact: true }).count();
  const onDot = await page.getByText("● On", { exact: true }).count();
  console.log(`[${info.project.name}] "On the menu" PILLS = ${onMenuPill}; "● On" markers = ${onDot}`);

  // Report each dish's tail text so we can see what a card actually says.
  const sample: string[] = [];
  for (let i = 0; i < Math.min(dn, 8); i++) {
    sample.push((await dishes.nth(i).innerText()).replace(/\n/g, " | "));
  }
  console.log(`[${info.project.name}] DISH SAMPLE = ${JSON.stringify(sample, null, 1)}`);

  expect(dn).toBeGreaterThan(0);
  expect(onMenuPill).toBe(0);
});
