// One name per area of the app, everywhere this route shows one.
//
// The map named a restaurant's areas with raw API path segments — "hotels",
// "auth", "chat" — while the sheet on the same screen called them "Hotel
// profile" and "Signing in". Two names for one thing on one screen is how a
// reader starts to doubt both. So the words live here, once.
//
// Anything unmapped falls through to its own name, tidied, rather than being
// hidden: an area we have not named yet is still traffic that happened.

export const AREA_LABEL: Record<string, string> = {
  inventory: "Inventory",
  stock: "Stock",
  vendors: "Suppliers",
  purchasing: "Purchasing",
  recipes: "Recipes & costing",
  menu: "Menu",
  sales: "Sales",
  expenses: "Expenses",
  money: "Money",
  reports: "Reports (P&L)",
  payroll: "Payroll",
  employees: "Staff",
  attendance: "Attendance",
  rota: "Rota",
  orders: "Online orders",
  ordering: "Ordering & tables",
  tables: "Tables",
  assistant: "The AI assistant",
  chat: "Chat",
  documents: "Documents",
  settings: "Settings",
  hotels: "Hotel profile",
  auth: "Signing in",
  platform: "Control Room",
  public: "Public pages",
  waste: "Waste log",
  allergens: "Allergens",
  audit: "Trail",
  dashboard: "Dashboard",
  safety: "Food safety",
  onboarding: "Onboarding",
};

export function areaLabel(area: string): string {
  return AREA_LABEL[area] ?? area.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** An area with a real screen behind it — the only ones that get a door.
 *  A door onto a 404 is worse than no door, because it looks like it works. */
export const AREA_PAGE: Record<string, string> = {
  inventory: "/inventory",
  stock: "/inventory",
  vendors: "/vendors",
  recipes: "/recipes",
  menu: "/menu",
  sales: "/sales",
  expenses: "/expenses",
  money: "/money",
  reports: "/reports",
  purchasing: "/purchasing",
  employees: "/employees",
  attendance: "/attendance",
  payroll: "/payroll",
  rota: "/rota",
  orders: "/orders",
  tables: "/tables",
  documents: "/documents",
  waste: "/waste",
  allergens: "/allergens",
  audit: "/audit",
  dashboard: "/dashboard",
  settings: "/settings",
};

/** Friendly names for the AWS services on the bill strip. The money page says
 *  "Database — the server"; this route used to say "Relational Database
 *  Service $15.03" for the same line. */
export function serviceLabel(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("relational database")) return "Database";
  if (s.includes("elastic compute cloud") || s === "ec2") return "Server";
  if (s.includes("ec2 - other")) return "Server disk & IP";
  if (s.includes("virtual private cloud")) return "Network";
  if (s.includes("container regis")) return "Image store";
  if (s.includes("bedrock")) return "AI (Bedrock)";
  if (s.includes("polly")) return "Voice";
  if (s.includes("transcribe")) return "Listening";
  if (s.includes("cost explorer")) return "Cost lookups";
  if (s.includes("simple storage")) return "File storage";
  if (s.includes("cloudwatch")) return "Logs";
  if (s.includes("route 53")) return "DNS";
  return raw;
}
