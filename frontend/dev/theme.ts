// Themes and designs for pandi-dev.
//
//   "i need few more themes… light theme too… so many dual or triple colour
//    combinations or 4 colour combinations… it needs to render all the things"
//
// Every colour on the page is a CSS variable (--d-*), set inline on the page's
// root from the theme chosen here. Components never name a colour; they name a
// role: the page background, the strongest ink, accent A… so a theme only has
// to say what each role is, and the whole page follows, canvases included
// (they read the same variables, see readRGB below).
//
// The default theme and design come from his site.json (set with his
// password); a visitor's own pick is remembered in their browser only.

import type { CSSProperties } from "react";

export type Theme = {
  id: string;
  name: string;
  light?: boolean;
  /** How many of a, b, c, d the swatch shows: the theme's "combination". */
  tones: 2 | 3 | 4;
  bg: string;
  bg2: string;
  /** Accent A and its lighter step, accent B and its lighter step, then C, D. */
  a: string;
  a2: string;
  b: string;
  b2: string;
  c: string;
  d: string;
  gold: string;
  /** Text on an accent-filled button. */
  on: string;
};

const DARK_INK = {
  ink: "#e6edf5",
  ink2: "#c3d3e4",
  ink3: "#a9bdd2",
  ink4: "#7d93ad",
  ink5: "#5b6e85",
  ink6: "#4a5c70",
  ink7: "#334152",
  line: "rgba(255,255,255,.07)",
  line2: "rgba(255,255,255,.16)",
  glass: "rgba(255,255,255,.025)",
  shade: "rgba(0,0,0,.25)",
};
const LIGHT_INK = {
  ink: "#141a22",
  ink2: "#26303c",
  ink3: "#3f4a58",
  ink4: "#596574",
  ink5: "#737f8d",
  ink6: "#8c97a3",
  ink7: "#aeb7c1",
  line: "rgba(20,26,34,.11)",
  line2: "rgba(20,26,34,.24)",
  glass: "rgba(255,255,255,.62)",
  shade: "rgba(20,26,34,.05)",
};

export const THEMES: Theme[] = [
  { id: "chain", name: "Chain", tones: 2, bg: "#070a0f", bg2: "#0b1118", a: "#d97742", a2: "#f0a064", b: "#2dd4bf", b2: "#7df0dc", c: "#9b8cff", d: "#f472b6", gold: "#f0bd6a", on: "#071016" },
  { id: "daylight", name: "Daylight", light: true, tones: 2, bg: "#f5f1ea", bg2: "#ebe4d8", a: "#c2591f", a2: "#d9772f", b: "#0d9488", b2: "#0f766e", c: "#6d5bd0", d: "#db2777", gold: "#b7791f", on: "#ffffff" },
  { id: "paper", name: "Ink & Paper", light: true, tones: 2, bg: "#fafaf7", bg2: "#efeee8", a: "#18181b", a2: "#3f3f46", b: "#e11d48", b2: "#be123c", c: "#2563eb", d: "#16a34a", gold: "#a16207", on: "#ffffff" },
  { id: "frost", name: "Frost", light: true, tones: 3, bg: "#eef3f8", bg2: "#e0e8f1", a: "#2563eb", a2: "#3b82f6", b: "#0891b2", b2: "#0e7490", c: "#7c3aed", d: "#db2777", gold: "#b45309", on: "#ffffff" },
  { id: "lavender", name: "Lavender", light: true, tones: 3, bg: "#f6f3fb", bg2: "#ebe4f6", a: "#7c3aed", a2: "#8b5cf6", b: "#db2777", b2: "#be185d", c: "#0891b2", d: "#ea580c", gold: "#b45309", on: "#ffffff" },
  { id: "aurora", name: "Aurora", tones: 3, bg: "#070712", bg2: "#0e0d22", a: "#a78bfa", a2: "#c4b5fd", b: "#22d3ee", b2: "#67e8f9", c: "#f472b6", d: "#34d399", gold: "#fcd34d", on: "#0b0820" },
  { id: "sunset", name: "Sunset", tones: 3, bg: "#120a10", bg2: "#1c1018", a: "#fb7185", a2: "#fda4af", b: "#fb923c", b2: "#fdba74", c: "#a855f7", d: "#facc15", gold: "#fcd34d", on: "#1a0b10" },
  { id: "ocean", name: "Ocean", tones: 3, bg: "#04101a", bg2: "#081a2a", a: "#38bdf8", a2: "#7dd3fc", b: "#2dd4bf", b2: "#5eead4", c: "#6366f1", d: "#a3e635", gold: "#fde68a", on: "#03121c" },
  { id: "forest", name: "Forest", tones: 3, bg: "#07110b", bg2: "#0c1a12", a: "#a3e635", a2: "#bef264", b: "#34d399", b2: "#6ee7b7", c: "#facc15", d: "#fb923c", gold: "#fde047", on: "#08140b" },
  { id: "cyber", name: "Cyberpunk", tones: 4, bg: "#0a0614", bg2: "#140b24", a: "#ff2bd6", a2: "#ff7ae6", b: "#00f0ff", b2: "#7df9ff", c: "#fff200", d: "#8b5cf6", gold: "#fff200", on: "#0a0614" },
  { id: "tropical", name: "Tropical", tones: 4, bg: "#0a0d14", bg2: "#121826", a: "#ff7a59", a2: "#ffa07f", b: "#14d3b5", b2: "#6ff0d8", c: "#ffd23f", d: "#9b5de5", gold: "#ffd23f", on: "#0a0d14" },
  { id: "royal", name: "Royal", tones: 2, bg: "#0b0816", bg2: "#151028", a: "#e7b84b", a2: "#f5d07a", b: "#8b5cf6", b2: "#a78bfa", c: "#f472b6", d: "#22d3ee", gold: "#f5d07a", on: "#120c02" },
  { id: "midnight", name: "Midnight", tones: 2, bg: "#05070f", bg2: "#0b1020", a: "#818cf8", a2: "#a5b4fc", b: "#94a3b8", b2: "#cbd5e1", c: "#38bdf8", d: "#f0abfc", gold: "#e2e8f0", on: "#05070f" },
  { id: "rose", name: "Rose", tones: 4, bg: "#12080d", bg2: "#1d0e16", a: "#f9a8d4", a2: "#fbcfe8", b: "#fdba74", b2: "#fed7aa", c: "#c084fc", d: "#5eead4", gold: "#fcd34d", on: "#1d0e16" },
  { id: "matrix", name: "Matrix", tones: 2, bg: "#020803", bg2: "#051208", a: "#22c55e", a2: "#4ade80", b: "#86efac", b2: "#bbf7d0", c: "#15803d", d: "#a3e635", gold: "#bef264", on: "#020803" },
];

export const DEFAULT_THEME = "chain";

export type DesignId = "chain" | "metro" | "chronicle" | "terminal" | "bento" | "blueprint" | "stories" | "ember" | "kal";

type Design = { id: DesignId; name: string; slogan: string; blurb: string };

export const DESIGNS: Design[] = [
  { id: "chain", name: "Chain Reaction", slogan: "Life doesn’t stop. It moves like a chain.", blurb: "The original: a solar system of skills and a chain that lights as you scroll." },
  { id: "metro", name: "Metro", slogan: "Every line leads somewhere.", blurb: "His career as a transit map. Ride the line from 2019 to today." },
  { id: "chronicle", name: "The Chronicle", slogan: "Printed in Chennai. Read everywhere.", blurb: "A newspaper front page, today’s edition, with him as the lead story." },
  { id: "terminal", name: "Terminal", slogan: "$ whoami", blurb: "The whole site as a console. Type, or watch it boot." },
  { id: "bento", name: "Bento", slogan: "Everything, at a glance.", blurb: "One screen of tiles: every part of him, live, without scrolling." },
  { id: "blueprint", name: "Blueprint", slogan: "Drawn to scale.", blurb: "His career as an engineering drawing: plotted line by line, with data flowing through it." },
  { id: "stories", name: "Stories", slogan: "Tap through a life.", blurb: "Full-screen stories made of his own photos, with a profile and posts beside them." },
  { id: "ember", name: "Ember", slogan: "Light, made from the dark.", blurb: "A cinematic 3D scene: an iridescent chain turns as you scroll through embers of light." },
];

/** Being built: opened by its link only (?design=kal), not in the Themes window yet (§107.2). */
const HIDDEN: DesignId[] = ["kal"];

export const DEFAULT_DESIGN: DesignId = "chain";

export function findTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function isDesign(id: string | null | undefined): id is DesignId {
  return DESIGNS.some((d) => d.id === id) || HIDDEN.some((d) => d === id);
}

/** The inline style that makes a theme real: every --d-* variable. */
export function themeStyle(t: Theme): CSSProperties {
  const ink = t.light ? LIGHT_INK : DARK_INK;
  const vars: Record<string, string> = {
    "--d-bg": t.bg,
    "--d-bg2": t.bg2,
    "--d-a": t.a,
    "--d-a2": t.a2,
    "--d-b": t.b,
    "--d-b2": t.b2,
    "--d-c": t.c,
    "--d-d": t.d,
    "--d-gold": t.gold,
    "--d-on": t.on,
  };
  for (const [k, val] of Object.entries(ink)) vars[`--d-${k}`] = val;
  return { ...(vars as CSSProperties), colorScheme: t.light ? "light" : "dark" };
}

/** A role, as a CSS value: v("a") → var(--d-a). */
export const v = (role: string) => `var(--d-${role})`;

/** A colour at a strength, for glows and washes: mix(v("a"), 12). */
export const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** A role's colour as [r, g, b], for canvases, which cannot read var(). The
 *  browser resolves it through a probe element, so any colour syntax works. */
export function readRGB(el: Element, role: string, fallback: [number, number, number]): [number, number, number] {
  try {
    const probe = document.createElement("span");
    probe.style.color = `var(--d-${role})`;
    probe.style.display = "none";
    el.appendChild(probe);
    const rgb = getComputedStyle(probe).color.match(/[\d.]+/g);
    probe.remove();
    if (rgb && rgb.length >= 3) return [Math.round(+rgb[0]), Math.round(+rgb[1]), Math.round(+rgb[2])];
  } catch {
    /* fall through */
  }
  return fallback;
}

/** Canvases listen for this to re-read their colours after a switch. */
export const THEME_EVENT = "pandi-dev-theme";
