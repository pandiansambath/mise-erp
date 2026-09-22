import { test, expect } from "@playwright/test";

const OUT = "C:/Users/pandi/AppData/Local/Temp/claude/c--pandi-project-nirai-try1/b2b5b43d-8ddb-48ca-be6f-f1ae1e7d2215/scratchpad/shots";

async function signIn(page: any) {
  await page.goto("/login");
  await page.locator('#li-email:visible, [data-testid="login-email"]:visible').first().fill("control@mise.app");
  await page.locator('#li-password:visible, [data-testid="login-password"]:visible').first().fill("Control@2026");
  await page.locator('#li-password:visible, [data-testid="login-password"]:visible').first().press("Enter");
  await page.waitForTimeout(6000);
}

test("map desktop 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/control-room/graph");
  await page.waitForTimeout(9000);
  console.log("URL:", page.url());
  await page.screenshot({ path: `${OUT}/map-1440.png` });

  // Every text label on the canvas, with its box — to find collisions objectively.
  const labels = await page.evaluate(() => {
    const out: any[] = [];
    document.querySelectorAll("svg text, svg tspan").forEach((el: any) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      out.push({ t: (el.textContent || "").trim(), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
    });
    return out;
  });
  console.log("LABELCOUNT", labels.length);
  console.log("LABELS", JSON.stringify(labels));

  // Overlap pairs
  const overlaps = await page.evaluate(() => {
    const els: any[] = [];
    document.querySelectorAll("svg text").forEach((el: any) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      els.push({ t: (el.textContent || "").trim(), r });
    });
    const hits: string[] = [];
    for (let i = 0; i < els.length; i++)
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i].r, b = els[j].r;
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
          hits.push(`${els[i].t} <> ${els[j].t}`);
      }
    return hits;
  });
  console.log("OVERLAPS", overlaps.length, JSON.stringify(overlaps));

  // DOM shape of the canvas
  const shape = await page.evaluate(() => {
    const svg = document.querySelector("svg");
    return {
      svgCount: document.querySelectorAll("svg").length,
      canvasCount: document.querySelectorAll("canvas").length,
      viewBox: svg?.getAttribute("viewBox"),
      svgBox: svg ? JSON.stringify(svg.getBoundingClientRect()) : null,
      circles: document.querySelectorAll("svg circle").length,
      polys: document.querySelectorAll("svg polygon").length,
      paths: document.querySelectorAll("svg path").length,
      bodyScroll: document.body.scrollHeight,
    };
  });
  console.log("SHAPE", JSON.stringify(shape));

  // click a restaurant node, see what happens
  const circ = page.locator("svg circle").nth(3);
  try {
    await circ.click({ force: true, timeout: 5000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/map-1440-clicked.png` });
  } catch (e) { console.log("CLICK FAILED", String(e).slice(0, 200)); }
  expect(true).toBe(true);
});

test("map mobile 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/control-room/graph");
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT}/map-390.png` });
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    scrollH: document.body.scrollHeight,
  }));
  console.log("MOBILE", JSON.stringify(m));
  expect(true).toBe(true);
});

test("aws bill page numbers", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/control-room/money");
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT}/money-1440.png`, fullPage: true });
  expect(true).toBe(true);
});
