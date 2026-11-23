// His words for the site — the Template (23 Nov).
//
//   "also I need one feature called a template area → hide it in PS… in this
//    area I can change most of the text, like the name, and the font of that
//    name, and colours if needed… then the slogan… then the company name, Tata
//    Consultancy Services, TCS… then the System Engineer role… all I can change
//    if needed… also a single-click button to make all default… literally this
//    whole site I want customisable… literally all texts"
//
// Every editable piece of text has a KEY here and its original words. The page
// reads `copy[key]` (DevContext); his changes live in dev-site/texts.json (set
// behind the PS door, owner panel → Template); anything he has not changed is
// the original, and "every word back" saves it empty. The owner panel's form is
// made from COPY_GROUPS, so a new editable text is one line here. Plain module
// (no "use client"): the server reads the defaults too.

export type CopyField = { key: string; label: string; def: string; long?: boolean };

export const COPY_GROUPS: { title: string; fields: CopyField[] }[] = [
  {
    title: "Who you are",
    fields: [
      { key: "name", label: "Your name", def: "Pandian Sambath" },
      { key: "hello", label: "The greeting above it", def: "HELLO, I’M" },
      { key: "role", label: "Your role", def: "System Engineer" },
      { key: "at", label: "The word between role and company", def: "at" },
      { key: "company", label: "Your company", def: "Tata Consultancy Services" },
      { key: "place", label: "Where you are", def: "CHENNAI, INDIA" },
      { key: "barLine", label: "The line under your name in the top menu", def: "SYSTEM ENGINEER · CHENNAI" },
    ],
  },
  {
    title: "The finale",
    fields: [
      { key: "finaleLabel", label: "The small label", def: "THE CHAIN KEEPS MOVING" },
      { key: "slogan1", label: "The slogan, first line", def: "Life doesn’t stop." },
      { key: "slogan2", label: "The slogan, second line", def: "It moves like a chain." },
      { key: "statement", label: "Your line under the ring", def: "You don’t need to remember everything. It’s a chain — the right link comes back at the right time. Just keep learning.", long: true },
      { key: "finaleNote", label: "The closing note", def: "One link at a time. Every day is a link, and the chain is still being made.", long: true },
    ],
  },
  {
    title: "Titles",
    fields: [
      { key: "timeTitle", label: "The time card", def: "TIME IN THE CHAIN" },
    ],
  },
];

export const COPY_DEFAULTS: Record<string, string> = Object.fromEntries(COPY_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.def])));

// The name's look.
export type NameFont = "serif" | "sans" | "mono";
export type NameColor = "sheen" | "theme" | "gold" | "ink" | "custom";
export type CopyStyle = { nameFont: NameFont; nameColor: NameColor; nameC1: string; nameC2: string };

export const NAME_FONTS: { id: NameFont; label: string }[] = [
  { id: "serif", label: "Serif (as now)" },
  { id: "sans", label: "Sans" },
  { id: "mono", label: "Mono" },
];
export const NAME_COLORS: { id: NameColor; label: string }[] = [
  { id: "sheen", label: "Ink with a moving sheen (as now)" },
  { id: "theme", label: "The theme's gradient" },
  { id: "gold", label: "Gold" },
  { id: "ink", label: "Plain" },
  { id: "custom", label: "Two colours of mine" },
];

export const STYLE_DEFAULTS: CopyStyle = { nameFont: "serif", nameColor: "sheen", nameC1: "#f0a064", nameC2: "#2dd4bf" };

export type Copy = { texts: Record<string, string>; style: CopyStyle };

const HEX = /^#[0-9a-fA-F]{6}$/;

/** texts.json, guarded: only keys the page has, only sensible lengths and values. */
export function cleanCopy(raw: unknown): Copy {
  const r = (raw ?? {}) as { texts?: unknown; style?: unknown };
  const texts: Record<string, string> = {};
  if (r.texts && typeof r.texts === "object") {
    for (const [k, v] of Object.entries(r.texts as Record<string, unknown>)) {
      if (k in COPY_DEFAULTS && typeof v === "string" && v.trim() && v.length <= 600) texts[k] = v;
    }
  }
  const st = (r.style ?? {}) as Record<string, unknown>;
  const style: CopyStyle = {
    nameFont: NAME_FONTS.some((f) => f.id === st.nameFont) ? (st.nameFont as NameFont) : STYLE_DEFAULTS.nameFont,
    nameColor: NAME_COLORS.some((c) => c.id === st.nameColor) ? (st.nameColor as NameColor) : STYLE_DEFAULTS.nameColor,
    nameC1: typeof st.nameC1 === "string" && HEX.test(st.nameC1) ? st.nameC1 : STYLE_DEFAULTS.nameC1,
    nameC2: typeof st.nameC2 === "string" && HEX.test(st.nameC2) ? st.nameC2 : STYLE_DEFAULTS.nameC2,
  };
  return { texts, style };
}

export const EMPTY_COPY: Copy = { texts: {}, style: STYLE_DEFAULTS };

/** The words for a key: his, or the original. */
export function word(copy: Copy, key: string): string {
  return copy.texts[key] ?? COPY_DEFAULTS[key] ?? "";
}

/** The name's font (a Tailwind class) and colour (a class, or an inline style). */
export function nameLook(style: CopyStyle): { fontClass: string; colorClass: string; colorStyle?: Record<string, string> } {
  const fontClass = style.nameFont === "sans" ? "font-sans" : style.nameFont === "mono" ? "font-mono" : "font-display";
  if (style.nameColor === "sheen") return { fontClass, colorClass: "dev-sheen" };
  if (style.nameColor === "ink") return { fontClass, colorClass: "text-[var(--d-ink)]" };
  const grad =
    style.nameColor === "theme"
      ? "linear-gradient(100deg, var(--d-a2), var(--d-gold) 45%, var(--d-b))"
      : style.nameColor === "gold"
        ? "linear-gradient(100deg, var(--d-gold), var(--d-a2))"
        : `linear-gradient(100deg, ${style.nameC1}, ${style.nameC2})`;
  return { fontClass, colorClass: "", colorStyle: { background: grad, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" } };
}
