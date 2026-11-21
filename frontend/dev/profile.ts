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

export type Milestone = {
  when: string;
  title: string;
  note: string;
  /** The grade change that came with it, e.g. "Ninja → Digital". */
  promoted?: string;
  /** Struck in gold, like the university rank. */
  gold?: boolean;
};

export const RECOGNITION: Milestone[] = [
  {
    when: "Oct 2024",
    title: "Beyond Performance Award",
    note: "Among the top performers across the project team, nine months in.",
  },
  {
    when: "Jan 2025",
    title: "TCS Wings1 Digital · Distinction",
    note: "All three exams cleared on the first attempt.",
    promoted: "Ninja → Digital",
  },
  {
    when: "Nov 2025",
    title: "TCS Star of the Month",
    note: "The youngest engineer on the team, with 1.6 years of experience.",
    gold: true,
  },
  {
    when: "Jan 2026",
    title: "TCS Wings1 Innovator · Distinction",
    note: "All three exams cleared on the first attempt.",
    promoted: "Digital → Innovator",
  },
];

/** His own product. Labelled AI-assisted every time it appears — his rule. */
export const PROJECT = {
  name: "DineAI",
  slogan: "Where does your money go?",
  pitch:
    "A live web app for UK restaurants: purchases, stock, supplier prices and recipe costs, joined up into a live profit and loss, with an AI assistant built in.",
  inUse: { label: "Nirai, Reading (UK)", href: "https://niraireading.com/" },
  site: "https://dineai.cloud/",
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
