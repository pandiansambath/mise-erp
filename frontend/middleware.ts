import { NextRequest, NextResponse } from "next/server";

// Function subdomains → the app section they should serve. Visiting
// careers.dineai.cloud shows /careers (URL stays on the subdomain via rewrite).
// Add new ones here AND to RESERVED_SUBDOMAINS in backend/app/api/site.py so the
// TLS cert is allowed to mint for them.
const SUBDOMAIN_ROUTES: Record<string, string> = {
  careers: "/careers",
  controlroom: "/control-room",
  "control-room": "/control-room",
  cr: "/control-room",
  order: "/order",
  orders: "/order",
  rider: "/rider",
};

// The single-level subdomain label, or null for the apex / www / bare host / localhost.
function subLabel(host: string): string | null {
  const h = host.split(":")[0].toLowerCase();
  const parts = h.split(".");
  if (parts.length < 3) return null; // apex (dineai.cloud) or localhost
  const sub = parts[0];
  return sub === "www" ? null : sub;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Never touch framework internals or static files (anything with a dot).
  if (pathname.startsWith("/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }
  const sub = subLabel(req.headers.get("host") || "");
  if (!sub) return NextResponse.next();

  // Only the subdomain ROOT is rewritten; every other path passes through so
  // people can sign in (/login), order (/order/…), etc. from their subdomain
  // without those relative links 404-ing.
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    // A known function subdomain → its section (careers → /careers). Anything else
    // is treated as a hotel @handle → that hotel's branded landing page.
    url.pathname = SUBDOMAIN_ROUTES[sub] ?? `/s/${sub}`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  // Run on page routes; skip _next internals and the favicon.
  matcher: ["/((?!_next|favicon.ico).*)"],
};
