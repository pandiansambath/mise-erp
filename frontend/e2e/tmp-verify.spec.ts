import { test, expect, type Page, type Browser } from "@playwright/test";

/** TEMPORARY — verification of commit e85e342 ("one popstate, three listeners")
 *  on the live box. Deleted / restored after reporting. Not meant to be kept. */

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
  await page.waitForURL("**/dashboard", { timeout: 120_000 });
}

/** Every open sheet, in z-order: what it is called, how deep it sits, how wide
 *  it is. A claim about "which layer closed" has to be a value, not a squint. */
type Sheet = { label: string; z: number; width: number; left: number; hasBack: boolean };
async function sheets(page: Page): Promise<Sheet[]> {
  return page.evaluate(() => {
    const out: Sheet[] = [] as never;
    for (const d of Array.from(document.querySelectorAll('[role="dialog"]'))) {
      const el = d as HTMLElement;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      out.push({
        label: el.getAttribute("aria-label") ?? "?",
        z: Number(getComputedStyle(el).zIndex) || 0,
        width: Math.round(r.width),
        left: Math.round(r.left),
        hasBack: !!el.querySelector('button[aria-label="Back"]'),
      } as never);
    }
    (out as Sheet[]).sort((a, b) => a.z - b.z);
    return out;
  });
}

const names = (s: Sheet[]) => s.map((x) => `${x.label}(z${x.z},w${x.width})`).join(" > ");

/** The deepest open sheet — the one a ✕ / ← / Escape is aimed at. */
function top(page: Page) {
  return page.locator('[role="dialog"].z-\\[88\\]');
}

/** Instrument history so a wrong-layer close can say WHY. */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __hist: string[] };
    w.__hist = [];
    const back = history.back.bind(history);
    history.back = function () {
      w.__hist.push(`history.back()`);
      return back();
    };
    const push = history.pushState.bind(history);
    history.pushState = function (s: unknown, t: string, u?: string | URL | null) {
      w.__hist.push(`pushState`);
      return push(s, t, u);
    };
    window.addEventListener("popstate", () => w.__hist.push("popstate delivered"));
  });
}
const hist = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __hist: string[] };
    const h = [...(w.__hist ?? [])];
    w.__hist = [];
    return h;
  });

/** Open a supplier that actually prices things, and return its category tiles. */
async function openSupplier(page: Page, wantCat?: RegExp) {
  await page.goto(`${BASE}/vendors`);
  await page.waitForTimeout(6000);
  const cards = page.locator("button:has-text('Manage →')");
  const n = await cards.count();
  console.log(`SUPPLIER CARDS: ${n}`);
  await page.screenshot({ path: "e2e-out/a-00-vendors.png", fullPage: true });
  for (let i = 0; i < n; i++) {
    const txt = await cards.nth(i).innerText().catch(() => "");
    await cards.nth(i).click();
    await page.waitForTimeout(3000);
    const tiles = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return [];
      return Array.from(d.querySelectorAll("button"))
        .map((b) => (b as HTMLElement).innerText.trim())
        .filter((t) => /\d+ priced$/.test(t))
        .map((t) => {
          const lines = t.split("\n").map((x) => x.trim()).filter(Boolean);
          return {
            name: lines[lines.length - 2] ?? "",
            count: Number((lines[lines.length - 1].match(/\d+/) ?? [0])[0]),
          };
        })
        .filter((x) => x.name);
    });
    const name =
      (await page.locator('[role="dialog"]').first().getAttribute("aria-label")) ??
      txt.split("\n")[0];
    console.log(`OPENED "${name}" (card: ${txt.split("\n")[0]}) — categories: ${JSON.stringify(tiles)}`);
    if (tiles.length > 0 && (!wantCat || tiles.some((t) => wantCat.test(t.name))))
      return { name, tiles };
    // Not the one — close and try the next.
    await page.locator('[role="dialog"] button[aria-label="Close"]').last().click();
    await page.waitForTimeout(1200);
  }
  return { name: "", tiles: [] as { name: string; count: number }[] };
}

/** Click the category tile inside the SUPPLIER sheet, by its name. */
async function openCategory(page: Page, cat: string) {
  const ok = await page.evaluate((c) => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return false;
    for (const b of Array.from(d.querySelectorAll("button"))) {
      const lines = (b as HTMLElement).innerText
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      if (lines.length >= 2 && lines[lines.length - 2] === c && /\d+ priced$/.test(lines[lines.length - 1])) {
        (b as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, cat);
  expect(ok, `found the "${cat}" tile in the supplier sheet`).toBe(true);
  await page.waitForTimeout(1800);
}

/** supplier > category > item. Opens whichever layers are missing. */
async function goThreeDeep(page: Page, cat: string) {
  let now = await sheets(page);
  expect(now.length, `a supplier sheet to start from — ${names(now)}`).toBeGreaterThan(0);
  if (now.length === 1) await openCategory(page, cat);
  now = await sheets(page);
  expect.soft(now.length, `two sheets after opening ${cat} — ${names(now)}`).toBe(2);
  // First item card inside the category sheet.
  await page.locator('[role="dialog"].z-\\[80\\] div[role="button"]').first().click();
  await page.waitForTimeout(1800);
  const three = await sheets(page);
  expect.soft(three.length, `three sheets after opening an item — ${names(three)}`).toBe(3);
  return three;
}

/* ───────────────────────── a) + b) + c) the vendor stack ────────────────── */

test("a,b,c — three layers: X, back and Escape each step back exactly one", async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(900_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await instrument(page);
  await signIn(page);

  const sup = await openSupplier(page);
  expect(sup.name, "a supplier with priced items").not.toBe("");
  await page.screenshot({ path: "e2e-out/a-01-supplier-sheet.png", fullPage: false });
  const cat = sup.tiles.find((t) => t.count >= 3)?.name ?? sup.tiles[0].name;
  console.log(`CATEGORY UNDER TEST: ${cat}`);

  // ── ✕ three times ────────────────────────────────────────────────────────
  for (let round = 1; round <= 3; round++) {
    const three = await goThreeDeep(page, cat);
    console.log(`X ROUND ${round} — three open: ${names(three)}`);
    if (round === 1) {
      await page.screenshot({ path: "e2e-out/a-02-three-open.png" });
      // (b) the depth-3 panel must be WIDER than the depth-2 under it.
      const d2 = three.find((s) => s.z === 80)!;
      const d3 = three.find((s) => s.z === 88)!;
      console.log(`WIDTHS — depth1=${three[0].width} depth2=${d2.width} depth3=${d3.width}`);
      expect.soft(d3.width, `depth-3 (${d3.width}) wider than depth-2 (${d2.width})`).toBeGreaterThan(
        d2.width,
      );
    }
    await hist(page);
    await top(page).locator('button[aria-label="Close"]').click();
    await page.waitForTimeout(2200);
    const after = await sheets(page);
    console.log(`X ROUND ${round} — after ✕: ${names(after)} | history: ${JSON.stringify(await hist(page))}`);
    if (round === 1) await page.screenshot({ path: "e2e-out/a-03-after-close.png" });
    expect.soft(after.length, `✕ left TWO sheets, not ${after.length} — ${names(after)}`).toBe(2);
    expect.soft(after[1]?.label, "the CATEGORY is the one in front now").toBe(cat);
  }

  // ── ← three times ────────────────────────────────────────────────────────
  for (let round = 1; round <= 3; round++) {
    const three = await goThreeDeep(page, cat);
    expect.soft(three[2].hasBack, "the price sheet has a ← to the category").toBe(true);
    await hist(page);
    await top(page).locator('button[aria-label="Back"]').click();
    await page.waitForTimeout(2200);
    const after = await sheets(page);
    console.log(`BACK ROUND ${round} — after ←: ${names(after)} | history: ${JSON.stringify(await hist(page))}`);
    if (round === 1) await page.screenshot({ path: "e2e-out/a-04-after-back.png" });
    expect.soft(after.length, `← left TWO sheets — ${names(after)}`).toBe(2);
    expect.soft(after[1]?.label, "the CATEGORY is in front").toBe(cat);
  }

  // ── Escape three times ───────────────────────────────────────────────────
  for (let round = 1; round <= 3; round++) {
    const three = await goThreeDeep(page, cat);
    await hist(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2200);
    const after = await sheets(page);
    console.log(`ESC ROUND ${round} — after Escape: ${names(after)} | history: ${JSON.stringify(await hist(page))}`);
    if (round === 1) await page.screenshot({ path: "e2e-out/a-05-after-escape.png" });
    expect.soft(after.length, `Escape closed ONLY the top sheet — ${names(after)}`).toBe(2);
    expect.soft(after[0]?.label, "the SUPPLIER is still open underneath").toBe(sup.name);
    expect.soft(after[1]?.label, "the CATEGORY survived — Escape did not eat the middle").toBe(cat);
  }

  // Back to the page.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);

  // ── c) a category with exactly two items ─────────────────────────────────
  const two = await openSupplier(page, /Cleaning/i);
  const target =
    two.tiles.find((t) => /Cleaning/i.test(t.name) && t.count === 2) ??
    two.tiles.find((t) => t.count === 2);
  console.log(`TWO-ITEM CATEGORY: ${JSON.stringify(target)} of ${JSON.stringify(two.tiles)}`);
  if (target) {
    await openCategory(page, target.name);
    await page.waitForTimeout(1200);
    const s = await sheets(page);
    const panel = s.find((x) => x.z === 80)!;
    const cards = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"].z-\\[80\\]');
      if (!d) return { cards: [] as number[], gridRight: 0, panelRight: 0 };
      const grid = d.querySelector(".mise-stagger") as HTMLElement | null;
      const cs = Array.from(d.querySelectorAll('div[role="button"]')).map((c) =>
        Math.round(c.getBoundingClientRect().width),
      );
      return {
        cards: cs,
        gridRight: grid ? Math.round(grid.getBoundingClientRect().right) : 0,
        panelRight: Math.round((d as HTMLElement).getBoundingClientRect().right),
        columns: grid ? getComputedStyle(grid).gridTemplateColumns : "",
        lastCardRight: cs.length
          ? Math.round(
              (
                Array.from(d.querySelectorAll('div[role="button"]')).at(-1) as HTMLElement
              ).getBoundingClientRect().right,
            )
          : 0,
      };
    });
    console.log(
      `TWO-ITEM PANEL width=${panel.width} cards=${JSON.stringify(cards)}`,
    );
    await page.screenshot({ path: "e2e-out/c-01-two-item-category.png" });
    await top(page).count();
    expect.soft(panel.width, "a two-item category is not the full four-column panel").toBeLessThan(1000);
  } else {
    console.log("NO CATEGORY WITH EXACTLY TWO ITEMS FOUND");
    await page.screenshot({ path: "e2e-out/c-01-no-two-item-category.png", fullPage: true });
  }

  await ctx.close();
});

/* ───────────────────── d) the role builder page counter ─────────────────── */

async function counter(page: Page) {
  return page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll("p"));
    const lab = ps.find((p) => /pages they can open/i.test(p.textContent ?? ""));
    const val = lab?.nextElementSibling as HTMLElement | null;
    return { label: lab?.textContent ?? null, value: val?.textContent?.trim() ?? null };
  });
}

async function chipState(page: Page) {
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
              border: st.borderTopColor,
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
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

test("d — hiding a page moves the counter, read-only does not", async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(600_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);

  await page.goto(`${BASE}/staff`);
  await page.waitForTimeout(5000);
  const tab = page.getByRole("button", { name: /Roles & Access/i }).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: "e2e-out/d-01-roles.png", fullPage: true });

  const roleCard = page.locator('[role="button"]:has-text("A role you made")');
  const n = await roleCard.count();
  console.log(`CUSTOM ROLE CARDS: ${n}`);
  expect(n, "a hotel-made role to open").toBeGreaterThan(0);
  console.log("OPENING ROLE:", (await roleCard.first().innerText()).split("\n")[0]);
  await roleCard.first().click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: "e2e-out/d-02-role-open.png", fullPage: true });

  await page.evaluate(() => {
    const g = Array.from(document.querySelectorAll('[role="radiogroup"]')).find(
      (x) => x.getAttribute("aria-label") === "Sales & till",
    );
    g?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(1200);

  const group = page.locator('[role="radiogroup"][aria-label="Sales & till"]');
  const card = group.locator("xpath=../..");
  // Make sure the area is on "Can change" so the chips cycle three ways.
  const radio = group.getByRole("radio", { name: "Can change" });
  if ((await radio.getAttribute("aria-checked")) !== "true") {
    await radio.click();
    await page.waitForTimeout(900);
    await accept(page, /Set to/i);
    await page.waitForTimeout(1200);
  }

  const c0 = await counter(page);
  const s0 = await chipState(page);
  console.log(`COUNTER START: ${JSON.stringify(c0)}`);
  console.log(`CHIPS START: ${JSON.stringify(s0)}`);
  await page.screenshot({ path: "e2e-out/d-03-counter-start.png", fullPage: false });
  await card.screenshot({ path: "e2e-out/d-03b-card-start.png" });
  const start = Number((c0.value ?? "0 of 0").split(" of ")[0]);

  // ── HIDE a page: write → read → hidden, then confirm ─────────────────────
  await clickChip(page, "Online Orders"); // write → read-only
  await page.waitForTimeout(1200);
  const cRo = await counter(page);
  const sRo = await chipState(page);
  console.log(`COUNTER AFTER READ-ONLY: ${JSON.stringify(cRo)}`);
  console.log(`CHIPS AFTER READ-ONLY: ${JSON.stringify(sRo)}`);
  await card.screenshot({ path: "e2e-out/d-04-read-only.png" });
  await page.screenshot({ path: "e2e-out/d-04b-counter-read-only.png" });
  const ro = Number((cRo.value ?? "0 of 0").split(" of ")[0]);
  expect(ro, "read-only does NOT decrement — they can still open it").toBe(start);

  await clickChip(page, "Online Orders"); // read → hidden (asks)
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "e2e-out/d-05-hide-confirm.png" });
  await accept(page, /^Hide it$/);
  await page.waitForTimeout(1500);
  const cHid = await counter(page);
  const sHid = await chipState(page);
  console.log(`COUNTER AFTER HIDE: ${JSON.stringify(cHid)}`);
  console.log(`CHIPS AFTER HIDE: ${JSON.stringify(sHid)}`);
  await card.screenshot({ path: "e2e-out/d-06-hidden.png" });
  await page.screenshot({ path: "e2e-out/d-06b-counter-hidden.png" });
  const hid = Number((cHid.value ?? "0 of 0").split(" of ")[0]);
  expect(hid, `hiding a page DECREMENTS: ${start} → ${hid}`).toBe(start - 1);

  // Put it back, then leave WITHOUT saving.
  await clickChip(page, "Online Orders");
  await page.waitForTimeout(1000);
  await accept(page, /^Show it$/);
  await page.waitForTimeout(1200);
  console.log(`COUNTER RESTORED: ${JSON.stringify(await counter(page))}`);

  await page.locator('[aria-label="Close"]').filter({ visible: true }).last().click();
  await page.waitForTimeout(1500);
  await accept(page, /Discard|Leave|Yes|Close it/i);
  await page.screenshot({ path: "e2e-out/d-07-closed-unsaved.png", fullPage: true });
  console.log("CLOSED WITHOUT SAVING");
  await ctx.close();
});

/* ───────────────────────── e) the napkin ────────────────────────────────── */

async function tickets(page: Page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('li[id^="t-"]'));
    const out: {
      table: string;
      button: string | null;
      buttons: string[];
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
          button: r.querySelector("button")?.textContent?.trim() ?? null,
          buttons: Array.from(r.querySelectorAll("button")).map((b) =>
            (b.textContent ?? "").trim(),
          ),
          hasFood: !txt.includes("No food — they just need someone"),
          text: txt.replace(/\n/g, " | "),
        });
      }
    }
    return out;
  });
}

test("e — a request for water is ONE button, Done, and no 422", async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(900_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const patches: string[] = [];
  page.on("response", (r) => {
    if (/\/api\/ordering\/orders\//.test(r.url()) && r.request().method() === "PATCH") {
      patches.push(`${r.status()} ${r.url().split("/orders/")[1]}`);
    }
  });
  await signIn(page);

  // Find a free table's code.
  await page.goto(`${BASE}/tables`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: "e2e-out/e-00-tables.png", fullPage: true });
  const tiles = page.locator('[data-testid="table-tile"]');
  const total = await tiles.count();
  let code = "";
  let label = "";
  for (let i = 0; i < total; i++) {
    const txt = await tiles.nth(i).innerText().catch(() => "");
    if (!/\bFree\b/.test(txt)) continue;
    await tiles.nth(i).click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const sub = await page
      .locator("text=/\\bcode\\s+[A-Za-z0-9]+/")
      .first()
      .innerText()
      .catch(() => "");
    const m = sub.match(/code\s+([A-Za-z0-9]+)/);
    const nm = await page
      .locator('[role="dialog"] h2, [role="dialog"] p.font-display')
      .first()
      .innerText()
      .catch(() => "");
    await page.locator('[aria-label="Close"]').filter({ visible: true }).last().click().catch(() => {});
    await page.waitForTimeout(900);
    if (m) {
      code = m[1];
      label = nm.trim();
      break;
    }
  }
  console.log(`FREE TABLE: ${label} code=${code}`);
  expect(code, "a free table with a code").not.toBe("");

  const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await anon.newPage();
  await guest.goto(`${BASE}/t/${code}`);
  await guest.waitForTimeout(4500);
  await guest.screenshot({ path: "e2e-out/e-01-guest.png" });
  await guest.getByRole("button", { name: /Ask/ }).first().click();
  await guest.waitForTimeout(1200);
  await guest.getByPlaceholder("Something else…").fill("need water please");
  await guest.getByRole("button", { name: /^Send$/ }).click();
  await guest.waitForTimeout(3000);
  await guest.screenshot({ path: "e2e-out/e-02-guest-sent.png" });
  console.log("GUEST SENT: need water please");

  await page.goto(`${BASE}/kitchen`);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: "e2e-out/e-03-kitchen.png", fullPage: true });
  const after = await tickets(page);
  console.log("KITCHEN:", JSON.stringify(after, null, 1));
  const napkin = after.find((t) => t.text.includes("need water please"));
  console.log("NAPKIN TICKET:", JSON.stringify(napkin));
  expect(napkin, "the water request is on the pass").toBeTruthy();
  expect(napkin!.hasFood, "it carries no food").toBe(false);
  expect(napkin!.buttons.join("|"), "ONE button, reading Done").toBe("Done");

  const napkinCard = page.locator('li[id^="t-"]').filter({ hasText: "need water please" }).first();
  await napkinCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await napkinCard.screenshot({ path: "e2e-out/e-04-napkin-ticket.png" });

  patches.length = 0;
  await napkinCard.getByRole("button", { name: "Done" }).first().click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: "e2e-out/e-05-after-done.png", fullPage: true });
  console.log("PATCHES:", JSON.stringify(patches));
  expect(patches.length, "Done sent a PATCH").toBeGreaterThan(0);
  expect(
    patches.some((p) => p.startsWith("422")),
    "no 422 from Done",
  ).toBe(false);
  const gone = await tickets(page);
  expect(
    gone.some((t) => t.text.includes("need water please")),
    "the request left the pass",
  ).toBe(false);

  await anon.close();
  await ctx.close();
});
