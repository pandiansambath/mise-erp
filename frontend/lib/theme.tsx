"use client";

import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties } from "react";
import { api, getToken } from "./api";

// A theme remaps the WHOLE dashboard skin at runtime: the brand-* accent ramp,
// the dark surface tokens (shell/paper/...), the text ramp (fg/...) and the
// aurora colours. Everything is applied as CSS variables on the DASHBOARD
// shell only (see AppShell), so the public landing/auth pages are never
// affected. Tailwind utilities reference these vars (non-inline @theme in
// globals.css), so every corner of every page follows the chosen theme.

export type ThemeKey =
  | "light"
  | "dark"
  | "emerald"
  | "ocean"
  | "violet"
  | "sunset"
  | "rose"
  | "graphite"
  // Light (white) themes with a colour accent
  | "azure"
  | "honey"
  | "apricot"
  | "latte"
  | "claret"
  // Dark themes with new accents
  | "sapphire"
  | "cocoa"
  | "burgundy"
  // 2026-09-15 - the six he asked for: "we need still more theme..unique
  // theme..try multi color kinda theme"
  | "service"
  | "service-dark"
  | "pass"
  | "porcelain"
  | "copper"
  | "chalk"
  | "nocturne";

type Scale = Record<string, string>; // shade -> hex

type ThemeDef = {
  label: string;
  brand: Scale;
  /** page backdrop, card, nested card, strong hover — darkest to lightest */
  surfaces: [string, string, string, string];
  /** primary / secondary / muted text */
  fg: [string, string, string];
  /** the three aurora blob colours */
  aurora: [string, string, string];
  /** hairline + stronger border. Optional — dark themes use the white-alpha
      defaults in globals.css; light themes must supply dark-alpha lines. */
  lines?: [string, string];
  /** true = light mode → AppShell sets color-scheme:light for native controls */
  light?: boolean;
  /** MEANING, not identity - good / warn / bad.
   *  Optional: a theme that omits it inherits the house triad from
   *  globals.css, which is deliberately theme-independent (see 38.1a -
   *  using the brand to mean "healthy" made "in stock" the same colour as
   *  "out of stock" on every red theme). A theme overrides it only when its
   *  ground genuinely needs a different one: Pass is read at two metres, so
   *  its "good" is a safety lime rather than a mint. */
  tones?: [string, string, string];
  /** THE MULTI-COLOUR IDEA, in NAV_GROUPS order:
   *  Overview / Money / Stock / Kitchen / People / Admin.
   *
   *  A multi-coloured BACKGROUND fights legibility - text needs one
   *  predictable ground, and a kitchen tablet in glare needs it most. So
   *  the colour goes on the STRUCTURE instead: the nav group label, its
   *  spine, and the active pill. You can tell Money from Stock at a glance
   *  and not one word of body text changes contrast. Every hue clears
   *  6.8:1 on its own ground. */
  sections?: [string, string, string, string, string, string];
  /** base colour for alpha "glass" overlays (border-glass/α, bg-glass/α).
      Defaults to white (dark themes); the Light theme sets a dark tint. */
  glass?: string;
};

export const THEMES: Record<ThemeKey, ThemeDef> = {
  light: {
    label: "Daylight (Light)",
    brand: { "50": "#ecfdf5", "100": "#d1fae5", "200": "#a7f3d0", "300": "#6ee7b7", "400": "#34d399", "500": "#10b981", "600": "#059669", "700": "#047857", "800": "#065f46", "900": "#064e3b", "950": "#022c22" },
    surfaces: ["#eef2f6", "#ffffff", "#f6f8fb", "#e8edf3"],
    fg: ["#0f172a", "#334155", "#64748b"],
    aurora: ["#a7f3d0", "#bae6fd", "#99f6e4"],
    lines: ["rgba(15,23,42,0.10)", "rgba(15,23,42,0.18)"],
    glass: "#0f172a",
    light: true,
  },
  dark: {
    label: "Carbon (Dark)",
    brand: { "50": "#ecfdf5", "100": "#d1fae5", "200": "#a7f3d0", "300": "#6ee7b7", "400": "#34d399", "500": "#10b981", "600": "#059669", "700": "#047857", "800": "#065f46", "900": "#064e3b", "950": "#022c22" },
    surfaces: ["#0a0c10", "#14181f", "#1a1f28", "#242b36"],
    fg: ["#f1f5f9", "#cbd5e1", "#94a3b8"],
    aurora: ["#10b981", "#0ea5e9", "#14b8a6"],
  },
  emerald: {
    label: "Emerald Midnight",
    brand: { "50": "#ecfdf5", "100": "#d1fae5", "200": "#a7f3d0", "300": "#6ee7b7", "400": "#34d399", "500": "#10b981", "600": "#059669", "700": "#047857", "800": "#065f46", "900": "#064e3b", "950": "#022c22" },
    surfaces: ["#04120d", "#0a2018", "#0e2a1f", "#14352a"],
    fg: ["#eef6f1", "#bdd0c6", "#87a294"],
    aurora: ["#10b981", "#0ea5e9", "#14b8a6"],
  },
  ocean: {
    label: "Ocean Abyss",
    brand: { "50": "#ecfeff", "100": "#cffafe", "200": "#a5f3fc", "300": "#67e8f9", "400": "#22d3ee", "500": "#06b6d4", "600": "#0891b2", "700": "#0e7490", "800": "#155e75", "900": "#164e63", "950": "#083344" },
    surfaces: ["#050d17", "#0a1a2a", "#0e2235", "#143047"],
    fg: ["#eef4f9", "#bdd0de", "#85a0b5"],
    aurora: ["#06b6d4", "#3b82f6", "#22d3ee"],
  },
  violet: {
    label: "Royal Velvet",
    brand: { "50": "#f5f3ff", "100": "#ede9fe", "200": "#ddd6fe", "300": "#c4b5fd", "400": "#a78bfa", "500": "#8b5cf6", "600": "#7c3aed", "700": "#6d28d9", "800": "#5b21b6", "900": "#4c1d95", "950": "#2e1065" },
    surfaces: ["#0a0714", "#170f2a", "#1e1535", "#2a1e4a"],
    fg: ["#f2eefb", "#cdc2e2", "#9a8cba"],
    aurora: ["#8b5cf6", "#d946ef", "#6366f1"],
  },
  sunset: {
    label: "Ember Glow",
    brand: { "50": "#fff7ed", "100": "#ffedd5", "200": "#fed7aa", "300": "#fdba74", "400": "#fb923c", "500": "#f97316", "600": "#ea580c", "700": "#c2410c", "800": "#9a3412", "900": "#7c2d12", "950": "#431407" },
    surfaces: ["#140a05", "#261408", "#321b0e", "#432817"],
    fg: ["#fbf2ea", "#e0cbb8", "#b59a82"],
    aurora: ["#f97316", "#f43f5e", "#f59e0b"],
  },
  rose: {
    label: "Rosé Noir",
    brand: { "50": "#fff1f2", "100": "#ffe4e6", "200": "#fecdd3", "300": "#fda4af", "400": "#fb7185", "500": "#f43f5e", "600": "#e11d48", "700": "#be123c", "800": "#9f1239", "900": "#881337", "950": "#4c0519" },
    surfaces: ["#14060b", "#260d18", "#33121f", "#471a2c"],
    fg: ["#fbeef3", "#e2c2cf", "#b88a9c"],
    aurora: ["#f43f5e", "#d946ef", "#fb7185"],
  },
  /** WAS "Graphite Mono", and it had no accent at all: brand-300 #cbd5e1
   *  against body text #c3ccd6 is 1.09, so every link was the same grey as
   *  the paragraph above it and nothing on the page could indicate
   *  anything. A monochrome ground with ONE hot accent is the classic
   *  answer: the greys stay, the accent is now a signal amber. */
  graphite: {
    label: "Graphite (Signal)",
    brand: { "50": "#fffbeb", "100": "#fef3c7", "200": "#fde68a", "300": "#fcd34d", "400": "#fbbf24", "500": "#f59e0b", "600": "#d97706", "700": "#b45309", "800": "#92400e", "900": "#78350f", "950": "#451a03" },
    surfaces: ["#0a0c10", "#14181f", "#1a1f28", "#242b36"],
    fg: ["#f1f4f8", "#c3ccd6", "#8d99a8"],
    aurora: ["#f59e0b", "#94a3b8", "#38bdf8"],
    lines: ["rgba(255,255,255,0.14)", "rgba(255,255,255,0.26)"],
  },

  // ── Light (white) themes — same bright surfaces, different accent ──
  azure: {
    label: "Blue (Light)",
    brand: { "50": "#eff6ff", "100": "#dbeafe", "200": "#bfdbfe", "300": "#93c5fd", "400": "#60a5fa", "500": "#3b82f6", "600": "#2563eb", "700": "#1d4ed8", "800": "#1e40af", "900": "#1e3a8a", "950": "#172554" },
    surfaces: ["#eef2f7", "#f8fbff", "#f5f8fc", "#e7eef7"],
    fg: ["#0f172a", "#334155", "#64748b"],
    aurora: ["#bfdbfe", "#93c5fd", "#a5f3fc"],
    lines: ["rgba(15,23,42,0.10)", "rgba(15,23,42,0.18)"],
    glass: "#0f172a",
    light: true,
  },
  honey: {
    label: "Yellow (Light)",
    brand: { "50": "#fffbeb", "100": "#fef3c7", "200": "#fde68a", "300": "#fcd34d", "400": "#fbbf24", "500": "#f59e0b", "600": "#d97706", "700": "#b45309", "800": "#92400e", "900": "#78350f", "950": "#451a03" },
    surfaces: ["#f4f1ea", "#fffdf6", "#faf7f0", "#efe9dc"],
    fg: ["#1c1917", "#44403c", "#78716c"],
    aurora: ["#fde68a", "#fcd34d", "#fed7aa"],
    lines: ["rgba(28,25,23,0.10)", "rgba(28,25,23,0.18)"],
    glass: "#1c1917",
    light: true,
  },
  apricot: {
    label: "Orange (Light)",
    brand: { "50": "#fff7ed", "100": "#ffedd5", "200": "#fed7aa", "300": "#fdba74", "400": "#fb923c", "500": "#f97316", "600": "#ea580c", "700": "#c2410c", "800": "#9a3412", "900": "#7c2d12", "950": "#431407" },
    surfaces: ["#f4f0ec", "#fffbf6", "#faf6f1", "#efe7de"],
    fg: ["#1c1917", "#44403c", "#78716c"],
    aurora: ["#fed7aa", "#fdba74", "#fecaca"],
    lines: ["rgba(28,25,23,0.10)", "rgba(28,25,23,0.18)"],
    glass: "#1c1917",
    light: true,
  },
  latte: {
    label: "Brown (Light)",
    brand: { "50": "#f7f3ef", "100": "#ece0d5", "200": "#dcc3ad", "300": "#c8a07f", "400": "#b07d54", "500": "#96603a", "600": "#7c4d2e", "700": "#633c25", "800": "#4d2f1e", "900": "#382317", "950": "#21140c" },
    surfaces: ["#f3efe9", "#fdf9f2", "#f9f5ef", "#ede6db"],
    fg: ["#1c1512", "#44372f", "#7c6a5d"],
    aurora: ["#dcc3ad", "#c8a07f", "#e7d3bf"],
    lines: ["rgba(28,21,18,0.10)", "rgba(28,21,18,0.18)"],
    glass: "#1c1512",
    light: true,
  },
  claret: {
    label: "Burgundy (Light)",
    brand: { "50": "#fdf2f4", "100": "#fbe0e6", "200": "#f6c2ce", "300": "#ec96aa", "400": "#dd5f7e", "500": "#c4365a", "600": "#a11f44", "700": "#800020", "800": "#6d1120", "900": "#5c1420", "950": "#33060f" },
    surfaces: ["#f4eef0", "#fef9fb", "#faf4f5", "#eee4e7"],
    fg: ["#1a1114", "#3f2b30", "#75565e"],
    aurora: ["#f6c2ce", "#ec96aa", "#e9d5ff"],
    lines: ["rgba(26,17,20,0.10)", "rgba(26,17,20,0.18)"],
    glass: "#1a1114",
    light: true,
  },

  // ── Dark themes with new accents ──
  sapphire: {
    label: "Blue (Dark)",
    brand: { "50": "#eff6ff", "100": "#dbeafe", "200": "#bfdbfe", "300": "#93c5fd", "400": "#60a5fa", "500": "#3b82f6", "600": "#2563eb", "700": "#1d4ed8", "800": "#1e40af", "900": "#1e3a8a", "950": "#172554" },
    surfaces: ["#060a14", "#0e1626", "#131d33", "#1c2a49"],
    fg: ["#eef2f9", "#c1cde0", "#8595b3"],
    aurora: ["#3b82f6", "#6366f1", "#22d3ee"],
  },
  cocoa: {
    label: "Brown (Dark)",
    brand: { "50": "#f7f3ef", "100": "#ece0d5", "200": "#dcc3ad", "300": "#c8a07f", "400": "#b07d54", "500": "#9a6a3f", "600": "#7c4d2e", "700": "#633c25", "800": "#4d2f1e", "900": "#382317", "950": "#21140c" },
    surfaces: ["#100a06", "#1e150e", "#271b12", "#37271a"],
    fg: ["#f4ede6", "#d3c3b4", "#a48d78"],
    aurora: ["#b07d54", "#d97706", "#c8a07f"],
  },
  burgundy: {
    label: "Burgundy (Dark)",
    brand: { "50": "#fdf2f4", "100": "#fbe0e6", "200": "#f6c2ce", "300": "#ec96aa", "400": "#dd5f7e", "500": "#c4365a", "600": "#a11f44", "700": "#800020", "800": "#6d1120", "900": "#5c1420", "950": "#33060f" },
    surfaces: ["#120409", "#240a14", "#30101c", "#451627"],
    fg: ["#f8ecf0", "#e0c0cb", "#b8899a"],
    aurora: ["#c4365a", "#a11f44", "#e11d48"],
  },

  // ======================================================================
  //  2026-09-15 - six new themes.
  //
  //      "we need still more theme..unique theme..try multi color kinda
  //       theme..please think deeply and have more theme..impressive themes"
  //
  //  Designed against measured contrast rather than taste, and each for a
  //  real moment rather than for a colour: a wall tablet in glare, an hour of
  //  payroll columns at midnight, a phone at 6am in a dim room.
  // ======================================================================

  /** THE MULTI-COLOUR ONE. Each section of the app gets its own hue, carried
   *  on the nav and never on a reading surface. For the owner who lives in the
   *  whole app and wants to know where they are without reading. */
  service: {
    label: "Service (Multi-colour)",
    brand: { "50": "#f0faf8", "100": "#d7f2ee", "200": "#a9e5dd", "300": "#5ec8bd", "400": "#33a99e", "500": "#1a8a80", "600": "#0f6f67", "700": "#0b574f", "800": "#094741", "900": "#073833", "950": "#04211e" },
    surfaces: ["#f2f4f3", "#ffffff", "#f7f9f8", "#e9edec"],
    fg: ["#101a18", "#3c4a47", "#6d7d79"],
    aurora: ["#a9e5dd", "#c7d2fe", "#fde68a"],
    lines: ["rgba(16,26,24,0.12)", "rgba(16,26,24,0.22)"],
    glass: "#101a18",
    light: true,
    tones: ["#0f766e", "#a16207", "#b91c1c"],
    sections: ["#0b574f", "#3730a3", "#8a4b06", "#9a3412", "#6b21a8", "#334155"],
  },
  "service-dark": {
    label: "Service (Multi-colour, Dark)",
    brand: { "50": "#f2fbfa", "100": "#dcf5f1", "200": "#b3e9e2", "300": "#7fd8cf", "400": "#4cc0b4", "500": "#2aa196", "600": "#1b8178", "700": "#13645d", "800": "#0f4f49", "900": "#0b3c38", "950": "#06241f" },
    surfaces: ["#0b1211", "#131c1b", "#182322", "#21302e"],
    fg: ["#eaf2f0", "#b8c9c6", "#859794"],
    aurora: ["#4cc0b4", "#a5b4fc", "#fcd34d"],
    lines: ["rgba(255,255,255,0.14)", "rgba(255,255,255,0.26)"],
    tones: ["#5eead4", "#fcd34d", "#fb7185"],
    sections: ["#7fd8cf", "#a5b4fc", "#fcd34d", "#fdba74", "#d8b4fe", "#cbd5e1"],
  },

  /** The wall tablet in a hot kitchen, read at two metres through glare. The
   *  only theme tuned for AMBIENT LIGHT: borders at nearly double the house
   *  default, pure-white primary text, and a safety lime that reads at
   *  distance. Its "good" is that same lime, on purpose. */
  pass: {
    label: "Pass (Kitchen)",
    brand: { "50": "#f7fee7", "100": "#ecfccb", "200": "#d9f99d", "300": "#a3e635", "400": "#84cc16", "500": "#65a30d", "600": "#4d7c0f", "700": "#3f6212", "800": "#365314", "900": "#1a2e05", "950": "#0d1a02" },
    surfaces: ["#101214", "#1b1f23", "#232830", "#2e353f"],
    fg: ["#ffffff", "#d7dde5", "#a3adba"],
    aurora: ["#84cc16", "#22d3ee", "#a3e635"],
    lines: ["rgba(255,255,255,0.16)", "rgba(255,255,255,0.30)"],
    tones: ["#a3e635", "#fbbf24", "#fb7185"],
  },

  /** Payroll at midnight - an hour of reading columns of numbers. Warm paper,
   *  near-zero chroma in the ground, ink-blue accent. */
  porcelain: {
    label: "Porcelain (Light)",
    brand: { "50": "#f2f7fd", "100": "#e0ecf9", "200": "#c2d9f1", "300": "#7aa7e0", "400": "#4b82c9", "500": "#2a63ab", "600": "#1d4c8a", "700": "#16386a", "800": "#112b52", "900": "#0d2040", "950": "#071426" },
    surfaces: ["#f1f0ec", "#fbfaf7", "#f6f4f0", "#e7e4dd"],
    fg: ["#14120f", "#3b3833", "#6b665e"],
    aurora: ["#c2d9f1", "#e7e4dd", "#d6e4f7"],
    lines: ["rgba(20,18,15,0.13)", "rgba(20,18,15,0.24)"],
    glass: "#14120f",
    light: true,
    tones: ["#15803d", "#a16207", "#b91c1c"],
  },

  /** The premium, guest-facing identity - designed so the diner's QR page and
   *  the owner's dashboard look like the same restaurant. */
  copper: {
    label: "Copper Service (Dark)",
    brand: { "50": "#fdf7f1", "100": "#f9ebdc", "200": "#f2d8bc", "300": "#eab78a", "400": "#d9985f", "500": "#c07b3e", "600": "#9e6130", "700": "#7b4a25", "800": "#5e381c", "900": "#422714", "950": "#26160b" },
    surfaces: ["#121011", "#1d1a1b", "#262223", "#322d2e"],
    fg: ["#f7f2ef", "#d3c8c3", "#a2938c"],
    aurora: ["#d9985f", "#c07b3e", "#eab78a"],
    lines: ["rgba(255,255,255,0.13)", "rgba(255,255,255,0.24)"],
    tones: ["#6ee7b7", "#fcd34d", "#fb7185"],
  },

  /** Bright kitchens, older eyes, greasy screens. Maximum contrast, and every
   *  border a real drawn line - affordance drawn, not implied. */
  chalk: {
    label: "Chalk (High contrast)",
    brand: { "50": "#eff6ff", "100": "#dbeafe", "200": "#bfdbfe", "300": "#6ea8f5", "400": "#2f7ae5", "500": "#0b5fd0", "600": "#0949a4", "700": "#06377c", "800": "#04295c", "900": "#031c40", "950": "#021026" },
    surfaces: ["#ffffff", "#ffffff", "#f4f6f8", "#e6eaee"],
    fg: ["#000000", "#23282e", "#4a5158"],
    aurora: ["#bfdbfe", "#e6eaee", "#dbeafe"],
    lines: ["rgba(0,0,0,0.22)", "rgba(0,0,0,0.38)"],
    glass: "#000000",
    light: true,
    tones: ["#15803d", "#a16207", "#b91c1c"],
  },

  /** The 6am phone in a dim room, and the midnight shift. Zero blue in the
   *  ground - warm-black rather than blue-black - at the lowest maximum
   *  luminance of the set. */
  nocturne: {
    label: "Nocturne (Dark)",
    brand: { "50": "#f1faf6", "100": "#dbf3e9", "200": "#b6e6d3", "300": "#7fd1b0", "400": "#4fb894", "500": "#2f9a78", "600": "#237a5f", "700": "#1b5e49", "800": "#14483a", "900": "#0f372c", "950": "#08201a" },
    surfaces: ["#14110f", "#1e1a18", "#272220", "#332c29"],
    fg: ["#f5efe9", "#cfc4bb", "#9c9088"],
    aurora: ["#4fb894", "#7fd1b0", "#2f9a78"],
    lines: ["rgba(255,255,255,0.13)", "rgba(255,255,255,0.24)"],
    tones: ["#6ee7b7", "#fcd34d", "#fb7185"],
  },
};


const STORAGE_KEY = "mise_theme";
// Burgundy, not green. His call: a hotel opening its dashboard for the FIRST
// time should land on the brand's own colour.
//
// This only decides what somebody sees before they have chosen anything —
// ThemeProvider reads localStorage first, so every existing account keeps
// exactly the theme it is on and nobody's screen changes underneath them.
// "claret" is Burgundy (Light); "burgundy" is the dark cut of the same hue.
/** Exported so a PUBLIC screen can pin a sane theme instead of inheriting
 *  whatever the visitor happens to have saved for their own business. */
export const DEFAULT_THEME: ThemeKey = "claret";
const DEFAULT: ThemeKey = DEFAULT_THEME;

/** Every CSS variable a theme drives. Apply to the dashboard shell container. */
export function themeVars(key: ThemeKey): CSSProperties {
  const t = THEMES[key];
  const out: Record<string, string> = {};
  for (const [shade, hex] of Object.entries(t.brand)) {
    out[`--color-brand-${shade}`] = hex;
  }
  const [shell, paper, paper2, paper3] = t.surfaces;
  out["--color-shell"] = shell;
  out["--color-paper"] = paper;
  out["--color-paper-2"] = paper2;
  out["--color-paper-3"] = paper3;
  if (t.lines) {
    out["--color-line"] = t.lines[0];
    out["--color-line-2"] = t.lines[1];
  }
  if (t.glass) out["--color-glass"] = t.glass;
  const [fg, soft, faint] = t.fg;
  out["--color-fg"] = fg;
  out["--color-fg-soft"] = soft;
  out["--color-fg-faint"] = faint;
  if (t.tones) {
    out["--tone-good"] = t.tones[0];
    out["--tone-warn"] = t.tones[1];
    out["--tone-bad"] = t.tones[2];
  }
  if (t.sections) {
    t.sections.forEach((hex, i) => {
      out[`--sect-${i + 1}`] = hex;
    });
  }
  const [a1, a2, a3] = t.aurora;
  out["--mise-aurora-1"] = a1;
  out["--mise-aurora-2"] = a2;
  out["--mise-aurora-3"] = a3;
  return out as CSSProperties;
}

/** @deprecated kept for any stragglers — same as themeVars. */
export const brandVars = themeVars;

interface ThemeState {
  theme: ThemeKey;
  setTheme: (t: ThemeKey) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeKey>(DEFAULT);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) as ThemeKey | null;
    if (saved && saved in THEMES) setThemeState(saved);

    // THE THEME BELONGS TO THE RESTAURANT, NOT TO THE BROWSER.
    //
    // It was only ever read from localStorage, so it did not follow the owner
    // to a second laptop, to their phone, or to a new browser profile — they
    // signed in and the app was a different colour. The switcher has always
    // WRITTEN it to the database (`PATCH /hotels/me`); nothing ever read it
    // back.
    //
    // localStorage stays as the fast local cache so there is no flash of the
    // wrong colour on load; the database is the source of truth and wins a
    // moment later. Only for someone signed in — this provider also wraps
    // every public page, and an anonymous visitor must not trigger a 401 on
    // the landing page.
    if (!getToken()) return;
    let cancelled = false;
    api
      .get<{ theme?: string | null }>("/hotels/me")
      .then((h) => {
        const t = h?.theme;
        if (cancelled || !t || !(t in THEMES) || t === saved) return;
        setThemeState(t as ThemeKey);
        window.localStorage.setItem(STORAGE_KEY, t);
      })
      .catch(() => {
        /* offline, or no permission to read the hotel — keep the local one */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback((t: ThemeKey) => {
    setThemeState(t);
    window.localStorage.setItem(STORAGE_KEY, t);
  }, []);

  // Apply the theme's CSS variables to :root (documentElement) so EVERYTHING —
  // including popovers portaled to <body> (e.g. the Select dropdown) — inherits the
  // active theme, not the default. Fixes green dropdowns while on a brown theme.
  useEffect(() => {
    const root = document.documentElement;
    const vars = themeVars(theme) as unknown as Record<string, string>;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.setAttribute("data-mode", THEMES[theme].light ? "light" : "dark");
    root.style.colorScheme = THEMES[theme].light ? "light" : "dark";
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
