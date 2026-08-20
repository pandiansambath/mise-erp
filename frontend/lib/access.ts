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
      },
      {
        key: "expenses",
        label: "Expenses",
        blurb: "Bills and everyday spending",
        icon: "💸",
        read: ["expenses:read"],
        write: ["expenses:write"],
      },
      {
        key: "payroll",
        label: "Payroll",
        blurb: "What staff are paid",
        icon: "💰",
        read: ["payroll:read"],
        write: ["payroll:write"],
      },
      {
        key: "reports",
        label: "Reports & P&L",
        blurb: "Profit, loss and the numbers behind them",
        icon: "📈",
        read: ["reports:read"],
        write: ["reports:write"],
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
      },
      {
        key: "vendors",
        label: "Suppliers & buying",
        blurb: "Vendors, prices and purchase orders",
        icon: "🤝",
        read: ["vendors:read", "vendor_payments:read"],
        write: ["vendors:write", "indent:write", "vendor_payments:write"],
      },
      {
        key: "approve",
        label: "Approving orders",
        blurb: "Signing off what gets bought",
        icon: "✅",
        read: ["indent:read"],
        write: ["indent:approve"],
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
      },
      {
        key: "rota",
        label: "Rota & hours",
        blurb: "Shifts and attendance",
        icon: "📅",
        read: ["rota:read"],
        write: ["rota:write", "attendance:write"],
      },
      {
        key: "documents",
        label: "Documents",
        blurb: "Contracts, right-to-work, certificates",
        icon: "📄",
        read: ["documents:read"],
        write: ["documents:write"],
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
      },
      {
        key: "self_pay",
        label: "Their own payslips",
        blurb: "What they were paid, nobody else's",
        icon: "💷",
        read: ["payroll:self"],
        write: [],
      },
      {
        key: "self_docs",
        label: "Their own documents",
        blurb: "Contracts and certificates they upload",
        icon: "📄",
        read: ["documents:self"],
        write: [],
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
      },
      {
        key: "orders",
        label: "Orders & parties",
        blurb: "Online orders and party bookings",
        icon: "🛵",
        read: ["party:read"],
        write: ["party:write", "orders:write"],
      },
      {
        key: "safety",
        label: "Food safety",
        blurb: "Temperature and cleaning checks",
        icon: "🌡️",
        read: ["safety:read"],
        write: ["safety:write"],
      },
      {
        key: "ai",
        label: "The assistant",
        blurb: "Asking DineAI questions",
        icon: "✨",
        read: [],
        write: ["ai:use"],
      },
    ],
  },
];

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
export function overridesFor(area: Area, level: Level): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const p of area.read) out[p] = level !== "none";
  for (const p of area.write) out[p] = level === "edit";
  return out;
}

export const LEVEL_LABEL: Record<Level, string> = {
  none: "No access",
  view: "Can see",
  edit: "Can change",
};

export const LEVEL_HINT: Record<Level, string> = {
  none: "Hidden from them entirely",
  view: "They can look, not touch",
  edit: "They can add and edit",
};
