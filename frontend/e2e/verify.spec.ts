// Cross-check the open-feedback list against the LIVE site.
//
// He asked for exactly this: "do one cross verification with the task md files
// you created with the live site, whether you completed all tasks or not."
// So each assertion below names an item from docs/PURCHASING_FEEDBACK_OPEN.md
// and proves it on his own tenant, rather than trusting my own notes.
import { test, expect, type Page } from "@playwright/test";

const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";
const S = "e2e/__screens__/verify";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('[data-testid="login-email"]:visible').first().fill(EMAIL);
  await page.locator('[data-testid="login-password"]:visible').first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(2500);
}

test("the open list, checked against the live page", async ({ page }) => {
  test.setTimeout(300_000);
  const w = page.viewportSize()?.width ?? 0;
  const results: string[] = [];
  const ok = (item: string, pass: boolean, detail = "") =>
    results.push(`${pass ? "DONE" : "OPEN"}  ${item}${detail ? " — " + detail : ""}`);

  await login(page);
  await page.goto("/purchasing");
  await page.getByTestId("category-tile").first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(800);

  // 1b — the stripe is neutral again, not a colour per category
  const tints = await page.getByTestId("category-tile").evaluateAll((els) =>
    els.map((el) => {
      const stripe = el.querySelector("span[aria-hidden]") as HTMLElement;
      return stripe ? getComputedStyle(stripe).backgroundColor : "";
    }),
  );
  const distinct = new Set(tints.filter(Boolean));
  ok("1b neutral stripes", distinct.size <= 1, `${distinct.size} distinct colour(s)`);

  // 1a — the card shows a shadow ABOVE it (turned to face right)
  const shadow = await page
    .getByTestId("category-tile")
    .first()
    .evaluate((el) => getComputedStyle(el).boxShadow);
  ok("1a shadow above + left", /-\d+px\s+-?\d+px|0px -\d+px/.test(shadow), shadow.slice(0, 46));

  // 4 — scrolling collapses the header to ONE row.
  //
  // Checked on the INDENTS tab, not the order pad: the pad now fits the screen
  // (783px of content in a 737px box, which is the header reclaim working), so
  // there is nothing to scroll past and nothing to prove. A list of indents is
  // where a person actually scrolls.
  await page.getByRole("button", { name: /^Indents/ }).first().click();
  await page.waitForTimeout(2200);
  const before = await page.evaluate(() => {
    const r = document.querySelector(".mise-bench-rail") as HTMLElement;
    return r ? Math.round(r.getBoundingClientRect().height) : -1;
  });
  // Show EVERYTHING first. With ten rows the list is barely taller than the
  // box, so there is nothing to scroll past and the rail correctly stays open —
  // which looked like a failure three times before I measured it. 4200px of
  // content is a fair test; 783px is not.
  await page.getByRole("button", { name: "all", exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  // Scroll whichever thing actually scrolls. At lg it is <main>; below lg the
  // DOCUMENT scrolls, because AppShell only turns main into a scroller at lg.
  // Driving the wrong one is why this reported OPEN on the phone while working.
  await page.evaluate(() => {
    const m = document.querySelector("main");
    if (m && m.scrollHeight > m.clientHeight + 40) m.scrollTop = 1500;
    else window.scrollTo(0, 1500);
  });
  await page.waitForTimeout(1000);
  const condensed = await page.evaluate(
    () => document.querySelector(".mise-bench-rail")?.getAttribute("data-condensed"),
  );
  const after = await page.evaluate(() => {
    const r = document.querySelector(".mise-bench-rail") as HTMLElement;
    return r ? Math.round(r.getBoundingClientRect().height) : -1;
  });
  ok("4 header shrinks on scroll", after < before, `${before}px -> ${after}px, condensed=${condensed}`);
  await page.screenshot({ path: `${S}/${w}-condensed.png` });
  await page.evaluate(() => {
    const m = document.querySelector("main");
    if (m) m.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(700);

  // 2 / 6b / 7.1 / 7.2 — the controls are made of the page, not flat outlines
  await page.waitForTimeout(400);
  const sortStyled = await page
    .locator("select:visible")
    .first()
    .evaluate((el) => el.className.includes("mise-btn"));
  ok("7.2 sort dropdown restyled", sortStyled);
  const chipHint = await page
    .locator("button:visible", { hasText: /Stuck/ })
    .first()
    .getAttribute("title")
    .catch(() => null);
  ok("6 'Stuck' explains itself", !!chipHint && chipHint.length > 40, (chipHint ?? "none").slice(0, 50));
  await page.screenshot({ path: `${S}/${w}-indents.png` });

  // 8 — a PENDING indent's sheet shows cost and suppliers, not dashes
  const pending = page.locator("[aria-expanded]").filter({ hasText: /item/ }).first();
  await pending.click();
  await page.waitForTimeout(1600);
  const sheet = (await page.locator("[role=dialog]").last().innerText()).replace(/\s+/g, " ");
  ok("8 pending indent has detail", !/VALUE — /i.test(sheet), sheet.slice(0, 60));
  await page.screenshot({ path: `${S}/${w}-indent-sheet.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // 7 / receive-all — the run header carries icon actions, not crowded labels
  await page.getByRole("button", { name: /^Orders/ }).first().click();
  await page.waitForTimeout(2200);
  const seeEverything = await page.locator("button:visible", { hasText: "See everything" }).count();
  ok("7 'See everything' gone", seeEverything === 0);
  const receiveAll = await page.getByRole("button", { name: /Receive this whole purchase/ }).count();
  ok("receive-all present", receiveAll > 0, `${receiveAll} run(s)`);
  await page.screenshot({ path: `${S}/${w}-orders.png` });

  // 3 — an empty filtered list explains itself instead of looking deleted
  await page.locator("input:visible").first().fill("zzzz-no-such-order");
  await page.waitForTimeout(900);
  const emptyText = (await page.locator("text=/hiding/").count()) > 0;
  ok("3 empty list explains the filters", emptyText);
  await page.screenshot({ path: `${S}/${w}-empty.png` });

  console.log("\n=== CROSS-CHECK (" + w + "px) ===");
  for (const r of results) console.log("  " + r);
  const open = results.filter((r) => r.startsWith("OPEN"));
  console.log(`  ${results.length - open.length}/${results.length} verified\n`);
  expect(open, `still open: ${open.join("; ")}`).toHaveLength(0);
});
