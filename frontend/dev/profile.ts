// What he has been recognised for, what he builds outside work, and how he
// recharges — written once, read by the cards and by the terminal, so the two
// can never tell different stories (the way the skills lists once did).
//
// The page's TEXT stays identity-level, as he asked in August: no client
// names, no project internals, no salary figures. Those live in the résumé, a
// document he chose to publish, and never in the words on this page.
// scripts/verify_live.sh checks the page body for them.
//
// Voice: plain facts, nothing sold. His words on how achievements read —
// "everyone is intelligent in their own way" — so no "just", no "only".

export type MilestoneKind = "recognition" | "promotion" | "milestone" | "note";

/** One entry on a month of the chain. He can add, edit and remove these from
 *  the page itself (behind his password); what he saves replaces this list. */
export type Milestone = {
  /** "Mon YYYY", e.g. "Nov 2025" — the block it lights. */
  when: string;
  kind: MilestoneKind;
  title: string;
  note: string;
  /** The grade change that came with a promotion, e.g. "Ninja → Digital". */
  promoted?: string;
};

export const KIND_META: Record<MilestoneKind, { glyph: string; label: string; role: string }> = {
  recognition: { glyph: "★", label: "Recognition", role: "gold" },
  promotion: { glyph: "↑", label: "Promotion", role: "b" },
  milestone: { glyph: "◆", label: "Milestone", role: "c" },
  note: { glyph: "•", label: "Note", role: "a2" },
};

/** The list the page starts from until he saves his own. */
export const DEFAULT_MILESTONES: Milestone[] = [
  {
    when: "Jan 2024",
    kind: "milestone",
    title: "Joined Tata Consultancy Services",
    note: "Day one as a System Engineer, in Chennai.",
  },
  {
    when: "Oct 2024",
    kind: "recognition",
    title: "Beyond Performance Award",
    note: "Among the top performers across the project team, nine months in.",
  },
  {
    when: "Jan 2025",
    kind: "promotion",
    title: "TCS Wings1 Digital · Distinction",
    note: "All three exams cleared on the first attempt.",
    promoted: "Ninja → Digital",
  },
  {
    when: "Nov 2025",
    kind: "recognition",
    title: "TCS Star of the Month",
    note: "The youngest engineer on the team, with 1.6 years of experience.",
  },
  {
    when: "Jan 2026",
    kind: "promotion",
    title: "TCS Wings1 Innovator · Distinction",
    note: "All three exams cleared on the first attempt.",
    promoted: "Digital → Innovator",
  },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 2025" → a sortable number, so lists read oldest first. */
export function monthIndex(when: string): number {
  const [m, y] = when.split(" ");
  return Number(y) * 12 + MONTHS.indexOf(m);
}

/** The recognitions and promotions, oldest first: what the Recognition card,
 *  the terminal's `awards` and the designs' honours lists show. */
export function honours(list: Milestone[]): Milestone[] {
  return list
    .filter((m) => m.kind === "recognition" || m.kind === "promotion")
    .sort((x, y) => monthIndex(x.when) - monthIndex(y.when));
}

/** Guards what comes back from the server before the page trusts it. */
export function cleanMilestones(raw: unknown): Milestone[] | null {
  if (!Array.isArray(raw)) return null;
  const ok = raw.filter(
    (m): m is Milestone =>
      !!m &&
      typeof m === "object" &&
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 20\d\d$/.test((m as Milestone).when) &&
      (m as Milestone).kind in KIND_META &&
      typeof (m as Milestone).title === "string",
  );
  return ok.map((m) => ({ ...m, note: m.note ?? "", promoted: m.promoted || undefined }));
}

/** His own product. Labelled AI-assisted every time it appears — his rule. */
export const PROJECT = {
  name: "DineAI",
  slogan: "Where does your money go?",
  pitch:
    "A live web app for UK restaurants: purchases, stock, supplier prices and recipe costs, joined up into a live profit and loss, with an AI assistant built in.",
  inUse: { label: "Nirai, Reading (UK)", href: "https://niraireading.com/" },
  site: "https://dineai.cloud/",
  /** When he started it (the résumé says Jun 2026 – present). */
  since: "Jun 2026",
  code: "https://github.com/pandiansambath/mise-erp",
  stack: ["Python", "FastAPI", "PostgreSQL", "Next.js", "Amazon Bedrock", "Terraform", "AWS"],
  honesty:
    "Built with AI-assisted development (Claude Code). I own the product, the design decisions, testing, deployment and AWS operations.",
};

/** No years, at his request. */
export const VOLUNTEERING = [
  {
    org: "Thaagam Foundation",
    what: "Birthdays with children at an orphanage, donor-funded meals every day, and evenings feeding stray dogs at Marina Beach.",
  },
  {
    org: "TCS Maitree",
    what: "Volunteered at the kids’ carnival games: chess, archery, dance and more.",
  },
  {
    org: "TCS Hopes",
    what: "Every Diwali at an orphanage, bursting crackers and enjoying the day with the children.",
  },
];
