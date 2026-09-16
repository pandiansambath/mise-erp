import { test, type Page } from "@playwright/test";

const OUT =
  "C:/Users/pandi/AppData/Local/Temp/claude/c--pandi-project-nirai-try1/b2b5b43d-8ddb-48ca-be6f-f1ae1e7d2215/scratchpad/qa45";

async function signIn(page: Page) {
  await page.goto("/login");
  await page
    .locator('#li-email:visible, [data-testid="login-email"]:visible')
    .first()
    .fill("control@mise.app");
  await page
    .locator('#li-password:visible, [data-testid="login-password"]:visible')
    .first()
    .fill("Control@2026");
  await page.locator('button[type="submit"]:visible').first().click();
  await page.waitForTimeout(6000);
  console.log("AFTER LOGIN URL:", page.url());
}

async function gotoMoneyByNav(page: Page) {
  const link = page.locator('a[href="/control-room/money"]:visible').first();
  await link.scrollIntoViewIfNeeded().catch(() => {});
  await link.click();
  await page.waitForTimeout(9000);
  console.log("MONEY URL:", page.url());
}

function heroOf(page: Page) {
  return page
    .locator("p.font-display")
    .first()
    .innerText()
    .catch(() => "<no hero>");
}

test("qa45 desktop 1280x800", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await gotoMoneyByNav(page);

  const dump = async (tag: string) => {
    const t = await page.evaluate(() => document.body.innerText);
    console.log("=== PAGE TEXT [" + tag + "] ===\n" + t + "\n=== END [" + tag + "] ===");
  };

  const m1280 = await page.evaluate(() => ({
    sh: document.documentElement.scrollHeight,
    ih: window.innerHeight,
    bodySh: document.body.scrollHeight,
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }));
  console.log("HEIGHT 1280x800:", JSON.stringify(m1280));
  await page.screenshot({ path: OUT + "/d1280-viewport.png" });
  await page.screenshot({ path: OUT + "/d1280-full.png", fullPage: true });
  await dump("1280 initial");

  const chips = page.locator("button[aria-pressed]");
  const nChips = await chips.count();
  console.log("MONTH CHIPS:", nChips);
  for (let i = 0; i < nChips; i++) {
    const txt = (await chips.nth(i).innerText()).replace(/\n/g, " | ");
    const pressed = await chips.nth(i).getAttribute("aria-pressed");
    console.log("CHIP[" + i + "] pressed=" + pressed + " text=" + JSON.stringify(txt));
  }

  const heroBefore = await heroOf(page);
  console.log("HERO BEFORE:", JSON.stringify(heroBefore));

  const jul = chips.filter({ hasText: /Jul/ }).first();
  if (await jul.count()) {
    await jul.click();
    await page.waitForTimeout(7000);
    const heroJul = await heroOf(page);
    console.log("HERO AFTER JUL:", JSON.stringify(heroJul));
    console.log("CHANGED(jul):", heroJul !== heroBefore);
    await page.screenshot({ path: OUT + "/d1280-jul.png" });
    await dump("after Jul");
  } else {
    console.log("NO JUL CHIP FOUND");
  }

  const all = chips.filter({ hasText: /All \d+ month/ }).first();
  if (await all.count()) {
    await all.click();
    await page.waitForTimeout(7000);
    const heroAll = await heroOf(page);
    console.log("HERO AFTER ALL:", JSON.stringify(heroAll));
    await page.screenshot({ path: OUT + "/d1280-all.png" });
    await page.screenshot({ path: OUT + "/d1280-all-full.png", fullPage: true });
    await dump("after All");
    const mAll = await page.evaluate(() => ({
      sh: document.documentElement.scrollHeight,
      ih: window.innerHeight,
    }));
    console.log("HEIGHT 1280x800 (all selected):", JSON.stringify(mAll));
  } else {
    console.log("NO ALL CHIP FOUND");
  }

  const sep = chips.filter({ hasText: /Sep/ }).first();
  if (await sep.count()) {
    await sep.click();
    await page.waitForTimeout(6000);
    console.log("HERO BACK ON SEP:", JSON.stringify(await heroOf(page)));
  }

  const rows = page.locator("table tbody tr");
  const nRows = await rows.count();
  console.log("TABLE ROWS:", nRows);
  for (let i = 0; i < nRows; i++) {
    const t = (await rows.nth(i).innerText()).replace(/\n/g, " | ");
    console.log("ROW[" + i + "]: " + JSON.stringify(t));
  }

  const billBlock = page.locator("div.mise-card-inset, section, div").filter({ hasText: "By service" });
  const lineRows = page.locator("button.mise-press.relative");
  const nLines = await lineRows.count();
  console.log("BILL LINE BUTTONS:", nLines);
  for (let i = 0; i < nLines; i++) {
    const t = (await lineRows.nth(i).innerText()).replace(/\n/g, " | ");
    console.log("LINE[" + i + "]: " + JSON.stringify(t));
  }
  void billBlock;

  const unnamed = page.getByText(/lines? we cannot name/i).first();
  if (await unnamed.count()) {
    const info = await unnamed.evaluate((el) => ({
      text: (el as HTMLElement).innerText,
      cls: el.className,
      colour: getComputedStyle(el).color,
    }));
    console.log("UNNAMED LINE:", JSON.stringify(info));
  } else {
    console.log("NO 'we cannot name' SENTENCE FOUND");
  }

  const runway = page.getByText(/Runs out around/i).first();
  console.log("RUNWAY COUNT:", await runway.count());
  if (await runway.count()) console.log("RUNWAY TEXT:", JSON.stringify(await runway.innerText()));

  const setIt = page.locator("button").filter({ hasText: /^(Set it|Change)$/ }).first();
  console.log("CREDIT CONTROL COUNT:", await setIt.count());
  if (await setIt.count()) {
    await setIt.click();
    await page.waitForTimeout(1200);
    console.log(
      "BALANCE INPUTS:",
      await page.locator('input[inputmode="decimal"]').count(),
      "DATE INPUTS:",
      await page.locator('input[type="date"]').count(),
    );
    console.log("NO-API NOTE COUNT:", await page.getByText(/AWS has no API for this date/i).count());
    await page.screenshot({ path: OUT + "/d1280-credit-open.png" });
    const close = page.locator("button").filter({ hasText: /^Close$/ }).first();
    if (await close.count()) await close.click();
    await page.waitForTimeout(600);
    console.log("AFTER CLOSE date inputs:", await page.locator('input[type="date"]').count());
  }

  await page.screenshot({ path: OUT + "/d1280-final.png" });
});

test("qa45 desktop 1920x1080", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await signIn(page);
  await gotoMoneyByNav(page);
  const m = await page.evaluate(() => ({
    sh: document.documentElement.scrollHeight,
    ih: window.innerHeight,
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }));
  console.log("HEIGHT 1920x1080:", JSON.stringify(m));
  await page.screenshot({ path: OUT + "/d1920-viewport.png" });
  await page.screenshot({ path: OUT + "/d1920-full.png", fullPage: true });
  const t = await page.evaluate(() => document.body.innerText);
  console.log("=== PAGE TEXT [1920] ===\n" + t + "\n=== END ===");
});

test("qa45 phone 390x844", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await gotoMoneyByNav(page);
  const m = await page.evaluate(() => ({
    sh: document.documentElement.scrollHeight,
    ih: window.innerHeight,
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }));
  console.log("HEIGHT 390x844:", JSON.stringify(m), "SCREENS:", (m.sh / m.ih).toFixed(2));
  await page.screenshot({ path: OUT + "/m390-viewport.png" });
  await page.screenshot({ path: OUT + "/m390-full.png", fullPage: true });

  const cells = page.locator("table tbody tr td");
  const nCells = await cells.count();
  console.log("MOBILE TD COUNT:", nCells);
  for (let i = 0; i < Math.min(nCells, 30); i++) {
    const info = await cells.nth(i).evaluate((el) => {
      const cs = getComputedStyle(el, "::before");
      return {
        label: el.getAttribute("data-label"),
        beforeContent: cs.content,
        beforeDisplay: cs.display,
        text: (el as HTMLElement).innerText.replace(/\n/g, " / "),
        w: Math.round((el as HTMLElement).getBoundingClientRect().width),
      };
    });
    console.log("TD[" + i + "] " + JSON.stringify(info));
  }

  const steps = Math.ceil(m.sh / m.ih);
  for (let i = 0; i < Math.min(steps + 1, 7); i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 720);
    await page.waitForTimeout(800);
    await page.screenshot({ path: OUT + "/m390-s" + i + ".png" });
  }
  const t = await page.evaluate(() => document.body.innerText);
  console.log("=== PAGE TEXT [390] ===\n" + t + "\n=== END ===");
});
