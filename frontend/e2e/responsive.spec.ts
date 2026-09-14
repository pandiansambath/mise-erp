import { test, expect, type Page } from "@playwright/test";

/**
 * The responsive sweep — run this after ANY UI change.
 *
 *     "whenever we do UI changes we [are] not checking whether it's suitable
 *      for mobile view, responsive to all screen sizes."
 *
 * He is right, and "remember to check" is not a control. This is.
 *
 * ── WHAT THIS CATCHES, AND WHAT IT CANNOT ────────────────────────────────
 *
 * Responsive breakage splits cleanly in two, and only one half is machine
 * checkable. These are the objective ones — a page that scrolls sideways, an
 * element wider than the screen, text cut off mid-word, a button too small to
 * hit with a thumb. Every one is a measurement, so a machine should be doing
 * it, every time, on every page.
 *
 * It CANNOT tell you a layout is ugly, that a column is wasted, or that a hero
 * feels cramped. That is what the screenshots are for, and why `qa-manual` and
 * `product-designer` still have to look. This sweep exists so the human eye is
 * spent on judgement rather than on spotting a horizontal scrollbar.
 *
 * ── THE BUGS THAT MOTIVATED EACH CHECK ───────────────────────────────────
 *
 * · CLIPPED TEXT — the sign-in headline rendered "Welc / back / to / NIRA"
 *   because a desktop split layout fired at phone width. Visible instantly in
 *   a screenshot, invisible to every assertion in the repo.
 * · HORIZONTAL SCROLL — the public menu page overflowed when the grid gained a
 *   column; nothing failed, the page just slid sideways under your thumb.
 * · TAP TARGETS — several controls measured under 30px. Fine with a mouse.
 * · HIDDEN BEHIND THE BAR — the mobile bottom nav is fixed, so the last row of
 *   any page can sit permanently underneath it.
 *
 * ── RUNNING IT ───────────────────────────────────────────────────────────
 *
 *     cd frontend
 *     npm run build && npx next start -p 3100      # in one shell
 *     npm run responsive                            # in another
 *
 * Against production instead:  BASE_URL=https://nirai1.dineai.cloud npm run responsive
 */

const PROD = "https://nirai1.dineai.cloud";
const LOCAL = process.env.SWEEP_BASE || "http://localhost:3100";
const TABLE = process.env.TCODE || "pqqmr6y";

/** Real devices people actually hold, not round numbers.
 *
 *  360 is the floor that matters — a huge share of Android phones, and the
 *  width where anything designed at 390 first breaks. */
const VIEWPORTS = [
  { name: "360", width: 360, height: 640, phone: true },
  { name: "390", width: 390, height: 844, phone: true },
  { name: "768", width: 768, height: 1024, phone: false },
  { name: "1024", width: 1024, height: 768, phone: false },
  { name: "1440", width: 1440, height: 900, phone: false },
  { name: "1920", width: 1920, height: 1080, phone: false },
];

/** Pages worth sweeping. Public ones need no login and run everywhere; the
 *  rest need a token, which is injected. */
const PAGES: { path: string; name: string; auth: boolean; operator?: boolean }[] = [
  { path: `/t/${TABLE}`, name: "public-table", auth: false },
  { path: "/dashboard", name: "dashboard", auth: true },
  { path: "/customise", name: "customise", auth: true },
  { path: "/employees", name: "employees", auth: true },
  { path: "/inventory", name: "inventory", auth: true },
  { path: "/menu", name: "menu", auth: true },

  // The Control Room. `operator: true` because superadmin@gmail.com is NOT
  // is_platform_owner — control-room/layout.tsx bounces it to /dashboard, so
  // sweeping these with the ordinary token silently measures the dashboard
  // instead and reports a clean pass on a page that was never loaded.
  { path: "/control-room", name: "cr-overview", auth: true, operator: true },
  { path: "/control-room/fleet", name: "cr-fleet", auth: true, operator: true },
  { path: "/control-room/ai", name: "cr-ai", auth: true, operator: true },
  { path: "/control-room/broadcast", name: "cr-broadcast", auth: true, operator: true },
  { path: "/control-room/jobs", name: "cr-jobs", auth: true, operator: true },
  { path: "/control-room/plans", name: "cr-plans", auth: true, operator: true },
  { path: "/control-room/audit", name: "cr-audit", auth: true, operator: true },
  { path: "/control-room/operators", name: "cr-operators", auth: true, operator: true },
];

type Fault = { kind: string; detail: string };

/** Everything measurable that is wrong with this page at this width. */
async function audit(page: Page, phone: boolean): Promise<Fault[]> {
  return page.evaluate((isPhone) => {
    const faults: { kind: string; detail: string }[] = [];
    const vw = window.innerWidth;
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : "";
      const cls = (el.className || "").toString().split(/\s+/).slice(0, 3).join(".");
      const txt = (el.textContent || "").trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${id}${cls ? "." + cls : ""}${txt ? ` "${txt}"` : ""}`;
    };

    // 1. The page itself slides sideways.
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      faults.push({
        kind: "page-scrolls-sideways",
        detail: `scrollWidth ${doc.scrollWidth} > viewport ${doc.clientWidth}`,
      });
    }

    const all = Array.from(document.body.querySelectorAll("*"));

    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;

      // 2. Something sticks out past the right edge. Ignore deliberately
      //    off-screen things (closed drawers live at translateX(-100%)) and
      //    anything inside a container that scrolls on purpose.
      if (r.right > vw + 1 && r.left < vw) {
        // CONTAINED, not overflowing. An ancestor that scrolls owns the
        // overflow deliberately; an ancestor that HIDES it clips the element
        // so nothing reaches the edge of the screen.
        //
        // The first run of this taught me the second half: it flagged a
        // decorative gradient blob at `-right-16` on the public page at five
        // widths out of six. The blob is `pointer-events-none` inside a
        // `overflow-hidden` hero and is invisible past the card's edge — a
        // false positive, and the kind that gets a check switched off.
        let contained = false;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          const ov = s.overflowX === "visible" ? s.overflow : s.overflowX;
          if (ov === "auto" || ov === "scroll" || ov === "hidden" || ov === "clip") {
            contained = true;
            break;
          }
        }
        if (!contained && r.right - vw > 4) {
          faults.push({
            kind: "overflows-right",
            detail: `${describe(el)} ends at ${Math.round(r.right)} (viewport ${vw})`,
          });
        }
      }

      // 3. TEXT CUT OFF. The one that produced "Welc / back / to / NIRA".
      //    Only where overflow is actually hidden — a scrollable box is fine,
      //    and `line-clamp` is a deliberate truncation, not a fault.
      const clamps = style.webkitLineClamp && style.webkitLineClamp !== "none";
      const hidden =
        style.overflowX === "hidden" || style.overflow === "hidden";
      if (
        !clamps &&
        hidden &&
        el.scrollWidth > el.clientWidth + 2 &&
        el.children.length === 0 &&
        (el.textContent || "").trim().length > 0
      ) {
        // HOW MUCH is lost, not merely whether any is.
        //
        // `truncate` is a deliberate ellipsis and flagging every one of them
        // would bury the real faults. But the first run found "Hourly
        // (weekly-paid)" given 32px of the 113px it needs on a 360px phone —
        // three characters and a dot. Truncation is a design choice;
        // truncating to nothing is a bug.
        //
        // Below 60% visible, a label has stopped being a label.
        const visible = el.clientWidth / el.scrollWidth;
        if (visible < 0.6) {
          faults.push({
            kind: "text-clipped",
            detail:
              `${describe(el)} shows ${Math.round(visible * 100)}% ` +
              `(${el.clientWidth}px of ${el.scrollWidth}px)`,
          });
        }
      }
    }

    // 4. Tap targets. 44px is Apple's guidance and roughly a fingertip.
    if (isPhone) {
      const hit = Array.from(
        document.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"]'),
      );
      for (const el of hit) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (getComputedStyle(el).visibility === "hidden") continue;
        // Padding on a parent often provides the real target; only complain
        // when the element AND its parent are both small.
        const pr = el.parentElement?.getBoundingClientRect();
        const effective = Math.max(r.height, Math.min(pr?.height ?? 0, r.height + 16));
        if (effective < 32 && r.width < 32) {
          faults.push({
            kind: "tap-target-small",
            detail: `${describe(el)} is ${Math.round(r.width)}×${Math.round(r.height)}`,
          });
        }
      }
    }

    return faults;
  }, phone);
}

async function signIn(page: Page, operator = false) {
  const creds = operator
    ? { email: "control@mise.app", password: "Control@2026" }
    : { email: "superadmin@gmail.com", password: "superadmin@123" };
  const r = await fetch(`${PROD}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(creds),
  });
  const d = await r.json();
  await page.addInitScript((t) => {
    window.localStorage.setItem("mise_token", t as string);
  }, d.access_token);
}

for (const vp of VIEWPORTS) {
  for (const target of PAGES) {
    test(`${target.name} @ ${vp.name}`, async ({ browser }) => {
      test.setTimeout(120_000);
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
      });
      const page = await ctx.newPage();

      // Proxy the API to production so pages have real data. An empty page is
      // responsive by accident — it is the full one that breaks.
      await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        const res = await route.fetch({ url: PROD + url.pathname + url.search });
        await route.fulfill({ response: res });
      });

      if (target.auth) await signIn(page, target.operator);

      if (target.operator) {
        // An operator lands straight in the Control Room — there is no tenant
        // dashboard to pass through and no onboarding tour to dismiss.
        await page.goto(LOCAL + target.path);
        await page.waitForTimeout(6000);
        if (!page.url().includes("/control-room")) {
          throw new Error(
            `operator sweep landed on ${page.url()} — not the Control Room. ` +
              `A clean pass here would be measuring the wrong page.`,
          );
        }
      } else {
        await page.goto(LOCAL + (target.auth ? "/dashboard" : target.path));
        await page.waitForTimeout(target.auth ? 6000 : 3500);
      }

      if (target.auth && !target.operator) {
        // The onboarding tour opens over the dashboard and swallows the next
        // click; a direct URL right after sign-in bounces to /dashboard.
        const skip = page.getByText("Skip tour").first();
        if (await skip.count()) {
          await skip.click().catch(() => {});
          await page.waitForTimeout(800);
        }
        if (target.path !== "/dashboard") {
          await page.goto(LOCAL + target.path);
          await page.waitForTimeout(4000);
        }
      }

      await page.screenshot({
        path: `e2e-out/resp-${target.name}-${vp.name}.png`,
        fullPage: false,
      });

      const faults = await audit(page, vp.phone);

      // Group so one broken component does not print eighty times.
      const byKind = new Map<string, string[]>();
      for (const f of faults) {
        if (!byKind.has(f.kind)) byKind.set(f.kind, []);
        byKind.get(f.kind)!.push(f.detail);
      }
      const lines: string[] = [];
      for (const [kind, details] of byKind) {
        lines.push(`  ${kind} ×${details.length}`);
        for (const d of details.slice(0, 4)) lines.push(`      ${d}`);
        if (details.length > 4) lines.push(`      …and ${details.length - 4} more`);
      }
      if (lines.length) console.log(`\n${target.name} @ ${vp.name}\n${lines.join("\n")}`);

      await page.unrouteAll({ behavior: "ignoreErrors" });
      await ctx.close();

      // A page that slides sideways under your thumb is a hard fail. The rest
      // are reported and reviewed — failing the build on a 30px icon would get
      // this suite switched off inside a week, and a switched-off check is
      // worth nothing.
      const sideways = faults.filter((f) => f.kind === "page-scrolls-sideways");
      expect(sideways, `${target.name} scrolls sideways at ${vp.name}`).toHaveLength(0);
    });
  }
}
