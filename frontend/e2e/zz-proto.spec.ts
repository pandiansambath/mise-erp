import { test, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/** THROWAWAY - section 38 JOB 2 prototypes. Palettes are injected at RUNTIME so
 *  the shared working tree is never modified. Delete this file when done. */

const LOCAL = "http://localhost:3100";
const LIVE = "https://nirai1.dineai.cloud";
const OUT = process.env.SHOT_DIR as string;

type Proto = {
  light: boolean;
  brand: Record<string, string>;
  surfaces: [string, string, string, string];
  fg: [string, string, string];
  aurora: [string, string, string];
  lines: [string, string];
  glass: string;
  sections?: Record<string, string>;
};

const SVC: Record<string, string> = {
  "50": "#effaf8", "100": "#d6f2ee", "200": "#a9e5dd", "300": "#5ec8bd", "400": "#33a99e",
  "500": "#1a8a80", "600": "#0f6f67", "700": "#0b574f", "800": "#0a453f", "900": "#083733", "950": "#04211f",
};

const PROTOS: Record<string, Proto> = {
  "service-light": {
    light: true,
    brand: SVC,
    surfaces: ["#f2f4f3", "#ffffff", "#f7f9f8", "#e9edec"],
    fg: ["#101a18", "#3c4a47", "#6d7d79"],
    aurora: ["#a9e5dd", "#c7d2fe", "#fde68a"],
    lines: ["rgba(16,26,24,0.12)", "rgba(16,26,24,0.22)"],
    glass: "#101a18",
    sections: { Overview: "#0b574f", Money: "#3730a3", Kitchen: "#9a3412", Stock: "#8a4b06", People: "#6b21a8", Admin: "#334155" },
  },
  "service-dark": {
    light: false,
    brand: { ...SVC, "300": "#7fd8cf", "400": "#4cc0b4", "500": "#2aa196", "600": "#1b8178", "700": "#13645d" },
    surfaces: ["#0b1211", "#131c1b", "#182322", "#21302e"],
    fg: ["#eaf2f0", "#b8c9c6", "#859794"],
    aurora: ["#2aa196", "#6366f1", "#f59e0b"],
    lines: ["rgba(255,255,255,0.14)", "rgba(255,255,255,0.26)"],
    glass: "#ffffff",
    sections: { Overview: "#7fd8cf", Money: "#a5b4fc", Kitchen: "#fdba74", Stock: "#fcd34d", People: "#d8b4fe", Admin: "#cbd5e1" },
  },
  pass: {
    light: false,
    brand: { "50": "#f7fee7", "100": "#ecfccb", "200": "#d9f99d", "300": "#a3e635", "400": "#84cc16", "500": "#65a30d", "600": "#4d7c0f", "700": "#3f6212", "800": "#365314", "900": "#1a2e05", "950": "#0d1a02" },
    surfaces: ["#101214", "#1b1f23", "#232830", "#2e353f"],
    fg: ["#ffffff", "#d7dde5", "#a3adba"],
    aurora: ["#84cc16", "#22d3ee", "#eab308"],
    lines: ["rgba(255,255,255,0.16)", "rgba(255,255,255,0.30)"],
    glass: "#ffffff",
  },
  porcelain: {
    light: true,
    brand: { "50": "#eef4fc", "100": "#d8e6f8", "200": "#aecbf0", "300": "#7aa7e0", "400": "#4b82c9", "500": "#2a63ab", "600": "#1d4c8a", "700": "#16386a", "800": "#122d55", "900": "#0e2442", "950": "#071426" },
    surfaces: ["#f1f0ec", "#fbfaf7", "#f6f4f0", "#e7e4dd"],
    fg: ["#14120f", "#3b3833", "#6b665e"],
    aurora: ["#d8e6f8", "#e7e4dd", "#cfe3f5"],
    lines: ["rgba(20,18,15,0.13)", "rgba(20,18,15,0.24)"],
    glass: "#14120f",
  },
  copper: {
    light: false,
    brand: { "50": "#fdf6ef", "100": "#f9e7d3", "200": "#f6d8b8", "300": "#eab78a", "400": "#d9985f", "500": "#c07b3e", "600": "#9e6130", "700": "#7b4a25", "800": "#5d381d", "900": "#442a16", "950": "#25160b" },
    surfaces: ["#121011", "#1d1a1b", "#262223", "#322d2e"],
    fg: ["#f7f2ef", "#d3c8c3", "#a2938c"],
    aurora: ["#c07b3e", "#8b5cf6", "#eab78a"],
    lines: ["rgba(255,255,255,0.13)", "rgba(255,255,255,0.24)"],
    glass: "#ffffff",
  },
};

const TRIAD: Record<string, string[]> = {
  "service-light": ["#0f766e", "#a16207", "#b91c1c"],
  "service-dark": ["#5eead4", "#fcd34d", "#fb7185"],
  pass: ["#a3e635", "#fbbf24", "#fb7185"],
  porcelain: ["#15803d", "#a16207", "#b91c1c"],
  copper: ["#6ee7b7", "#fcd34d", "#fb7185"],
};

async function proxyApi(ctx: BrowserContext) {
  await ctx.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const req = route.request();
    const headers = { ...req.headers() };
    delete headers.host;
    delete headers.origin;
    delete headers.referer;
    try {
      const res = await ctx.request.fetch(LIVE + url.pathname + url.search, {
        method: req.method(),
        headers,
        data: req.postDataBuffer() ?? undefined,
        maxRedirects: 5,
        timeout: 30_000,
      });
      const body = await res.body();
      const h = { ...res.headers() };
      delete h["content-encoding"];
      delete h["content-length"];
      h["access-control-allow-origin"] = "*";
      await route.fulfill({ status: res.status(), headers: h, body });
    } catch {
      await route.fulfill({ status: 502, body: "{}" });
    }
  });
}

async function apply(page: Page, key: string) {
  const p = PROTOS[key];
  await page.evaluate(
    (args: { proto: Proto; tri: string[] }) => {
      const { proto, tri } = args;
      // themeVars is applied TWICE in this app: ThemeProvider puts it on :root
      // and AppShell puts it again, inline, on the .mise-app div. The inline
      // one wins for everything inside the shell, so a prototype that only
      // touches :root gets silently shadowed. Paint both.
      const targets: HTMLElement[] = [document.documentElement];
      document.querySelectorAll(".mise-app").forEach((el) => targets.push(el as HTMLElement));
      for (const r of targets) {
        for (const s of Object.keys(proto.brand)) r.style.setProperty("--color-brand-" + s, proto.brand[s]);
        r.style.setProperty("--color-shell", proto.surfaces[0]);
        r.style.setProperty("--color-paper", proto.surfaces[1]);
        r.style.setProperty("--color-paper-2", proto.surfaces[2]);
        r.style.setProperty("--color-paper-3", proto.surfaces[3]);
        r.style.setProperty("--color-line", proto.lines[0]);
        r.style.setProperty("--color-line-2", proto.lines[1]);
        r.style.setProperty("--color-glass", proto.glass);
        r.style.setProperty("--color-fg", proto.fg[0]);
        r.style.setProperty("--color-fg-soft", proto.fg[1]);
        r.style.setProperty("--color-fg-faint", proto.fg[2]);
        r.style.setProperty("--mise-aurora-1", proto.aurora[0]);
        r.style.setProperty("--mise-aurora-2", proto.aurora[1]);
        r.style.setProperty("--mise-aurora-3", proto.aurora[2]);
        r.style.setProperty("--tone-good", tri[0]);
        r.style.setProperty("--tone-warn", tri[1]);
        r.style.setProperty("--tone-info", tri[2]);
        r.setAttribute("data-mode", proto.light ? "light" : "dark");
        r.style.colorScheme = proto.light ? "light" : "dark";
      }
      const r = document.documentElement;
      if (proto.sections) {
        const secs = proto.sections;
        document.querySelectorAll("nav > div").forEach((d) => {
          const h = d.querySelector("p");
          const name = h && h.textContent ? h.textContent.trim() : "";
          if (name && secs[name]) {
            (d as HTMLElement).dataset.section = name;
            (d as HTMLElement).style.setProperty("--sec", secs[name]);
          }
        });
      }
    },
    { proto: p, tri: TRIAD[key] },
  );

  if (p.sections) {
    await page.addStyleTag({
      content: [
        "nav > div[data-section] > p { color: var(--sec) !important; opacity: 1 !important; }",
        "nav > div[data-section] { position: relative; padding-left: 8px; }",
        "nav > div[data-section]::before { content: ''; position: absolute; left: 0; top: 15px; bottom: 4px; width: 2px; border-radius: 2px; background: var(--sec); opacity: 0.5; }",
        "nav > div[data-section] .mise-raised { background: color-mix(in srgb, var(--sec) 90%, transparent) !important; box-shadow: 0 2px 12px -4px color-mix(in srgb, var(--sec) 70%, transparent) !important; }",
      ].join("\n"),
    });
  }
}

test("prototypes", async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  fs.mkdirSync(OUT, { recursive: true });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await proxyApi(ctx);
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
      localStorage.setItem("mise_theme", "dark");
    } catch {
      /* ignore */
    }
  });

  // Sign in through the FORM - the repo's own specs do it this way and it is
  // the only method that has not bounced me to /login halfway through a run.
  await page.goto(LOCAL + "/login", { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 90_000 });
  await page.waitForTimeout(6000);
  const sk = page.getByRole("button", { name: /skip tour/i });
  if (await sk.count()) await sk.first().click().catch(() => {});
  await page.waitForTimeout(800);
  console.log("landed:", page.url());

  for (const k of Object.keys(PROTOS)) {
    await apply(page, k);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, "p3-dash--" + k + ".png") });
    console.log("dash", k);
  }

  await page.getByRole("link", { name: /^Inventory$/ }).first().click();
  await page.waitForTimeout(5500);
  console.log("inventory:", page.url());
  for (const k of Object.keys(PROTOS)) {
    await apply(page, k);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, "p3-inv--" + k + ".png") });
    console.log("inv", k);
  }

  await ctx.close();
});
