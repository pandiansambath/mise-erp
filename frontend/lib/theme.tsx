"use client";

import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties } from "react";

// A theme remaps the WHOLE dashboard skin at runtime: the brand-* accent ramp,
// the dark surface tokens (shell/paper/...), the text ramp (fg/...) and the
// aurora colours. Everything is applied as CSS variables on the DASHBOARD
// shell only (see AppShell), so the public landing/auth pages are never
// affected. Tailwind utilities reference these vars (non-inline @theme in
// globals.css), so every corner of every page follows the chosen theme.

export type ThemeKey = "emerald" | "ocean" | "violet" | "sunset" | "rose" | "graphite";

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
};

export const THEMES: Record<ThemeKey, ThemeDef> = {
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
