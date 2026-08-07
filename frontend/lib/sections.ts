// What each page can DO, named in one place.
//
// SubNav already shows a page's jobs once you are on it — but you had to
// arrive first and then look. His ask (#2) was for those jobs in the SIDEBAR,
// so "book a shift" or "what's low" is one click from anywhere rather than
// two plus a hunt.
//
// The keys here MUST match the `key` on that page's SubNav items, because
// that is what SubNav matches `?section=` against. They are listed rather than
// derived because the items live inside each page's render, where the sidebar
// cannot reach them — and a wrong key simply does nothing rather than break.

export type PageSection = { key: string; label: string };

export const SECTIONS: Record<string, PageSection[]> = {
  "/inventory": [
    { key: "items", label: "View items" },
    { key: "add", label: "Add an item" },
    { key: "low", label: "What's low" },
    { key: "search", label: "Find something" },
    { key: "categories", label: "Categories" },
  ],
  "/sales": [
    { key: "today", label: "Today" },
    { key: "till", label: "Till & cash" },
    { key: "petty", label: "Petty cash" },
  ],
  "/money": [
    { key: "profit", label: "Profit" },
    { key: "budget", label: "Budget" },
    { key: "menu", label: "Menu engineering" },
  ],
  "/purchasing": [
    { key: "new", label: "New order" },
    { key: "indents", label: "Indents" },
    { key: "orders", label: "Purchase orders" },
  ],
  "/recipes": [
    { key: "new", label: "New recipe" },
    { key: "margin", label: "Best margin" },
    { key: "losing", label: "Losing money" },
    { key: "archived", label: "Archived" },
  ],
  "/reports": [
    { key: "pnl", label: "P&L" },
    { key: "vs", label: "Compare periods" },
    { key: "where", label: "Where it went" },
    { key: "health", label: "Health check" },
  ],
  "/expenses": [
    { key: "add", label: "Add an expense" },
    { key: "scan", label: "Scan a bill" },
    { key: "month", label: "This month" },
    { key: "recurring", label: "Recurring" },
  ],
  "/attendance": [
    { key: "today", label: "Today" },
    { key: "clock", label: "Clock in / out" },
    { key: "history", label: "History" },
  ],
  "/employees": [
    { key: "add", label: "Add someone" },
    { key: "team", label: "The team" },
    { key: "visa", label: "Visa & right to work" },
    { key: "paymix", label: "Pay mix" },
  ],
  "/payroll": [
    { key: "one", label: "Run payroll" },
    { key: "advances", label: "Advances" },
    { key: "history", label: "History" },
  ],
  "/rota": [
    { key: "week", label: "This week" },
    { key: "copy", label: "Copy last week" },
    { key: "labour", label: "Labour cost" },
  ],
  "/orders": [
    { key: "menu", label: "Online menu" },
    { key: "riders", label: "Riders" },
  ],
};
