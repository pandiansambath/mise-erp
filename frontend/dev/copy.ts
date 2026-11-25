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

import { isPlate, type PlateId } from "./plates";
import { EMAIL, LINKS, PROJECT, VOLUNTEERING } from "./profile";
import { CLUSTERS, EDUCATION, ORBIT_MAX_LEN, type OrbitSkill } from "./skills";

/** `same`: until he changes it, it follows another word. `list`: several, with commas
 *  between. `must`: never blank (any other may be emptied: then nothing is shown). */
export type CopyField = { key: string; label: string; def: string; long?: boolean; same?: string; list?: boolean; must?: boolean };

/** The volunteering card's lines: as many as he may have. */
export const VOL_MAX = 6;

export const COPY_GROUPS: { title: string; note?: string; fields: CopyField[] }[] = [
  {
    title: "Who you are",
    fields: [
      { key: "name", label: "Your name", def: "Pandian Sambath", must: true },
      { key: "hello", label: "The greeting above it", def: "HELLO, I’M" },
      { key: "role", label: "Your role", def: "System Engineer" },
      { key: "at", label: "The word between role and company", def: "at" },
      { key: "company", label: "Your company", def: "Tata Consultancy Services" },
      { key: "place", label: "Where you are", def: "CHENNAI, INDIA" },
      { key: "barLine", label: "The line under your name in the top menu", def: "SYSTEM ENGINEER · CHENNAI" },
      { key: "careerStart", label: "The day it began (year-month-day: every count of time starts here)", def: "2024-01-01" },
    ],
  },
  {
    title: "The time card",
    fields: [
      { key: "timeTitle", label: "Its heading", def: "AT WORK, LINK BY LINK" },
      { key: "timeUnit", label: "After the big number", def: "years so far" },
      { key: "timeYears", label: "Under the first count", def: "YEARS" },
      { key: "timeMonths", label: "Under the second", def: "MONTHS" },
      { key: "timeDays", label: "Under the third", def: "DAYS" },
      { key: "timeCounting", label: "After the running clock", def: "AND COUNTING" },
      { key: "chainBlocks", label: "Under the month blocks: the word after their number", def: "MONTHS" },
      { key: "chainYears", label: "…and after the number of years", def: "YEARS COMPLETE IN" },
      { key: "kindRecognition", label: "The gold blocks are called", def: "Recognition" },
      { key: "kindPromotion", label: "The promotion blocks", def: "Promotion" },
      { key: "kindMilestone", label: "The milestone blocks", def: "Milestone" },
      { key: "kindNote", label: "The note blocks", def: "Note" },
    ],
  },
  {
    title: "A month's window",
    note: "{n}, {d}, {all}, {from}, {to} stand for numbers.",
    fields: [
      { key: "monthHead", label: "Its small heading", def: "MONTH {n} OF THE CHAIN" },
      { key: "monthNow", label: "Under this month", def: "BEING MADE · DAY {d} OF {all}" },
      { key: "monthNext", label: "Under a month to come", def: "NOT MADE YET · {n} DAYS AWAY" },
      { key: "monthPast", label: "Under a month gone by", def: "{all} DAYS · DAYS {from} TO {to} OF MINE" },
      { key: "monthQuiet", label: "A month with nothing written on it", def: "Nothing is written on this link. The next one holds on to it all the same." },
      { key: "monthFuture", label: "A month that has not come", def: "Not here yet. I am on my way to it." },
    ],
  },
  {
    title: "The résumé card",
    fields: [
      { key: "resumeTitle", label: "Its heading", def: "Résumé" },
      { key: "resumePage", label: "The word after one page", def: "PAGE" },
      { key: "resumePages", label: "…after several", def: "PAGES" },
      { key: "resumeName", label: "The name on it", def: "Pandian Sambath", same: "name" },
      { key: "resumeLine", label: "The line under the name", def: "The same story, set for paper: Python, AWS and Generative AI." },
      { key: "resumeUpdated", label: "Before its date", def: "UPDATED" },
      { key: "resumeView", label: "The main button", def: "Read it here" },
      { key: "resumePdf", label: "The PDF button", def: "PDF" },
      { key: "resumeWord", label: "The Word button", def: "Word" },
    ],
  },
  ...CLUSTERS.map((c) => ({
    title: `Skills card · ${c.label}`,
    fields: [
      { key: `skill.${c.key}.head`, label: "Its heading on the card", def: c.head },
      { key: `skill.${c.key}.label`, label: "Its short name (the shell, the other designs)", def: c.label },
      { key: `skill.${c.key}.blurb`, label: "The line under it", def: c.blurb, long: true },
      { key: `skill.${c.key}.items`, label: "Its skills, commas between (one with a docs page keeps its link)", def: c.items.join(", "), long: true, list: true },
    ],
  })),
  {
    title: "The education card",
    fields: [
      { key: "eduTitle", label: "Its heading", def: "EDUCATION · WHAT STAYS" },
      { key: "eduHonour", label: "The gold line (the way into the award room)", def: EDUCATION.honour },
      { key: "eduDoor", label: "Under the gold line: what stands behind it", def: "Touch the rank. In an ancient temple stands a treasure chest no one can steal, even if they try. It is called education.", long: true },
      { key: "eduDoorAfter", label: "…once they have been inside", def: "The chest is still there. Nobody has managed to steal it.", long: true },
      { key: "eduDegree", label: "The degree", def: EDUCATION.degree },
      { key: "eduYear", label: "The years", def: EDUCATION.year },
      { key: "eduPercent", label: "The marks", def: EDUCATION.percentage },
      { key: "eduSchool", label: "The college", def: EDUCATION.school },
      { key: "eduSchoolLink", label: "Its link", def: EDUCATION.schoolUrl },
      { key: "eduAffiliation", label: "The line under the college", def: EDUCATION.affiliation },
      { key: "eduVerify", label: "The word before the proof", def: "proof" },
      { key: "eduVerifyLabel", label: "The proof's name", def: EDUCATION.verifyLabel },
      { key: "eduVerifyLink", label: "The proof's link", def: EDUCATION.verifyUrl },
      { key: "eduOfficial", label: "The university's link, as shown", def: "annauniv.edu" },
      { key: "eduOfficialLink", label: "Where it goes", def: EDUCATION.officialUrl },
      { key: "eduExam", label: "The exam", def: EDUCATION.exam },
      { key: "eduHint", label: "Where to look in the proof", def: EDUCATION.verifyHint },
    ],
  },
  {
    title: "The recognition card",
    note: "Its entries are the month blocks' own: open a month on the chain (while unlocked) to add, change or remove one.",
    fields: [
      { key: "recTitle", label: "Its heading", def: "Recognition · on the way" },
      { key: "recPill", label: "The line under it (empty: counted from your promotions)", def: "" },
      { key: "recPromoted", label: "The word before a promotion's grades", def: "PROMOTED" },
    ],
  },
  {
    title: "The card of what you build",
    fields: [
      { key: "sideTitle", label: "Its heading", def: "Built outside work" },
      { key: "sideLive", label: "The word beside the green light", def: "LIVE" },
      { key: "sideName", label: "The project's name", def: PROJECT.name },
      { key: "sideSiteLabel", label: "Its address, as shown", def: "dineai.cloud" },
      { key: "sideSite", label: "Its link", def: PROJECT.site },
      { key: "sideSlogan", label: "Its question", def: PROJECT.slogan },
      { key: "sidePitch", label: "What it is", def: PROJECT.pitch, long: true },
      { key: "sideInUseWord", label: "Before where it is used", def: "Answering today at" },
      { key: "sideInUse", label: "Where it is used", def: PROJECT.inUse.label },
      { key: "sideInUseLink", label: "That place's link", def: PROJECT.inUse.href },
      { key: "sideStack", label: "What it is built with, commas between", def: PROJECT.stack.join(", "), long: true, list: true },
      { key: "sideHonesty", label: "How it is built", def: PROJECT.honesty, long: true },
      { key: "sideVisit", label: "The main button", def: "See it at work" },
      { key: "sideCode", label: "The code button", def: "Code on GitHub" },
      { key: "sideCodeLink", label: "The code's link", def: PROJECT.code },
      { key: "sideSince", label: "Since when (a month, as \"Jun 2026\")", def: PROJECT.since },
    ],
  },
  {
    title: "The volunteering card",
    note: `Up to ${VOL_MAX} lines; a line with no name is not shown.`,
    fields: [
      { key: "volTitle", label: "Its heading", def: "Volunteering" },
      { key: "volAside", label: "The words on its right", def: "HOW I RECHARGE" },
      ...Array.from({ length: VOL_MAX }, (_, i) => [
        { key: `vol${i + 1}Org`, label: `${i + 1}. Where`, def: VOLUNTEERING[i]?.org ?? "" },
        { key: `vol${i + 1}What`, label: `${i + 1}. What you did`, def: VOLUNTEERING[i]?.what ?? "", long: true },
      ]).flat(),
    ],
  },
  {
    title: "The shell card",
    fields: [
      { key: "shellTitle", label: "Its heading", def: "Ask the chain" },
      { key: "shellAside", label: "The words on its right", def: "TYPE OR TAP" },
      { key: "shellLine", label: "The line above it (between *stars*: a command, which can be touched)", def: "It knows this page by heart. Write one word and it answers: *awards*, *skills* or *contact*.", long: true },
      { key: "shellBar", label: "In its bar, on the right", def: "IT LISTENS" },
    ],
  },
  {
    title: "The top menu",
    fields: [
      { key: "navMail", label: "Mail", def: "MAIL" },
      { key: "navLinkedin", label: "LinkedIn", def: "LINKEDIN" },
      { key: "navGithub", label: "GitHub", def: "GITHUB" },
      { key: "navInstagram", label: "Instagram", def: "INSTAGRAM" },
      { key: "navResume", label: "Résumé", def: "RÉSUMÉ" },
      { key: "navThemes", label: "Themes", def: "THEMES" },
      { key: "soundHint", label: "Beside the music, until somebody touches the page (a browser allows no music before)", def: "touch anywhere for music" },
      { key: "email", label: "Your e-mail", def: EMAIL },
      { key: "linkLinkedin", label: "Your LinkedIn", def: LINKS.linkedin },
      { key: "linkGithub", label: "Your GitHub", def: LINKS.github },
      { key: "linkInstagram", label: "Your Instagram", def: LINKS.instagram },
    ],
  },
  {
    title: "The door (before the site opens)",
    fields: [
      { key: "bootLines", label: "The lines that type themselves, commas between", def: "$ ssh pandi-dev.dineai.cloud, authenticating…  [ok], mounting /dev/pandian, syncing chain — verifying blocks", long: true, list: true },
      { key: "bootVerified", label: "Beside the bar", def: "blocks verified" },
      { key: "bootWait", label: "While it loads", def: "ONE MOMENT…" },
      { key: "bootOpen", label: "When all of it is here, as the site opens", def: "WELCOME" },
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
      { key: "finaleDay", label: "The day count ({n}: the number)", def: "DAY {n} OF MINE" },
      { key: "finaleCounting", label: "After it", def: "AND COUNTING" },
      { key: "finaleHello", label: "The main button (it writes to you)", def: "Say hello" },
      { key: "finaleLinkedin", label: "The LinkedIn button", def: "LinkedIn" },
      { key: "finaleResume", label: "The résumé button", def: "Read my résumé" },
      { key: "finaleProject", label: "The project's button", def: "DineAI", same: "sideName" },
      { key: "footName", label: "The last line: your name", def: "PANDIAN SAMBATH" },
      { key: "footPlace", label: "…and where", def: "CHENNAI, INDIA" },
      { key: "footMade", label: "…and how the page was made", def: "THIS PAGE WAS BUILT WITH AI-ASSISTED DEVELOPMENT" },
    ],
  },
  {
    title: "The quiet lines (what can be touched)",
    note: "One at a time, when a visitor is still; gone once the thing has been done. Empty: never shown. What stands after a · is for a wide screen.",
    fields: [
      { key: "hintScroll", label: "At the foot of the first screen", def: "Scroll to see my skills and experience" },
      { key: "hintGalaxy", label: "Beside the galaxy", def: "Touch the galaxy · and let it burst" },
      { key: "hintMonths", label: "Under the month blocks", def: "Touch a lit month · and see what happened" },
      { key: "hintBones", label: "Beside the skeleton", def: "Touch the skeleton · it breaks, and comes back to life" },
      { key: "hintRing", label: "Over the finale's chain", def: "Turn the chain with your hand · it keeps moving" },
      { key: "hintHand", label: "About the hand that scatters the page", def: "Sweep your hand sideways · the page scatters, and comes home" },
      { key: "hintOrbit", label: "Over the skills that go round", def: "Turn my skills with your hand · touch one to read about it" },
      { key: "hintChips", label: "Under the first skills card", def: "Touch any name · its official pages open" },
      { key: "hintResume", label: "Under the résumé card", def: "Touch the pages · they open right here" },
    ],
  },
  {
    title: "The award room",
    fields: [
      { key: "coinLink", label: "Where the gold coin takes whoever touches it (a web address; empty: nowhere)", def: "https://www.instagram.com/pandian.sambath" },
      { key: "awardTop", label: "The line above the title", def: "ANNA UNIVERSITY · 2023" },
      { key: "awardTitle", label: "The title", def: "Gold Medalist" },
      { key: "awardStrike", label: "Under the chest, before the first blow", def: "STRIKE THE CHEST" },
      { key: "awardAgain", label: "After the first blow", def: "AGAIN" },
      { key: "awardBreaking", label: "When it is nearly open", def: "IT IS GIVING WAY…" },
      { key: "awardLight", label: "At the foot, when the doors have opened", def: "You carry the light. Move it." },
      { key: "awardLamps", label: "…once the light has moved", def: "Bring it to the lamps" },
      { key: "awardLampsLeft", label: "…as the lamps catch, commas between", def: "Three more, Two more, One more", list: true },
      { key: "awardAwake", label: "…when all four are lit", def: "The stone is awake" },
      { key: "kuralHintOne", label: "By the Kural, while its leaves are shut: the first half", def: "A story is kept behind these words" },
      { key: "kuralHintTwo", label: "…the second half", def: "Touch them, and it opens" },
      { key: "kuralHintAfter", label: "…once they have been opened", def: "The leaves are still here" },
      { key: "kuralDown", label: "The leaves: at the foot of a small screen, until they are read down", def: "The last leaf is mine" },
      { key: "kuralShut", label: "The leaves: how they close", def: "Touch the dark to close the leaves" },
      { key: "coinSays", label: "What is said of the coin without showing it", def: "Turn it with your hand. A touch opens Instagram." },
      { key: "awardCitation", label: "The citation (between *stars*: bold)", def: "Presented to *Pandian Sambath*, placed *17th in the university*: B.Tech Information Technology, 92%. Four years of learning, one gram of gold. The gold stays in this chest. The learning walked out with him.", long: true },
      { key: "awardProof", label: "The link to the rank list", def: "RANK LIST · APRIL / MAY 2023 EXAMINATIONS" },
      { key: "awardProofLink", label: "Where that link goes", def: "/api/dev-site/RANK_AFF_UG_2023.pdf#page=35" },
      { key: "awardVerse", label: "The verse in English, over the coin (shown once the lamps are lit; a click opens the leaves)", def: "Learning is the wealth that never perishes; nothing else is wealth.", long: true },
      { key: "awardVerseBy", label: "Where the verse is from", def: "THIRUKKURAL 400" },
      { key: "kuralHead", label: "The palm leaves (a click on the Kural): their heading", def: "THIRUKKURAL 400 · THE CHAPTER ON LEARNING" },
      { key: "kuralOne", label: "…the couplet, its first line", def: "கேடில் விழுச்செல்வம் கல்வி யொருவற்கு" },
      { key: "kuralTwo", label: "…its second line", def: "மாடல்ல மற்றை யவை" },
      { key: "kuralSaid", label: "…how it is said", def: "kēḍil viḻuccelvam kalvi yoruvaṟku · māḍalla maṟṟai yavai" },
      { key: "kuralWords", label: "…its words, one by one (Tamil = English; and so on)", def: "கேடு இல் = never ruined; விழுச்செல்வம் = the highest wealth; கல்வி = learning; ஒருவற்கு = for a person; மாடு அல்ல = are not wealth; மற்றை யவை = the other things", long: true },
      { key: "kuralMeans", label: "…what it means", def: "For a person, *learning is the one great wealth that can never be ruined*. Everything else we call wealth is not.", long: true },
      { key: "kuralOwn", label: "…in your own words", def: "Money is never really ours. It lifts us one day and brings us down the next, and when it goes it can take everything with it. What we have learned stays. Nobody can steal it; give it away and you still have all of it; use it and it grows.", long: true },
      { key: "kuralMine", label: "…and your own example (between *stars*: bold)", def: "*My own proof:* four years of B.Tech Information Technology, *92%*, and in 2023 Anna University’s rank list put me *17th in the university*. The gold in this coin weighs one gram, and it can be lost, sold or melted. The learning it was given for cannot. It walked with me into Tata Consultancy Services, and I use it every single day.", long: true },
    ],
  },
];

export const COPY_DEFAULTS: Record<string, string> = Object.fromEntries(COPY_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.def])));
const MUST = new Set(COPY_GROUPS.flatMap((g) => g.fields.filter((f) => f.must).map((f) => f.key)));
/** Words that follow another until he changes them. */
const FOLLOWS: Record<string, string> = Object.fromEntries(COPY_GROUPS.flatMap((g) => g.fields.filter((f) => f.same).map((f) => [f.key, f.same!])));

// The name's look.
export type NameFont = "serif" | "sans" | "mono";
export type NameColor = "sheen" | "theme" | "gold" | "ink" | "custom";
/** `plate`: the design of the name's area (plates.ts). */
export type CopyStyle = { nameFont: NameFont; nameColor: NameColor; nameC1: string; nameC2: string; plate: PlateId };

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

export const STYLE_DEFAULTS: CopyStyle = { nameFont: "serif", nameColor: "sheen", nameC1: "#f0a064", nameC2: "#2dd4bf", plate: "classic" };

/** `skills`: the orbit round his portrait (§102.6) — his own list, or null for
 *  the résumé's (skills.ts, DEFAULT_ORBIT). */
export type Copy = { texts: Record<string, string>; style: CopyStyle; skills: OrbitSkill[] | null };

/** As many skills as the orbit's list may hold. */
export const MAX_SKILLS = 80;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** texts.json, guarded: only keys the page has, only sensible lengths and values. */
export function cleanCopy(raw: unknown): Copy {
  const r = (raw ?? {}) as { texts?: unknown; style?: unknown; skills?: unknown };
  const texts: Record<string, string> = {};
  if (r.texts && typeof r.texts === "object") {
    for (const [k, v] of Object.entries(r.texts as Record<string, unknown>)) {
      // (An empty one is his too: that word is left out.)
      if (k in COPY_DEFAULTS && typeof v === "string" && v.length <= 600) texts[k] = v.trim() ? v : "";
    }
  }
  const st = (r.style ?? {}) as Record<string, unknown>;
  const style: CopyStyle = {
    nameFont: NAME_FONTS.some((f) => f.id === st.nameFont) ? (st.nameFont as NameFont) : STYLE_DEFAULTS.nameFont,
    nameColor: NAME_COLORS.some((c) => c.id === st.nameColor) ? (st.nameColor as NameColor) : STYLE_DEFAULTS.nameColor,
    nameC1: typeof st.nameC1 === "string" && HEX.test(st.nameC1) ? st.nameC1 : STYLE_DEFAULTS.nameC1,
    nameC2: typeof st.nameC2 === "string" && HEX.test(st.nameC2) ? st.nameC2 : STYLE_DEFAULTS.nameC2,
    plate: isPlate(st.plate) ? st.plate : STYLE_DEFAULTS.plate,
  };
  // The orbit's skills: his list (each once, sensible names), or the résumé's.
  let skills: OrbitSkill[] | null = null;
  if (Array.isArray(r.skills)) {
    const seen = new Set<string>();
    skills = [];
    for (const it of r.skills as unknown[]) {
      const o = (it ?? {}) as { name?: unknown; pin?: unknown };
      const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim() : "";
      const odd = [...name].some((ch) => ch.charCodeAt(0) < 32 || ch === "<" || ch === ">");
      if (!name || odd || name.length > ORBIT_MAX_LEN || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      skills.push({ name, pin: o.pin === true });
      if (skills.length >= MAX_SKILLS) break;
    }
  }
  return { texts, style, skills };
}

export const EMPTY_COPY: Copy = { texts: {}, style: STYLE_DEFAULTS, skills: null };

/** A web address of his: http(s), a path on this site, or nothing. */
export function safeLink(raw: string): string | null {
  const s = raw.trim();
  if (/^https?:\/\/[^\s<>"']+$/i.test(s)) return s;
  return /^\/(?!\/)[^\s<>"']*$/.test(s) ? s : null;
}

/** The words for a key: his, or the original. */
export function word(copy: Copy, key: string): string {
  const own = copy.texts[key];
  if (own !== undefined && (own || !MUST.has(key))) return own;
  const other = FOLLOWS[key];
  // (Only once the other has been changed: the original was written for here.)
  return (other && copy.texts[other]) || COPY_DEFAULTS[key] || "";
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
