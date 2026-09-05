import { test } from "@playwright/test";

// "I guess it's not only for rota — this kind of issue will come on all pages."
//
// He is right, and guessing which pages is not the way to find out. This walks
// every page the voice can be sent to and reports what a fill would actually
// find there: how many reachable inputs, and whether the real form is hidden
// behind an "Add" button that has to be pressed first.

const BASE = "https://nirai1.dineai.cloud";
const PAGES = [
  "sales", "expenses", "inventory", "purchasing", "vendors", "rota",
  "attendance", "payroll", "waste", "stock-take", "recipes", "employees",
];

test("what a fill can actually reach, page by page", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
    } catch {
      /* ignore */
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  const rows: Record<string, unknown>[] = [];
  for (const slug of PAGES) {
    await page.goto(`${BASE}/${slug}`);
    await page.waitForTimeout(2200);
    const r = await page.evaluate(() => {
      const vis = (el: Element) => (el as HTMLElement).offsetParent !== null;
      const inputs = [...document.querySelectorAll("input, select, textarea")]
        .filter(vis)
        .filter((el) => !el.closest(".mise-voice-card"))
        .filter((el) => el.getAttribute("type") !== "hidden");
      const named = inputs
        .map((el) => {
          let node: Element | null = el;
          for (let i = 0; i < 4 && node; i += 1) {
            node = node.parentElement;
            const lab = node?.querySelector(":scope > label");
            if (lab?.textContent) return lab.textContent.trim();
          }
          return (
            el.getAttribute("placeholder") ||
            el.getAttribute("aria-label") ||
            el.getAttribute("name") ||
            ""
          ).trim();
        })
        .filter(Boolean);
      // Anything that looks like it would REVEAL a form.
      const openers = [...document.querySelectorAll("button, a")]
        .filter(vis)
        .map((b) => (b.textContent || "").trim())
        .filter((t) => /^(\+|add|new|create|record|log)\b/i.test(t) || t === "+")
        .slice(0, 4);
      const combos = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].filter(vis)
        .length;
      return { inputs: inputs.length, combos, named: named.slice(0, 6), openers };
    });
    rows.push({ page: slug, ...r });
    console.log(
      `${slug.padEnd(12)} inputs=${String(r.inputs).padEnd(3)} dropdowns=${String(r.combos).padEnd(2)} ` +
        `openers=${JSON.stringify(r.openers)} fields=${JSON.stringify(r.named)}`,
    );
  }
  console.log("SURVEY_JSON", JSON.stringify(rows));
});
