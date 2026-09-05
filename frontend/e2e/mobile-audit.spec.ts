import { test } from "@playwright/test";

/**
 * Every page, at his phone's width, measured rather than eyeballed.
 *
 * The failure that matters is HORIZONTAL OVERFLOW: the page is wider than the
 * screen, so the whole thing slides sideways and a column of numbers hides off
 * the right edge. It is invisible on a laptop and the first thing you hit on a
 * phone.
 *
 * Reported, not asserted — this is a survey to decide what to fix, and a test
 * that fails on twenty pages at once tells you nothing about which is worst.
 */

const BASE = "https://nirai1.dineai.cloud";

const PAGES = [
  "/dashboard", "/inventory", "/purchasing", "/vendors", "/price-comparison",
  "/expenses", "/sales", "/money", "/reports", "/payroll", "/rota",
  "/attendance", "/employees", "/staff", "/documents", "/recipes", "/orders",
  "/waste", "/stock-take", "/menu", "/kitchen", "/tables", "/my", "/hiring",
  "/settings", "/party-order", "/messages", "/food-safety", "/allergens",
  "/audit", "/plan", "/how-it-works", "/ai-scan",
];

test("what overflows on a phone", async ({ page }) => {
  test.setTimeout(900_000);
  await page.addInitScript(() => {
    try { localStorage.setItem("mise.tour.done", "1"); } catch { /* */ }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  const bad: string[] = [];
  for (const path of PAGES) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2600);

      // ARE WE STILL LOGGED IN?
      //
      // A run during a container swap lost the session and every page redirected
      // to /login — so the audit dutifully measured the LOGIN screen twenty
      // times and reported "no overflow, three small taps", which was true of
      // the login page and told me nothing about the app. A measurement of the
      // wrong page is worse than no measurement, because it looks like an
      // answer.
      // Give auth time to resolve before deciding we were bounced.
      //
      // The first version checked 2.6s after domcontentloaded and called every
      // page a bounce — while a separate probe proved the session was fine
      // (token present, expiring hours later, no 401 anywhere). It was catching
      // the moment BEFORE auth resolves, when the app is briefly on /login.
      //
      // A false alarm is better than the false all-clear it replaced, but it is
      // still a test that lies. It waits for the path to settle, and only calls
      // it a bounce if we are still on /login after that.
      let settled = false;
      for (let i = 0; i < 12; i += 1) {
        const here = await page.evaluate(() => location.pathname);
        if (!here.includes("/login")) {
          settled = true;
          break;
        }
        await page.waitForTimeout(1000);
      }
      if (!settled) {
        throw new Error(
          `${path}: still on /login after 12s — the session is gone, so nothing ` +
            `measured here would be about the app. Re-run when the site is stable.`,
        );
      }
      await page.waitForTimeout(1200);
      const r = await page.evaluate(() => {
        // NOT documentElement.scrollWidth. This app scrolls an INNER container,
        // so the document never overflows and every page reported the same
        // -10px — one number for thirty-three pages, which is the shape of a
        // measurement taken on the wrong element. (Third time in this project.)
        //
        // What actually matters on a phone is simpler and visible: is anything
        // sticking out past the right edge of the screen?
        const vw = window.innerWidth;
        let worst = 0;
        const culprits: string[] = [];
        document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          // Ignore things deliberately parked off-screen (drawers, sr-only).
          const cs = getComputedStyle(el);
          if (cs.position === "fixed" && r.left >= vw) return;
          if (cs.visibility === "hidden" || cs.clipPath.includes("inset(50%)")) return;
          // Decoration that is MEANT to bleed and is clipped by its parent —
          // the aurora reported +335px on all thirty-three pages, which is the
          // signature of a false positive rather than a bug thirty-three
          // people wrote independently.
          if (cs.pointerEvents === "none") return;
          // Inside something that scrolls or clips horizontally? Then it is
          // contained on purpose: a wide table in an `overflow-x-auto` wrapper
          // is a scrollable table, not a broken page.
          for (let a: HTMLElement | null = el.parentElement; a; a = a.parentElement) {
            const ax = getComputedStyle(a).overflowX;
            if (ax === "auto" || ax === "scroll" || ax === "hidden" || ax === "clip") return;
          }
          const over = Math.round(r.right - vw);
          if (over > 2 && r.width < 3000) {
            if (over > worst) worst = over;
            const id =
              el.tagName.toLowerCase() +
              (typeof el.className === "string" && el.className
                ? "." + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".")
                : "");
            if (culprits.length < 3 && !culprits.includes(id)) culprits.push(id);
          }
        });
        // TAP TARGETS. A control smaller than about 40px square is a control
        // you miss on a phone, and this app is used with wet hands in a
        // kitchen. Counted, with the worst offenders named.
        const small: string[] = [];
        let tiny = 0;
        document.querySelectorAll<HTMLElement>("button, a[href], [role='button'], input[type='checkbox']").forEach((el) => {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) return;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.pointerEvents === "none") return;
          if (Math.min(b.width, b.height) < 32) {
            tiny += 1;
            const label = (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 22);
            const id = `${Math.round(b.width)}x${Math.round(b.height)} "${label}"`;
            if (small.length < 3) small.push(id);
          }
        });
        return { over: worst, culprits, tiny, small, height: document.documentElement.scrollHeight };
      });
      const flag = r.over > 2 ? "OVERFLOW" : r.tiny > 0 ? "TAPS    " : "ok      ";
      if (r.over > 2) bad.push(`${path} +${r.over}px ${r.culprits.join(" ")}`);
      if (r.tiny > 0) bad.push(`${path} ${r.tiny} small taps: ${r.small.join(", ")}`);
      console.log(
        `${flag} ${path.padEnd(18)} over=${String(r.over).padStart(4)}px  taps<32px=${String(r.tiny).padStart(2)}  ${r.small.join(" | ")}`,
      );
    } catch (e) {
      console.log(`ERROR    ${path} ${(e as Error).message.slice(0, 60)}`);
    }
  }
  console.log("\n=== OVERFLOWING PAGES:", bad.length);
  bad.forEach((b) => console.log("   " + b));
});
