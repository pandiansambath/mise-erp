"use client";

import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties } from "react";

// A theme just remaps the brand-* accent palette. We apply it as CSS variables
// on the DASHBOARD shell only (see AppShell), so the public landing page — which
// is not inside the shell — is never affected. The whole app's buttons, sidebar,
// links and accents recolour instantly.

export type ThemeKey = "emerald" | "ocean" | "violet" | "sunset" | "rose" | "graphite";

type Scale = Record<string, string>; // shade -> hex

export const THEMES: Record<ThemeKey, { label: string; brand: Scale }> = {
  emerald: {
    label: "Emerald",
    brand: { "50": "#ecfdf5", "100": "#d1fae5", "200": "#a7f3d0", "300": "#6ee7b7", "400": "#34d399", "500": "#10b981", "600": "#059669", "700": "#047857", "800": "#065f46", "900": "#064e3b", "950": "#022c22" },
  },
  ocean: {
    label: "Ocean",
    brand: { "50": "#ecfeff", "100": "#cffafe", "200": "#a5f3fc", "300": "#67e8f9", "400": "#22d3ee", "500": "#06b6d4", "600": "#0891b2", "700": "#0e7490", "800": "#155e75", "900": "#164e63", "950": "#083344" },
  },
  violet: {
    label: "Violet",
    brand: { "50": "#f5f3ff", "100": "#ede9fe", "200": "#ddd6fe", "300": "#c4b5fd", "400": "#a78bfa", "500": "#8b5cf6", "600": "#7c3aed", "700": "#6d28d9", "800": "#5b21b6", "900": "#4c1d95", "950": "#2e1065" },
  },
  sunset: {
    label: "Sunset",
    brand: { "50": "#fff7ed", "100": "#ffedd5", "200": "#fed7aa", "300": "#fdba74", "400": "#fb923c", "500": "#f97316", "600": "#ea580c", "700": "#c2410c", "800": "#9a3412", "900": "#7c2d12", "950": "#431407" },
  },
  rose: {
    label: "Rose",
    brand: { "50": "#fff1f2", "100": "#ffe4e6", "200": "#fecdd3", "300": "#fda4af", "400": "#fb7185", "500": "#f43f5e", "600": "#e11d48", "700": "#be123c", "800": "#9f1239", "900": "#881337", "950": "#4c0519" },
  },
  graphite: {
    label: "Graphite",
    brand: { "50": "#f8fafc", "100": "#f1f5f9", "200": "#e2e8f0", "300": "#cbd5e1", "400": "#94a3b8", "500": "#475569", "600": "#334155", "700": "#1e293b", "800": "#0f172a", "900": "#020617", "950": "#020617" },
  },
};

const STORAGE_KEY = "mise_theme";
const DEFAULT: ThemeKey = "emerald";

/** CSS variables that override the brand palette for a theme. Apply to a container. */
export function brandVars(key: ThemeKey): CSSProperties {
  const out: Record<string, string> = {};
  for (const [shade, hex] of Object.entries(THEMES[key].brand)) {
    out[`--color-brand-${shade}`] = hex;
  }
  return out as CSSProperties;
}

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
