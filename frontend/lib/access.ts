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
        read: [],
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
        read: [],
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
        read: [],
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
        read: [],
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

/** Which of the three positions this area can actually offer, given the
 *  ceiling. An area with no read permission has no view-only position, and one
 *  the job may never reach at all is not shown. */
export function positionsFor(area: Area, envelope: Set<string>): Level[] {
  const canRead = area.read.some((p) => envelope.has(p));
  const canWrite = area.write.some((p) => envelope.has(p));
  if (!canRead && !canWrite) return [];
  return canRead && canWrite ? ["none", "view", "edit"] : ["none", canWrite ? "edit" : "view"];
}

/**
 * Turn "Payroll: can see" back into the on/off map the server stores.
 *
 * Only permissions inside the envelope are touched, and the whole area is
 * written every time — set to view and the write permissions are explicitly
 * turned OFF rather than left as they were, because a half-applied change is
 * how somebody keeps an ability they were just told they had lost.
 */
export function overridesFor(area: Area, level: Level, envelope: Set<string>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const p of area.read) {
    if (envelope.has(p)) out[p] = level !== "none";
  }
  for (const p of area.write) {
    if (envelope.has(p)) out[p] = level === "edit";
  }
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
