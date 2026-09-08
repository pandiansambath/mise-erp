import { test, expect, type Page, type Browser } from "@playwright/test";

/** TEMPORARY — verification of commit 58df877 ("nobody cooks a napkin") on the
 *  live box. Delete after reporting. Nothing here is meant to be committed. */

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
  await page.waitForURL("**/dashboard", { timeout: 90_000 });
}

/** Every ticket row on /kitchen, read out of the DOM: the table it belongs to,
 *  what it says, whether it carries food, and what its one button reads. A
 *  claim about a button has to be a value, not a squint at a screenshot. */
async function tickets(page: Page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('li[id^="t-"]'));
    const out: {
      table: string;
      round: string;
      button: string | null;
      hasFood: boolean;
      text: string;
    }[] = [];
    for (const card of cards) {
      const table = (card.querySelector("p.font-display")?.textContent ?? "").trim();
      const body = card.querySelector("div.flex-1");
      const rounds = body ? Array.from(body.children) : [];
      for (const r of rounds) {
        const txt = (r as HTMLElement).innerText || "";
        out.push({
          table,
          round: txt.split("\n")[0] ?? "",
          button: r.querySelector("button")?.textContent?.trim() ?? null,
          hasFood: !txt.includes("No food — they just need someone"),
          text: txt.replace(/\n/g, " | "),
        });
      }
    }
    return out;
  });
}

/** How wide the page really is against the window it is in. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const offenders: string[] = [];
    if (de.scrollWidth > de.clientWidth) {
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > de.clientWidth + 1 || r.left < -1) {
          const e = el as HTMLElement;
          offenders.push(
            `${e.tagName}.${(e.className || "").toString().slice(0, 70)} ` +
              `left=${Math.round(r.left)} right=${Math.round(r.right)}`,
          );
        }
      }
    }
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      innerWidth: window.innerWidth,
      offenders: offenders.slice(0, 12),
    };
  });
}

/** Table codes, read the way a human reads them: open the table's sheet and
 *  look at the subtitle ("N seats · code XXXX"). */
async function tableCodes(page: Page, want: number) {
  await page.goto(`${BASE}/tables`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: "e2e-out/v-00-tables.png", fullPage: true });
  const cards = page.locator('[data-testid="table-tile"]');
  const codes: { label: string; code: string; free: boolean }[] = [];
  const total = await cards.count();
  console.log(`TABLE TILES SEEN: ${total}`);
  // Free tables first — a message only makes its OWN ticket when the table has
  // nothing live on it; otherwise it lands on the existing order.
  const order: number[] = [];
  for (let i = 0; i < total; i++) {
    const txt = await cards.nth(i).innerText();
    if (/\bFree\b/.test(txt)) order.unshift(i);
    else order.push(i);
  }
  for (const i of order.slice(0, 14)) {
    if (codes.length >= want) break;
    const tileText = await cards.nth(i).innerText().catch(() => "");
    await cards.nth(i).click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const sub = await page.locator("text=/\\bcode\\s+[A-Za-z0-9]+/").first().innerText().catch(() => "");
    const m = sub.match(/code\s+([A-Za-z0-9]+)/);
    const label = await page
      .locator('[role="dialog"] h2, [role="dialog"] p.font-display')
      .first()
      .innerText()
      .catch(() => `#${i}`);
    if (m) codes.push({ label: label.trim(), code: m[1], free: /\bFree\b/.test(tileText) });
    await page.locator('[aria-label="Close"]').filter({ visible: true }).last().click().catch(() => {});
    await page.waitForTimeout(900);
  }
  console.log("TABLE CODES:", JSON.stringify(codes));
  return codes;
}

test("58df877 live verification", async ({ browser }) => {
  test.setTimeout(900_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Every PATCH the kitchen sends, with its status — this is where a 422 would
  // show up, and a 422 is exactly what the old code did.
  const patches: string[] = [];
  page.on("response", (r) => {
    if (/\/api\/ordering\/orders\//.test(r.url()) && r.request().method() === "PATCH") {
      patches.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });

  await signIn(page);

  // ── table codes ───────────────────────────────────────────────────────────
  const codes = await tableCodes(page, 3);
  expect(codes.length, "at least two table codes to work with").toBeGreaterThan(1);

  // Pick tables with nothing live on them, so the message creates its OWN
  // ticket rather than attaching to an existing order.
  await page.goto(`${BASE}/kitchen`);
  await page.waitForTimeout(6000);
  const before = await tickets(page);
  console.log("KITCHEN BEFORE:", JSON.stringify(before, null, 1));
  const busy = new Set(before.map((t) => t.table));
  const free = codes.filter((c) => c.free && !busy.has(c.label));
  console.log("BUSY TABLES:", [...busy].join(", "), "| FREE:", JSON.stringify(free));
  const msgTable = free[0] ?? codes[0];
  const foodTable = free[1] ?? codes[1];
  console.log(`MESSAGE GOES TO ${msgTable.label} (${msgTable.code})`);
  console.log(`FOOD GOES TO ${foodTable.label} (${foodTable.code})`);

  // ── (a) the napkin: an anonymous diner asks for water ─────────────────────
  const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await anon.newPage();
  await guest.goto(`${BASE}/t/${msgTable.code}`);
  await guest.waitForTimeout(4000);
  await guest.screenshot({ path: "e2e-out/v-01-guest-table.png", fullPage: false });
  await guest.getByRole("button", { name: /Ask/ }).first().click();
  await guest.waitForTimeout(1200);
  await guest.getByPlaceholder("Something else…").fill("need water please");
  await guest.screenshot({ path: "e2e-out/v-02-guest-typed.png" });
  await guest.getByRole("button", { name: /^Send$/ }).click();
  await guest.waitForTimeout(2500);
  await guest.screenshot({ path: "e2e-out/v-03-guest-sent.png" });
  console.log("GUEST SENT: need water please");

  // ── (b) real food on a different table ────────────────────────────────────
  const guest2 = await anon.newPage();
  await guest2.goto(`${BASE}/t/${foodTable.code}`);
  await guest2.waitForTimeout(4000);
  const add = guest2.getByRole("button", { name: /^Add$/ }).first();
  await add.click({ timeout: 20_000 });
  await guest2.waitForTimeout(800);
  await guest2.screenshot({ path: "e2e-out/v-04-guest-food-basket.png" });
  await guest2.getByRole("button", { name: /Send to the kitchen/ }).click();
  await guest2.waitForTimeout(3500);
  await guest2.screenshot({ path: "e2e-out/v-05-guest-food-sent.png" });
  console.log("GUEST PLACED A FOOD ORDER");

  // ── the pass ──────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/kitchen`);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: "e2e-out/v-06-kitchen.png", fullPage: true });
  const after = await tickets(page);
  console.log("KITCHEN AFTER:", JSON.stringify(after, null, 1));

  const napkin = after.find((t) => t.text.includes("need water please"));
  console.log("NAPKIN TICKET:", JSON.stringify(napkin));
  expect(napkin, "the water request is on the pass").toBeTruthy();
  expect(napkin!.hasFood, "the request carries no food").toBe(false);
  expect(napkin!.button, "ONE button, reading Done").toBe("Done");

  const food = after.find((t) => t.table === foodTable.label && t.hasFood);
  console.log("FOOD TICKET:", JSON.stringify(food));
  expect(food, "the food order is on the pass").toBeTruthy();
  expect(food!.button, "real food is NOT one-press Done").not.toBe("Done");
  expect(food!.button, "real food starts at Accept").toBe("Accept");

  // Frame the two tickets side by side for the screenshot.
  const napkinCard = page.locator('li[id^="t-"]').filter({ hasText: "need water please" }).first();
  await napkinCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await napkinCard.screenshot({ path: "e2e-out/v-07-napkin-ticket.png" });
  const foodCard = page.locator('li[id^="t-"]').filter({ hasText: foodTable.label }).first();
  await foodCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await foodCard.screenshot({ path: "e2e-out/v-08-food-ticket.png" });

  // ── press Done and watch for a 422 ────────────────────────────────────────
  patches.length = 0;
  await napkinCard.getByRole("button", { name: "Done" }).first().click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: "e2e-out/v-09-after-done.png", fullPage: true });
  console.log("PATCHES:", JSON.stringify(patches));
  expect(patches.length, "the Done button sent a PATCH").toBeGreaterThan(0);
  expect(patches.some((p) => p.startsWith("422")), "no 422 from Done").toBe(false);
  expect(patches.every((p) => p.startsWith("200")), "every PATCH was 200").toBe(true);

  const cleared = await tickets(page);
  console.log("KITCHEN AFTER DONE:", JSON.stringify(cleared, null, 1));
  expect(
    cleared.some((t) => t.text.includes("need water please")),
    "the request left the pass",
  ).toBe(false);

  // ── (d) 390px, no sideways scroll ─────────────────────────────────────────
  const small = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sp = await small.newPage();
  await sp.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
    } catch {
      /* ignore */
    }
  });
  await signIn(sp);
  await sp.goto(`${BASE}/kitchen`);
  await sp.waitForTimeout(8000);
  const ov = await overflow(sp);
  console.log("OVERFLOW @390:", JSON.stringify(ov));
  await sp.screenshot({ path: "e2e-out/v-10-kitchen-390.png", fullPage: true });
  expect(ov.scrollWidth, "no horizontal overflow at 390px").toBeLessThanOrEqual(ov.clientWidth + 1);
  await small.close();

  // ── tidy up: walk the food ticket off the pass ────────────────────────────
  for (const label of ["Accept", "Start cooking", "Ready", "Served"]) {
    const b = page
      .locator('li[id^="t-"]')
      .filter({ hasText: foodTable.label })
      .first()
      .getByRole("button", { name: label, exact: true })
      .first();
    if (await b.isVisible().catch(() => false)) {
      await b.click().catch(() => {});
      await page.waitForTimeout(4000);
    }
  }
  await page.screenshot({ path: "e2e-out/v-11-kitchen-tidied.png", fullPage: true });
  console.log("PATCHES (incl. tidy):", JSON.stringify(patches));

  await anon.close();
  await ctx.close();
});

/* ── (c) the three-state page chips ──────────────────────────────────────── */

async function chips(page: Page) {
  return page.evaluate(() => {
    const group = Array.from(document.querySelectorAll('[role="radiogroup"]')).find(
      (g) => g.getAttribute("aria-label") === "Sales & till",
    );
    if (!group) return { found: false as const };
    let card: HTMLElement | null = group.parentElement as HTMLElement | null;
    for (let i = 0; i < 8 && card; i++) {
      const btns = Array.from(card.querySelectorAll("button")).filter((b) =>
        ["Sales & Cash", "Online Orders", "Money"].includes(
          (b.textContent || "").replace(/👁/g, "").trim(),
        ),
      );
      if (btns.length >= 3) {
        return {
          found: true as const,
          level:
            Array.from(group.querySelectorAll('[role="radio"]')).find(
              (r) => r.getAttribute("aria-checked") === "true",
            )?.textContent ?? null,
          chips: btns.map((b) => {
            const st = getComputedStyle(b);
            return {
              text: (b.textContent || "").trim(),
              eye: (b.textContent || "").includes("👁"),
              title: b.getAttribute("title"),
              lineThrough: st.textDecorationLine.includes("line-through"),
              color: st.color,
              borderColor: st.borderTopColor,
              background: st.backgroundColor,
            };
          }),
        };
      }
      card = card.parentElement as HTMLElement | null;
    }
    return { found: false as const };
  });
}

async function clickChip(page: Page, label: string) {
  await page.evaluate((lbl) => {
    const group = Array.from(document.querySelectorAll('[role="radiogroup"]')).find(
      (g) => g.getAttribute("aria-label") === "Sales & till",
    );
    let card: HTMLElement | null = group?.parentElement as HTMLElement | null;
    for (let i = 0; i < 8 && card; i++) {
      const btn = Array.from(card.querySelectorAll("button")).find(
        (b) => (b.textContent || "").replace(/👁/g, "").trim() === lbl,
      );
      if (btn) {
        (btn as HTMLElement).click();
        return;
      }
      card = card.parentElement as HTMLElement | null;
    }
  }, label);
}

async function accept(page: Page, name: RegExp) {
  const b = page.getByRole("button", { name }).filter({ visible: true }).first();
  if (await b.isVisible().catch(() => false)) {
    await b.click();
    await page.waitForTimeout(900);
    return true;
  }
  return false;
}

test("c) Sales & till page chips cycle three ways", async ({ browser }: { browser: Browser }) => {
  test.setTimeout(400_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);

  await page.goto(`${BASE}/staff`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: "e2e-out/c-01-staff.png", fullPage: true });

  const roleCard = page.locator('[role="button"]:has-text("A role you made")');
  const n = await roleCard.count();
  console.log(`CUSTOM ROLE CARDS: ${n}`);
  expect(n, "a hotel-made role to open").toBeGreaterThan(0);
  console.log("OPENING ROLE:", (await roleCard.first().innerText()).split("\n")[0]);
  await roleCard.first().click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: "e2e-out/c-02-role-open.png", fullPage: true });

  await page.evaluate(() => {
    const g = Array.from(document.querySelectorAll('[role="radiogroup"]')).find(
      (x) => x.getAttribute("aria-label") === "Sales & till",
    );
    g?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(1200);

  const found = await chips(page);
  expect(found.found, "the Sales & till card with its three page chips").toBe(true);

  const group = page.locator('[role="radiogroup"][aria-label="Sales & till"]');
  const card = page.locator('[role="radiogroup"][aria-label="Sales & till"]').locator("xpath=../..");
  await group.getByRole("radio", { name: "Can change" }).click();
  await page.waitForTimeout(1200);
  console.log("STATE 1 (can change):", JSON.stringify(await chips(page)));
  await card.screenshot({ path: "e2e-out/c-03-can-change.png" });

  await clickChip(page, "Online Orders");
  await page.waitForTimeout(1200);
  const s2 = await chips(page);
  console.log("STATE 2 (can only look):", JSON.stringify(s2));
  await card.screenshot({ path: "e2e-out/c-04-read-only.png" });
  const oo2 = s2.found ? s2.chips.find((x) => x.text.includes("Online Orders"))! : null;
  expect(oo2?.eye, "the read-only chip wears an eye").toBe(true);
  expect(oo2?.title ?? "").toContain("can only look");
  const sc2 = s2.found ? s2.chips.find((x) => x.text.includes("Sales & Cash"))! : null;
  expect(sc2?.eye, "its neighbour is untouched").toBe(false);

  await clickChip(page, "Online Orders");
  await page.waitForTimeout(900);
  await page.screenshot({ path: "e2e-out/c-05-hide-confirm.png" });
  await accept(page, /^Hide it$/);
  const s3 = await chips(page);
  console.log("STATE 3 (hidden):", JSON.stringify(s3));
  await card.screenshot({ path: "e2e-out/c-06-hidden.png" });
  const oo3 = s3.found ? s3.chips.find((x) => x.text.includes("Online Orders"))! : null;
  expect(oo3?.lineThrough, "the hidden chip is struck through").toBe(true);

  await clickChip(page, "Online Orders");
  await page.waitForTimeout(900);
  await accept(page, /^Show it$/);
  const s4 = await chips(page);
  console.log("STATE 4 (back to can change):", JSON.stringify(s4));
  await card.screenshot({ path: "e2e-out/c-07-back-to-write.png" });

  // LEAVE WITHOUT SAVING.
  await page.locator('[aria-label="Close"]').filter({ visible: true }).last().click();
  await page.waitForTimeout(1200);
  await accept(page, /Discard|Leave|Yes|Close it/i);
  await page.screenshot({ path: "e2e-out/c-08-closed-unsaved.png", fullPage: true });
  console.log("CLOSED WITHOUT SAVING");
  await ctx.close();
});
