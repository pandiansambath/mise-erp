import { test } from "@playwright/test";

const OUT = "C:/Users/pandi/AppData/Local/Temp/claude/c--pandi-project-nirai-try1/b2b5b43d-8ddb-48ca-be6f-f1ae1e7d2215/scratchpad";

test.use({ reducedMotion: "no-preference" });

async function signIn(page: any) {
  const errs: string[] = [];
  page.on("console", (m: any) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e: any) => errs.push("PAGEERROR " + e.message));
  await page.goto("/login");
  await page.locator('#li-email:visible, [data-testid="login-email"]:visible').first().fill("control@mise.app");
  await page.locator('#li-password:visible, [data-testid="login-password"]:visible').first().fill("Control@2026");
  await page.locator('button[type="submit"]:visible').first().click();
  await page.waitForURL(/control-room|dashboard/, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3500);
  return errs;
}

async function gotoMapByClicking(page: any) {
  const [resp] = await Promise.all([
    page.waitForResponse((r: any) => r.url().includes("/api/platform/graph"), { timeout: 60000 }).catch(() => null),
    page.getByRole("link", { name: "The map", exact: true }).first().click(),
  ]);
  await page.waitForTimeout(3000);
  return resp;
}

const nodeProbe = () => {
  const gs = Array.from(document.querySelectorAll('svg[role="img"] g[role="button"]'));
  return gs.map((g) => {
    const paths = Array.from(g.querySelectorAll("path"));
    const texts = Array.from(g.querySelectorAll("text")).map((t) => t.textContent || "");
    const bb = (g as unknown as SVGGraphicsElement).getBBox();
    const body = paths.find((p) => p.getAttribute("stroke")) || paths[0];
    return {
      label: texts[0] || "",
      sub: texts[1] || "",
      aria: g.getAttribute("aria-label"),
      tabindex: g.getAttribute("tabindex"),
      x: Math.round(bb.x + bb.width / 2),
      y: Math.round(bb.y + bb.height / 2),
      w: Math.round(bb.width),
      h: Math.round(bb.height),
      stroke: body ? body.getAttribute("stroke") : null,
      fill: body ? body.getAttribute("fill") : null,
      dash: body ? body.getAttribute("stroke-dasharray") : null,
      paths: paths.length,
      arcs: paths.filter((p) => (p.getAttribute("d") || "").indexOf(" A ") >= 0).length,
    };
  });
};

const canvasProbe = () => {
  const cv = document.querySelector("canvas") as HTMLCanvasElement | null;
  if (!cv) return { ok: false, nonzero: -1, checksum: -1, top: [] } as any;
  const ctx = cv.getContext("2d");
  if (!ctx) return { ok: false, nonzero: -1, checksum: -1, top: [] } as any;
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let nonzero = 0;
  let checksum = 0;
  const cols: Record<string, number> = {};
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 10) {
      nonzero++;
      checksum = (checksum + i * (d[i] + d[i + 1] * 3 + d[i + 2] * 7)) % 2147483647;
      if (d[i + 3] > 180) {
        const k = d[i] + "," + d[i + 1] + "," + d[i + 2];
        cols[k] = (cols[k] || 0) + 1;
      }
    }
  }
  const top = Object.entries(cols).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return { ok: true, w: cv.width, h: cv.height, nonzero, checksum, top };
};

test("A render, pulses, the three facts at 1920", async ({ page }) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errs = await signIn(page);
  const resp = await gotoMapByClicking(page);
  console.log("URL:", page.url());
  if (resp) {
    console.log("GRAPH STATUS:", resp.status());
    const j = await resp.json().catch(() => null);
    if (j) {
      console.log("NODES:", j.nodes.length, "EDGES:", j.edges.length);
      console.log("PAYLOAD_NODES:", JSON.stringify(j.nodes.map((n: any) => ({ id: n.id, kind: n.kind, label: n.label, sev: n.severed, ch: n.channels, m: n.metrics }))).slice(0, 7000));
      console.log("PAYLOAD_EDGES:", JSON.stringify(j.edges).slice(0, 5000));
      console.log("META:", JSON.stringify(j.meta));
    }
  }
  await page.screenshot({ path: OUT + "/g-1920.png" });
  const box = await page.locator("svg[role='img']").first().boundingBox();
  console.log("SVG BOX:", JSON.stringify(box));

  const nodes = await page.evaluate(nodeProbe);
  console.log("RENDERED NODES:", nodes.length);
  console.log(JSON.stringify(nodes).slice(0, 9000));

  const ov: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a: any = nodes[i];
      const b: any = nodes[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const need = (a.w + b.w) / 4 + (a.h + b.h) / 4;
      if (dist < need * 0.75) ov.push(a.label + "~" + b.label + " d=" + Math.round(dist) + " need=" + Math.round(need));
    }
  }
  console.log("OVERLAPS:", JSON.stringify(ov));

  const edges = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll("svg[role='img'] > g[fill='none'] path"));
    return ps.map((p) => ({
      d: (p.getAttribute("d") || "").slice(0, 70),
      stroke: p.getAttribute("stroke"),
      w: p.getAttribute("stroke-width"),
      dash: p.getAttribute("stroke-dasharray"),
      op: p.getAttribute("opacity"),
    }));
  });
  console.log("EDGE COUNT:", edges.length);
  console.log("EDGES:", JSON.stringify(edges).slice(0, 5000));

  const c1 = await page.evaluate(canvasProbe);
  await page.waitForTimeout(2000);
  const c2 = await page.evaluate(canvasProbe);
  await page.waitForTimeout(2000);
  const c3 = await page.evaluate(canvasProbe);
  console.log("CANVAS1:", JSON.stringify(c1));
  console.log("CANVAS2:", JSON.stringify(c2));
  console.log("CANVAS3:", JSON.stringify(c3));
  await page.screenshot({ path: OUT + "/g-1920-b.png" });

  console.log("CONSOLE ERRORS:", JSON.stringify(errs.slice(0, 20)));
});

test("B theme light then dark", async ({ page }) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  let patched = 0;
  await page.route("**/api/hotels/me", async (route: any) => {
    if (route.request().method() !== "GET") { patched++; await route.abort(); return; }
    await route.continue();
  });
  await signIn(page);
  await gotoMapByClicking(page);

  const readTheme = () => ({
    mode: document.documentElement.getAttribute("data-mode"),
    shell: getComputedStyle(document.querySelector("svg[role='img']") as Element).getPropertyValue("--color-shell").trim(),
    fg: getComputedStyle(document.querySelector("svg[role='img']") as Element).getPropertyValue("--color-fg").trim(),
    stored: localStorage.getItem("mise_theme"),
  });
  console.log("THEME BEFORE:", JSON.stringify(await page.evaluate(readTheme)));
  await page.screenshot({ path: OUT + "/g-theme-light.png" });
  console.log("LIGHT CANVAS:", JSON.stringify(await page.evaluate(canvasProbe)));
  const lightNodes = await page.evaluate(nodeProbe);
  console.log("LIGHT NODE COLOURS:", JSON.stringify(lightNodes.map((n: any) => ({ l: n.label, s: n.stroke, f: n.fill }))));
  const lightEdges = await page.evaluate(() =>
    Array.from(document.querySelectorAll("svg[role='img'] > g[fill='none'] path")).slice(0, 8).map((p) => p.getAttribute("stroke")));
  console.log("LIGHT EDGE STROKES:", JSON.stringify(lightEdges));

  const btns = page.locator("header button");
  const n = await btns.count();
  console.log("HEADER BUTTONS:", n, JSON.stringify(await btns.allInnerTexts()));
  for (let i = 0; i < n; i++) {
    const t = (await btns.nth(i).innerText()).trim();
    const aria = (await btns.nth(i).getAttribute("aria-label")) || "";
    if (t === "" || /theme/i.test(aria)) { await btns.nth(i).click(); break; }
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "/g-theme-menu.png" });
  const opt = page.getByRole("button", { name: /Nocturne|Midnight|Graphite|^Dark$/i }).first();
  console.log("THEME OPTION COUNT:", await opt.count(), "text:", await opt.innerText().catch(() => "?"));
  await opt.click();
  await page.waitForTimeout(3500);
  console.log("THEME AFTER:", JSON.stringify(await page.evaluate(readTheme)), "| PATCH blocked x", patched);
  await page.screenshot({ path: OUT + "/g-theme-dark.png" });
  console.log("DARK CANVAS:", JSON.stringify(await page.evaluate(canvasProbe)));
  const darkNodes = await page.evaluate(nodeProbe);
  console.log("DARK NODE COLOURS:", JSON.stringify(darkNodes.map((n: any) => ({ l: n.label, s: n.stroke, f: n.fill }))));
  const darkEdges = await page.evaluate(() =>
    Array.from(document.querySelectorAll("svg[role='img'] > g[fill='none'] path")).slice(0, 8).map((p) => p.getAttribute("stroke")));
  console.log("DARK EDGE STROKES:", JSON.stringify(darkEdges));
  await page.waitForTimeout(2500);
  console.log("DARK CANVAS 2:", JSON.stringify(await page.evaluate(canvasProbe)));
  console.log("PATCHES BLOCKED TOTAL:", patched);
});

test("C click NIRAI and the period selector", async ({ page }) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await signIn(page);
  await gotoMapByClicking(page);
  const nodes = await page.evaluate(nodeProbe);
  const target: any = nodes.find((n: any) => (n.label || "").trim() === "NIRAI") || nodes[0];
  console.log("CLICKING:", JSON.stringify(target));
  const svgBox = await page.locator("svg[role='img']").first().boundingBox();
  await page.mouse.move(svgBox!.x + target.x, svgBox!.y + target.y);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + "/g-hover.png" });
  await page.mouse.click(svgBox!.x + target.x, svgBox!.y + target.y);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: OUT + "/g-sheet.png" });
  const sheet = await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"]') as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { text: el.innerText, scrollH: el.scrollHeight, clientH: el.clientHeight, w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log("SHEET:", JSON.stringify(sheet));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(900);

  for (const label of ["7 days", "90 days", "30 days"]) {
    const before = await page.evaluate(nodeProbe);
    await page.getByRole("button", { name: label, exact: true }).first().click().catch(async () => {
      await page.getByText(label, { exact: true }).first().click();
    });
    await page.waitForTimeout(4000);
    const after = await page.evaluate(nodeProbe);
    const head = await page.locator("p.text-xs.text-fg-faint").first().innerText().catch(() => "?");
    console.log("PERIOD " + label + ": nodes " + before.length + " -> " + after.length + " | summary: " + head);
    console.log("  subs: " + JSON.stringify(after.map((n: any) => n.label + ":" + n.sub)));
    await page.screenshot({ path: OUT + "/g-period-" + label.replace(/\s/g, "") + ".png" });
  }
});

test("D size, scroll, rAF, hidden tab, keyboard", async ({ page }) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await signIn(page);
  await gotoMapByClicking(page);

  const measure = async (tag: string) => {
    await page.waitForTimeout(2500);
    const m = await page.evaluate(() => {
      const svg = document.querySelector("svg[role='img']") as SVGSVGElement | null;
      const cv = document.querySelector("canvas") as HTMLCanvasElement | null;
      const r = svg ? svg.getBoundingClientRect() : null;
      return {
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        scrollW: document.documentElement.scrollWidth,
        svg: r ? { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) } : null,
        canvas: cv ? { w: cv.width, h: cv.height } : null,
        nodes: document.querySelectorAll('svg[role="img"] g[role="button"]').length,
      };
    });
    console.log("SIZE " + tag + ":", JSON.stringify(m));
    await page.screenshot({ path: OUT + "/g-size-" + tag + ".png" });
    return m;
  };
  await measure("1920x1080");

  const fps = await page.evaluate(() => new Promise<any>((res) => {
    const ts: number[] = [];
    let n = 0;
    const f = (t: number) => {
      ts.push(t);
      if (++n < 100) requestAnimationFrame(f);
      else {
        const d: number[] = [];
        for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
        d.sort((a, b) => a - b);
        res({ frames: d.length, median: +d[Math.floor(d.length / 2)].toFixed(2), p95: +d[Math.floor(d.length * 0.95)].toFixed(2), max: +d[d.length - 1].toFixed(2) });
      }
    };
    requestAnimationFrame(f);
  }));
  console.log("FRAME TIMES:", JSON.stringify(fps));

  const before = await page.evaluate(canvasProbe);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(2500);
  const hidden1 = await page.evaluate(canvasProbe);
  await page.waitForTimeout(2000);
  const hidden2 = await page.evaluate(canvasProbe);
  console.log("HIDDEN: before cs=" + before.checksum + " nz=" + before.nonzero + " | h1 cs=" + hidden1.checksum + " nz=" + hidden1.nonzero + " | h2 cs=" + hidden2.checksum + " nz=" + hidden2.nonzero);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(2000);
  const back = await page.evaluate(canvasProbe);
  console.log("VISIBLE AGAIN: cs=" + back.checksum + " nz=" + back.nonzero);

  await page.mouse.click(5, 300);
  let reached = 0;
  let firstAria = "";
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const a = document.activeElement as Element | null;
      return a ? { tag: a.tagName, role: a.getAttribute("role"), aria: a.getAttribute("aria-label") } : null;
    });
    if (info && String(info.tag).toLowerCase() === "g") { reached++; if (!firstAria) firstAria = info.aria || ""; }
    if (reached >= 3) break;
  }
  console.log("KEYBOARD nodes reached by Tab =", reached, "| first aria:", firstAria);
  if (reached) {
    await page.screenshot({ path: OUT + "/g-focus.png" });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1300);
    console.log("ENTER OPENS SHEET:", await page.locator('[role="dialog"]').count());
    await page.screenshot({ path: OUT + "/g-keyboard-sheet.png" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await measure("1280x800");
  await page.setViewportSize({ width: 390, height: 844 });
  await measure("390x844");
  await page.screenshot({ path: OUT + "/g-390-full.png", fullPage: true });
});
