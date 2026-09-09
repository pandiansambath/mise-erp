import { expect, test, type Page } from "@playwright/test";

/** TEMPORARY verification spec for fbe2339 — delete after the run. */

const BASE = process.env.BASE_URL || "https://nirai1.dineai.cloud";
const OUT = "e2e-out/fbe2339";

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
  await page.waitForURL("**/dashboard", { timeout: 90_000 });
}

/** Every option row, as "label ⟨hint⟩". */
async function rows(page: Page): Promise<string[]> {
  const pop = page.locator('[role="listbox"]').last();
  return pop.locator('[role="option"]').evaluateAll((els) =>
    els.map((el) => {
      const spans = Array.from(el.querySelectorAll("span > span"));
      const label = spans[0]?.textContent?.trim() ?? el.textContent?.trim() ?? "";
      const hint = spans[1]?.textContent?.trim() ?? "";
      return hint ? `${label} ⟨${hint}⟩` : label;
    }),
  );
}

async function typeFilter(page: Page, text: string) {
  const box = page.locator('[role="listbox"]').last().locator('input[aria-label="Filter the list"]');
  await box.fill("");
  if (text) await box.fill(text);
  await page.waitForTimeout(350);
}

test("a) + b) the currency picker: 47 options, search by country, and the honesty note", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await signIn(page);

  const trigger = page
    .locator('button[aria-haspopup="listbox"]')
    .filter({ hasText: /GBP|INR|USD|EUR/ })
    .first();
  await expect(trigger).toBeVisible({ timeout: 30_000 });

  const box = await trigger.boundingBox();
  console.log(`TRIGGER TEXT: ${JSON.stringify((await trigger.innerText()).trim())}`);
  console.log(`TRIGGER WIDTH: ${box?.width}px  HEIGHT: ${box?.height}px`);

  await page.screenshot({ path: `${OUT}/a0-header-closed.png` });

  await trigger.click();
  const pop = page.locator('[role="listbox"]').last();
  await expect(pop).toBeVisible({ timeout: 15_000 });

  const all = await rows(page);
  console.log(`OPTION COUNT (unfiltered): ${all.length}`);
  console.log(`ALL OPTIONS:\n${all.join("\n")}`);

  const filterBox = pop.locator('input[aria-label="Filter the list"]');
  console.log(`FILTER BOX PRESENT: ${await filterBox.count()}`);
  if (await filterBox.count()) {
    console.log(`FILTER PLACEHOLDER: ${await filterBox.getAttribute("placeholder")}`);
  }

  const withHint = all.filter((r) => r.includes("⟨")).length;
  console.log(`ROWS WITH A SECOND LINE (hint): ${withHint} of ${all.length}`);

  // (b) THE HONESTY NOTE — is any "rates are approximate / books stay in base
  // currency" wording actually rendered inside the popover?
  const popText = (await pop.innerText()).replace(/\s+/g, " ");
  const noteRe = /approx|estimate|display only|for viewing|base currency|books|not.*dealing/i;
  console.log(`HONESTY NOTE FOUND IN POPOVER: ${noteRe.test(popText)}`);
  console.log(`POPOVER FULL TEXT (first 600 chars): ${popText.slice(0, 600)}`);
  // also check the whole page, in case it sits outside the listbox element
  const pageText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const nearby = pageText.match(/[^.]{0,120}(approximate|base currency|display only)[^.]{0,120}/i);
  console.log(`HONESTY-ISH TEXT ANYWHERE ON PAGE: ${nearby ? nearby[0] : "NONE"}`);

  await page.screenshot({ path: `${OUT}/a1-open-full-list.png` });

  await typeFilter(page, "india");
  const rIndia = await rows(page);
  console.log(`FILTER "india" → ${rIndia.length}: ${rIndia.join(" | ")}`);
  await page.screenshot({ path: `${OUT}/a2-india.png` });

  await typeFilter(page, "inr");
  const rInr = await rows(page);
  console.log(`FILTER "inr" → ${rInr.length}: ${rInr.join(" | ")}`);
  await page.screenshot({ path: `${OUT}/a3-inr.png` });

  await typeFilter(page, "dubai");
  const rDubai = await rows(page);
  console.log(`FILTER "dubai" → ${rDubai.length}: ${rDubai.join(" | ")}`);
  await page.screenshot({ path: `${OUT}/a4-dubai.png` });

  // Escape must close it WITHOUT switching the currency.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  console.log(`POPOVER STILL OPEN AFTER ESC: ${await pop.count()}`);
  console.log(`TRIGGER AFTER ESC: ${JSON.stringify((await trigger.innerText()).trim())}`);
  await page.screenshot({ path: `${OUT}/a5-after-escape.png` });

  console.log(`CONSOLE ERRORS (currency): ${errors.length}`);
  errors.forEach((e) => console.log(`  ERR: ${e.slice(0, 300)}`));

  expect(all.length).toBeGreaterThan(5);
});

test("c) + d) the rota Who picker: search, job titles, and it stays on screen", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await signIn(page);
  await page.goto(`${BASE}/rota`);
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator('[data-testid="rota-add"]')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);

  await page.locator('[data-testid="rota-add"]').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/c0-add-sheet.png` });

  // The Who select is the first select inside the Add-a-shift sheet.
  const who = page
    .locator("form")
    .filter({ hasText: "Who" })
    .locator('button[aria-haspopup="listbox"]')
    .first();
  await expect(who).toBeVisible({ timeout: 20_000 });
  await who.click();

  const pop = page.locator('[role="listbox"]').last();
  await expect(pop).toBeVisible({ timeout: 15_000 });

  const opts = await rows(page);
  console.log(`WHO OPTION COUNT: ${opts.length}`);
  console.log(`WHO OPTIONS:\n${opts.join("\n")}`);
  const withTitle = opts.filter((r) => r.includes("⟨"));
  console.log(`WHO ROWS WITH A JOB TITLE: ${withTitle.length}`);

  const filterBox = pop.locator('input[aria-label="Filter the list"]');
  const hasFilter = await filterBox.count();
  console.log(`WHO FILTER BOX PRESENT: ${hasFilter}`);

  // (d) does the popover run off the bottom?
  const vh = page.viewportSize()?.height ?? 0;
  const pb = await pop.boundingBox();
  console.log(
    `VIEWPORT HEIGHT: ${vh} | POPOVER top=${pb?.y} bottom=${(pb?.y ?? 0) + (pb?.height ?? 0)} height=${pb?.height}`,
  );
  const trg = await who.boundingBox();
  console.log(`WHO TRIGGER top=${trg?.y} bottom=${(trg?.y ?? 0) + (trg?.height ?? 0)}`);
  await page.screenshot({ path: `${OUT}/c1-who-open.png` });

  if (hasFilter) {
    // Type the first 3 letters of the second employee's name (skip "Choose…").
    const target = opts.find((o) => !/choose/i.test(o)) ?? "";
    const needle = target.split(/[\s⟨]/)[0].slice(0, 3);
    await typeFilter(page, needle);
    const filtered = await rows(page);
    console.log(`WHO FILTER "${needle}" → ${filtered.length}: ${filtered.join(" | ")}`);
    await page.screenshot({ path: `${OUT}/c2-who-filtered.png` });
    await typeFilter(page, "");
  }

  // Close without saving anything.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/c3-closed.png` });
  console.log(`ADD SHEET STILL OPEN: ${await page.getByText("Add a shift").count()}`);

  console.log(`CONSOLE ERRORS (rota): ${errors.length}`);
  errors.forEach((e) => console.log(`  ERR: ${e.slice(0, 300)}`));

  expect(opts.length).toBeGreaterThan(0);
});
