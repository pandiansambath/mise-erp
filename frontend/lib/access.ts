// What a person can reach, said the way a person would say it.
//
// The old page asked an owner to think like an administrator: pick an
// archetype, toggle inside its envelope, name and save a ROLE, then go
// elsewhere and ATTACH it. Four concepts to answer one question — and the proof
// it did not work is that the only role the hotel ever designed was attached to
// nobody.
//
//   "creating role for role like manager and assigning to role like manager or
//    staff, it's confusing the laymans. We definitely do something simpler for
//    them to easily do whatever they want."
//
// So the 39 permissions become a handful of AREAS a chef would recognise, and
// each area has one control with three positions — because "can they see the
// payroll, and can they change it" is the actual question, and `payroll:read` /
// `payroll:write` is that question written in a way nobody asks it.

export type Level = "none" | "view" | "edit";

/**
 * A SCREEN this area opens.
 *
 *   "under Inventory you gave 3 things — but what if super admin wants to give
 *    only the Inventory page alone, not Stock-take and Waste?"
 *
 * The 17 permissions decide what DATA someone may read or change and cannot be
 * split per page — Inventory, Stock-take and Waste all read the same stock.
 * What CAN be split is which of those screens the person is handed, and that is
 * what `slug` is for: a `page:<slug>` grant narrows the menu inside what the
 * permission already allows. It never widens anything.
 */
export type PageRef = { label: string; slug: string; href: string };

export type Area = {
  key: string;
  /** What it is called on the page. */
  label: string;
  /** One line, in plain words, of what it covers. */
  blurb: string;
  icon: string;
  /** Permissions that count as SEEING it. */
  read: string[];
  /** Permissions that count as CHANGING it. Implies the read ones. */
  write: string[];
  /**
   * THE ACTUAL PAGES this unlocks, by the name in the sidebar.
   *
   *   "still we didn't show all the pages I guess... go count how many pages
   *    we have and show ALL pages to super admin."
   *
   * There are 34 screens and 17 switches, and that mismatch is the whole
   * problem: "Suppliers & buying" is honest to somebody who built the app and
   * means nothing to somebody looking for Price Comparison. One switch can
   * open several pages — that is deliberate, because Vendors and Price
   * Comparison are one job — but the owner has to be able to SEE which ones,
   * or he is agreeing to something invisible.
   */
  pages: PageRef[];
  /**
   * What "on" is called for an area that has no middle position. "Can change"
   * is nonsense for the assistant — "what will he change? AI is for using,
   * right?" — and he is right. Defaults to the usual wording.
   */
  onLabel?: string;
};

export type Section = { key: string; label: string; icon: string; areas: Area[] };

/**
 * Every permission in the app, filed under the part of the business it belongs
 * to. Grouped by what the WORK is, not by which table it touches — "Suppliers &
 * buying" is one job to the person doing it even though it spans vendors,
 * indents and vendor payments.
 *
 * Anything not listed here simply never appears; the envelope still decides
 * what is offered, so an unlisted permission is invisible rather than dangerous.
 */
export const SECTIONS: Section[] = [
  {
    key: "money",
    label: "Money",
    icon: "💷",
    areas: [
      {
        key: "sales",
        label: "Sales & till",
        blurb: "What was sold, and cashing up",
        icon: "🧾",
        read: ["sales:read"],
        write: ["sales:write", "sales:config", "cash:write"],
        pages: [{ label: "Sales & Cash", slug: "sales-and-cash", href: "/sales" }, { label: "Online Orders", slug: "online-orders", href: "/orders" }, { label: "Money", slug: "money", href: "/money" }],
      },
      {
        key: "expenses",
        label: "Expenses",
        blurb: "Bills and everyday spending",
        icon: "💸",
        read: ["expenses:read"],
        write: ["expenses:write"],
        pages: [{ label: "Expenses", slug: "expenses", href: "/expenses" }],
      },
      {
        key: "payroll",
        label: "Payroll",
        blurb: "What staff are paid",
        icon: "💰",
        read: ["payroll:read"],
        write: ["payroll:write"],
        pages: [{ label: "Payroll", slug: "payroll", href: "/payroll" }],
      },
      {
        key: "reports",
        label: "Reports & P&L",
        blurb: "Profit, loss and the numbers behind them",
        icon: "📈",
        read: ["reports:read"],
        write: ["reports:write"],
        pages: [{ label: "Reports (P&L)", slug: "reports-p-and-l", href: "/reports" }, { label: "Money", slug: "money", href: "/money" }],
      },
    ],
  },
  {
    key: "stock",
    label: "Stock & buying",
    icon: "📦",
    areas: [
      {
        key: "inventory",
        label: "Inventory",
        blurb: "Items, stock levels and counts",
        icon: "📦",
        read: ["inventory:read", "stock:read"],
        write: ["inventory:write", "stock:write", "waste:write"],
        pages: [{ label: "Inventory", slug: "inventory", href: "/inventory" }, { label: "Stock-take", slug: "stock-take", href: "/stock-take" }, { label: "Waste", slug: "waste", href: "/waste" }],
      },
      {
        key: "vendors",
        label: "Suppliers & buying",
        blurb: "Vendors, prices and purchase orders",
        icon: "🤝",
        read: ["vendors:read", "vendor_payments:read"],
        write: ["vendors:write", "indent:write", "vendor_payments:write"],
        pages: [{ label: "Vendors", slug: "vendors", href: "/vendors" }, { label: "Price Comparison", slug: "price-comparison", href: "/price-comparison" }, { label: "Purchasing", slug: "purchasing", href: "/purchasing" }],
      },
      {
        key: "approve",
        label: "Approving orders",
        blurb: "Signing off what gets bought",
        icon: "✅",
        read: ["indent:read"],
        write: ["indent:approve"],
        pages: [{ label: "Purchasing — approving", slug: "purchasing-approving", href: "/purchasing" }],
      },
    ],
  },
  {
    key: "people",
    label: "People",
    icon: "🧑‍🍳",
    areas: [
      {
        key: "employees",
        label: "Staff records",
        blurb: "Who works here and their details",
        icon: "🧑‍🍳",
        read: ["employees:read", "users:read"],
        write: ["employees:write", "hiring:write"],
        pages: [{ label: "Employees", slug: "employees", href: "/employees" }, { label: "Hiring", slug: "hiring", href: "/hiring" }, { label: "Messages", slug: "messages", href: "/messages" }, { label: "Roles & Access", slug: "roles-and-access", href: "/staff" }, { label: "Audit log", slug: "audit-log", href: "/audit" }],
      },
      {
        key: "rota",
        label: "Rota & hours",
        blurb: "Shifts and attendance",
        icon: "📅",
        read: ["rota:read"],
        write: ["rota:write", "attendance:write"],
        pages: [{ label: "Rota", slug: "rota", href: "/rota" }, { label: "Attendance", slug: "attendance", href: "/attendance" }],
      },
      {
        key: "documents",
        label: "Documents",
        blurb: "Contracts, right-to-work, certificates",
        icon: "📄",
        read: ["documents:read"],
        write: ["documents:write"],
        pages: [{ label: "Documents", slug: "documents", href: "/documents" }],
      },
    ],
  },
  {
    key: "self",
    label: "Their own",
    icon: "🙋",
    areas: [
      {
        key: "self_rota",
        label: "Their own rota & hours",
        blurb: "Their shifts and clock-ins, nobody else's",
        icon: "📅",
        read: ["rota:self", "attendance:self"],
        write: [],
        pages: [{ label: "My rota", slug: "my-rota", href: "/my" }],
      },
      {
        key: "self_pay",
        label: "Their own payslips",
        blurb: "What they were paid, nobody else's",
        icon: "💷",
        read: ["payroll:self"],
        write: [],
        pages: [{ label: "My payslips", slug: "my-payslips", href: "/my" }],
      },
      {
        key: "self_docs",
        label: "Their own documents",
        blurb: "Contracts and certificates they upload",
        icon: "📄",
        read: ["documents:self"],
        write: [],
        pages: [{ label: "My documents", slug: "my-documents", href: "/my" }],
      },
    ],
  },
  {
    key: "kitchen",
    label: "Kitchen",
    icon: "🍳",
    areas: [
      {
        key: "recipes",
        label: "Recipes & dishes",
        blurb: "Costings and what goes in a dish",
        icon: "🍜",
        read: ["recipes:read"],
        write: ["recipes:write"],
        pages: [{ label: "Recipes", slug: "recipes", href: "/recipes" }, { label: "Party Order", slug: "party-order", href: "/party-order" }, { label: "Allergens", slug: "allergens", href: "/allergens" }],
      },
      {
        key: "orders",
        label: "Orders & parties",
        blurb: "Online orders and party bookings",
        icon: "🛵",
        read: ["party:read"],
        write: ["party:write", "orders:write"],
        pages: [{ label: "Kitchen screen", slug: "kitchen-screen", href: "/kitchen" }, { label: "Tables & QR", slug: "tables-and-qr", href: "/tables" }, { label: "Menu", slug: "menu", href: "/menu" }, { label: "Online Orders", slug: "online-orders", href: "/orders" }],
      },
      {
        key: "safety",
        label: "Food safety",
        blurb: "Temperature and cleaning checks",
        icon: "🌡️",
        read: ["safety:read"],
        write: ["safety:write"],
        pages: [{ label: "Food Safety", slug: "food-safety", href: "/food-safety" }],
      },
      {
        key: "ai",
        label: "The assistant",
        blurb: "Asking DineAI questions",
        icon: "✨",
        read: [],
        write: ["ai:use"],
        pages: [{ label: "Ask DineAI", slug: "ask-dineai", href: "/assistant" }, { label: "AI scan", slug: "ai-scan", href: "/ai-scan" }],
        onLabel: "Can use",
      },
    ],
  },
];

/** Every screen in DineAI, once, in the order the sidebar shows them. */
export const ALL_PAGES: PageRef[] = SECTIONS.flatMap((s) =>
  s.areas.flatMap((a) => a.pages),
).filter((p, i, all) => all.findIndex((x) => x.slug === p.slug) === i);

/**
 * Is this screen shown to somebody holding `held`?
 *
 * The rule is per-AREA and deliberately quiet by default: if nobody has ever
 * narrowed this area, every page it opens is shown, so nothing changes for a
 * hotel that never touches it. The moment ONE page in an area is listed, that
 * area becomes a shortlist and only the listed pages appear.
 *
 * A page can never be shown that the area's own permission does not allow —
 * this only ever takes screens away.
 */
export function pageAllowed(area: Area, page: PageRef, held: Set<string>): boolean {
  const narrowed = area.pages.some((pg) => held.has(`page:${pg.slug}`));
  return !narrowed || held.has(`page:${page.slug}`);
}

/** Which area owns a screen, by href — for the sidebar and the page guards. */
export function areaForHref(href: string): Area | null {
  for (const s of SECTIONS)
    for (const a of s.areas) if (a.pages.some((p) => p.href === href)) return a;
  return null;
}

/** Can this person open this URL? Used by the nav and by each page. */
export function canOpenPage(href: string, held: Set<string>): boolean {
  // THE OWNER HELD "*" AND LOST THE WHOLE SIDEBAR.
  //
  // The first version of this asked `levelOf(area, held)` before anything else,
  // and `levelOf` looks for the area's own permission strings. The owner holds
  // the wildcard `*` and none of those, so every area came back "none" and the
  // filter hid all of it. My end-to-end test passed straight through it,
  // because the probe account held real permissions and page grants — the one
  // account it broke was the one I was signed in as.
  //
  // So this now does ONE job and only that job: if some pages in this area have
  // been shortlisted, show the shortlisted ones. Whether they may reach the area
  // at all is the permission check's business, and it has already run.
  if (held.has("*")) return true;
  const area = areaForHref(href);
  if (!area) return true; // Dashboard, How it works — never gated
  const page = area.pages.find((p) => p.href === href);
  if (!page) return true;
  return pageAllowed(area, page, held);
}

/** Everything filed above — used to spot anything left out of the sections. */
export const FILED = new Set(
  SECTIONS.flatMap((s) => s.areas.flatMap((a) => [...a.read, ...a.write])),
);

/** Where an area sits today, given the permissions a person actually holds. */
export function levelOf(area: Area, held: Set<string>): Level {
  if (area.write.some((p) => held.has(p))) return "edit";
  if (area.read.some((p) => held.has(p))) return "view";
  // An area whose only permissions are writes (Expenses, Food safety) has no
  // meaningful "view" — it is on or it is off, and `none` is the honest answer.
  return "none";
}

/**
 * Which positions this area can offer.
 *
 *   "for manager we have only expense can change / can see option... bro we
 *    need literally ALL the pages access with read and write that super admin
 *    can choose to give. Give all toggles please."
 *
 * This used to take the job's envelope and hide anything outside it, so a
 * Manager's sheet showed a handful of areas and the rest simply were not there.
 * An absence is the worst possible way to say "not allowed": there is nothing
 * to read, nothing to hover, and no reason given. The owner was left thinking
 * the app could not do it.
 *
 * So the only thing that decides now is the AREA itself — whether it has a
 * meaningful "see" as distinct from "change". An area whose permissions are all
 * writes (Expenses, Food safety) is on or off, and `none`/`edit` is the honest
 * pair. Everything is offered; the sheet marks what is unusual for the job
 * rather than removing it. Warn, do not block.
 */
export function positionsFor(area: Area): Level[] {
  const canRead = area.read.length > 0;
  const canWrite = area.write.length > 0;
  if (!canRead && !canWrite) return [];
  return canRead && canWrite ? ["none", "view", "edit"] : ["none", canWrite ? "edit" : "view"];
}

/** True when this area sits outside what the job normally does — worth a word
 *  on the page, never a reason to hide the control. */
export function isUnusual(area: Area, envelope: Set<string>): boolean {
  return ![...area.read, ...area.write].some((p) => envelope.has(p));
}

/**
 * Turn "Payroll: can see" back into the on/off map the server stores.
 *
 * The whole area is written every time — set it to "can see" and the write
 * permissions are explicitly turned OFF rather than left as they were, because
 * a half-applied change is how somebody keeps an ability they have just been
 * told they lost.
 *
 * This no longer filters by the envelope either. It used to, which meant a
 * toggle outside the job's usual set would have been dropped on the way out
 * even if the sheet had drawn it — so opening up the UI alone would have
 * produced a control that moved and then silently did nothing.
 */
export function overridesFor(
  area: Area,
  level: Level,
  /** Which of this area's screens to show. Omit = all of them. */
  pages?: Set<string>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const p of area.read) out[p] = level !== "none";
  for (const p of area.write) out[p] = level === "edit";
  // The shortlist. Written explicitly on AND off every time, so turning a page
  // back on cannot leave a stale "no" behind it.
  for (const pg of area.pages) {
    out[`page:${pg.slug}`] = level !== "none" && (!pages || pages.has(pg.slug));
  }
  return out;
}

/**
 * Why an area is flagged as unusual for a job, in words a person can act on.
 *
 *   "that 'unusual' is very generic — I need a clear explanation: why it's
 *    unusual and what is the correct way. But still you are the owner, you can
 *    decide. Also show the impact."
 *
 * Built from the area itself rather than a hand-written table, so a new area
 * cannot arrive with no explanation behind its own warning.
 */
export function whyUnusual(area: Area, jobLabel: string) {
  const canChange = area.write.length > 0;
  return {
    why:
      `A ${jobLabel} does not normally reach ${area.label.toLowerCase()}, so this is ` +
      `outside what the job is set up to do. It is a note, not a block.`,
    normal:
      `Usually ${area.label.toLowerCase()} sits with whoever owns that part of the ` +
      `business — the owner, or the person whose job it already is. Most places leave ` +
      `it off for this role and give it to one named person instead.`,
    impact: canChange
      ? `Switched to "Can change", they can add, edit and delete here — and anyone else ` +
        `with this job gets the same. "Can see" lets them look without touching, which ` +
        `is usually the safer middle.`
      : `Switched on, they can use this. There is no look-but-don't-touch position for ` +
        `it — it is on or off.`,
  };
}

export const LEVEL_LABEL: Record<Level, string> = {
  none: "No access",
  view: "Can see",
  edit: "Can change",
};

/**
 * What to CALL a position for a particular area.
 *
 *   "here what that AI toggle means? Can change for AI means? What he will
 *    change? AI is for using, right?"
 *
 * He is right, and it reads as a bug because it is one. "Can change" is the
 * generic word for the write half of a pair, and for the assistant there is no
 * pair — `ai:use` is permission to ASK IT THINGS. Labelling that "Can change"
 * invites the reader to wonder what they would be changing, and the honest
 * answer is nothing.
 */
export function labelFor(area: Area, level: Level): string {
  if (level === "edit" && area.onLabel) return area.onLabel;
  return LEVEL_LABEL[level];
}

export const LEVEL_HINT: Record<Level, string> = {
  none: "Hidden from them entirely",
  view: "They can look, not touch",
  edit: "They can add and edit",
};
