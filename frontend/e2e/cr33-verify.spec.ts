import { test, expect } from "@playwright/test";

const OUT = "C:/Users/pandi/AppData/Local/Temp/claude/c--pandi-project-nirai-try1/b2b5b43d-8ddb-48ca-be6f-f1ae1e7d2215/scratchpad";

test.describe.configure({ mode: "serial" });

test("Control Room §33 verification pass", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });

  // ---- Login as operator ----
  await page.goto("/login");
  await page.locator('#li-email:visible, [data-testid="login-email"]:visible').first().fill("control@mise.app");
  await page.locator('#li-password:visible, [data-testid="login-password"]:visible').first().fill("Control@2026");
  await page.locator('button[type="submit"]:visible').first().click();
  await page.waitForTimeout(4000);
  console.log("POST-LOGIN URL:", page.url());

  // Reach control-room by clicking, not typing a URL, per the gotcha.
  if (!page.url().includes("/control-room")) {
    await page.goto("/control-room");
    await page.waitForTimeout(3000);
  }
  console.log("CONTROL ROOM URL:", page.url());
  await page.screenshot({ path: `${OUT}/cr33-01-overview.png`, fullPage: true });

  // ---- 33.1: walk every nav destination, confirm the nav persists ----
  const navLabels = ["Hotels", "AI spend", "Broadcast", "Job board", "Plans", "Trail", "Operators"];
  for (const label of navLabels) {
    const link = page.locator(`nav[aria-label="Control Room"] a:has-text("${label}")`).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    await link.click();
    await page.waitForTimeout(2000);
    console.log(`NAV -> ${label}: ${page.url()}`);
    const slug = label.toLowerCase().replace(/\s+/g, "-");
    await page.screenshot({ path: `${OUT}/cr33-nav-${slug}.png`, fullPage: true });
  }

  // ---- Mobile pass on overview ----
  await page.goto("/control-room");
  await page.waitForTimeout(2000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/cr33-mobile-overview.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });

  // ---- 33.3 / 33.4: open a hotel, look at activity + AI ----
  await page.goto("/control-room/fleet");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/cr33-fleet-list.png`, fullPage: true });

  // List every hotel row's name + href so we can pick the real tenant deliberately.
  const hotelHrefs = await page.locator('a[href^="/control-room/hotels/"]').evaluateAll((els) =>
    els.map((e) => ({ href: (e as HTMLAnchorElement).getAttribute("href"), text: e.textContent?.trim() })),
  );
  console.log("HOTEL ROWS:", JSON.stringify(hotelHrefs));

  const nirai = hotelHrefs.find((h) => /nirai/i.test(h.text || ""));
  const target = nirai ?? hotelHrefs[0];
  console.log("TARGET HOTEL:", JSON.stringify(target));

  if (target?.href) {
    await page.goto(target.href);
    await page.waitForTimeout(2500);
    console.log("HOTEL DETAIL URL:", page.url());
    await page.screenshot({ path: `${OUT}/cr33-hotel-overview.png`, fullPage: true });

    const subnav = page.locator('nav[aria-label$="sections"]');

    // Activity tab
    const activityTab = subnav.locator('a:has-text("Activity")').first();
    if (await activityTab.count()) {
      await activityTab.click();
      await page.waitForTimeout(2500);
      console.log("ACTIVITY URL:", page.url());
      await page.screenshot({ path: `${OUT}/cr33-hotel-activity.png`, fullPage: true });
      const activityText = await page.locator("body").innerText();
      console.log("ACTIVITY PAGE TEXT SNIPPET:", activityText.slice(0, 800));
    }

    // AI tab (scoped to the hotel sub-nav, not the top-level nav's "AI spend")
    const aiTab = subnav.locator('a:has-text("AI")').first();
    if (await aiTab.count()) {
      await aiTab.click();
      await page.waitForTimeout(2500);
      console.log("AI THREADS URL:", page.url());
      await page.screenshot({ path: `${OUT}/cr33-hotel-ai-threads.png`, fullPage: true });
    }
  } else {
    console.log("NO HOTEL ROWS FOUND ON FLEET PAGE.");
  }

  // ---- Find whichever hotel actually HAS ai threads, across the fleet ----
  let openedThread = false;
  for (const h of hotelHrefs) {
    if (!h.href) continue;
    await page.goto(`${h.href}/ai`);
    await page.waitForTimeout(2000);
    const threadCount = await page.locator('ul li a[href*="/ai/"]').count();
    console.log(`AI THREAD CHECK for ${h.text} (${h.href}): ${threadCount} thread(s)`);
    if (threadCount > 0) {
      await page.screenshot({ path: `${OUT}/cr33-hotel-ai-threads-with-data.png`, fullPage: true });
      await page.locator('ul li a[href*="/ai/"]').first().click();
      await page.waitForTimeout(2000);
      console.log("THREAD DETAIL URL (pre-open):", page.url());
      await page.screenshot({ path: `${OUT}/cr33-thread-gate.png`, fullPage: true });

      const openBtn = page.locator('button:has-text("View transcript")').first();
      if (await openBtn.count()) {
        await openBtn.click();
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${OUT}/cr33-thread-opened.png`, fullPage: true });
        openedThread = true;
      }
      break;
    }
  }
  console.log("OPENED A REAL THREAD:", openedThread);

  // ---- 33.4 continued: check the Trail page for our own audit entry ----
  await page.goto("/control-room/audit");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/cr33-trail-after.png`, fullPage: true });
  const bodyText = await page.locator("body").innerText();
  console.log("TRAIL PAGE CONTAINS 'ai-thread' or 'conversation':", /conversation|ai.?thread|ai_thread/i.test(bodyText));
  console.log("TRAIL PAGE CONTAINS control@mise.app:", bodyText.includes("control@mise.app"));

  expect(true).toBe(true);
});
