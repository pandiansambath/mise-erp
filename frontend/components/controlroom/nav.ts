// The Control Room's own top-level nav. Every entry is an ABSOLUTE path —
// controlroom.dineai.cloud only rewrites "/" (middleware.ts:39), so a bare
// `href="/fleet"` would 404 there even though it works from dineai.cloud.

export const CR_NAV = [
  { href: "/control-room", label: "Overview" },
  { href: "/control-room/fleet", label: "Hotels", owns: ["/control-room/hotels"] },
  { href: "/control-room/ai", label: "AI spend" },
  { href: "/control-room/broadcast", label: "Broadcast" },
  { href: "/control-room/jobs", label: "Job board" },
  { href: "/control-room/plans", label: "Plans" },
  { href: "/control-room/audit", label: "Trail" },
  { href: "/control-room/operators", label: "Operators" },
] as const;

export type CrNavItem = (typeof CR_NAV)[number];

export function isActive(pathname: string, item: CrNavItem): boolean {
  // EXACT for Overview, or it lights on every route (every path starts with "/control-room").
  if (item.href === "/control-room") return pathname === "/control-room";
  const owns: readonly string[] = "owns" in item ? item.owns : [];
  return pathname.startsWith(item.href) || owns.some((p) => pathname.startsWith(p));
}
