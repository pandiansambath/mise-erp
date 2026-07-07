"use client";

import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties } from "react";

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
  | "burgundy";

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
  graphite: {
    label: "Graphite Mono",
    brand: { "50": "#f8fafc", "100": "#f1f5f9", "200": "#e2e8f0", "300": "#cbd5e1", "400": "#94a3b8", "500": "#64748b", "600": "#475569", "700": "#334155", "800": "#1e293b", "900": "#0f172a", "950": "#020617" },
    surfaces: ["#0a0c10", "#14181f", "#1a1f28", "#242b36"],
    fg: ["#f1f4f8", "#c3ccd6", "#8d99a8"],
    aurora: ["#64748b", "#94a3b8", "#38bdf8"],
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
};

const STORAGE_KEY = "mise_theme";
const DEFAULT: ThemeKey = "emerald";

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
  }, []);

  const setTheme = useCallback((t: ThemeKey) => {
    setThemeState(t);
    window.localStorage.setItem(STORAGE_KEY, t);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
