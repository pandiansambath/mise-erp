/** Which restaurant's front door is this?
 *
 * A hotel's sign-in page lives at <handle>.dineai.cloud. That door belongs to
 * that restaurant, so it must not open for anybody else's staff, and it must
 * not offer to create a NEW hotel — accounts there are made by the owner, not
 * self-served.
 *
 * Returns the handle, or null on the apex, www, localhost, or any of the
 * function subdomains (careers, control-room, the dev page and so on), which
 * are not hotel doors.
 */

// Kept in step with SUBDOMAIN_ROUTES in middleware.ts and RESERVED_SUBDOMAINS in
// backend/app/api/site.py. Anything here is a function of the platform rather
// than a customer's site.
const FUNCTION_SUBDOMAINS = new Set([
  "www", "app", "careers", "controlroom", "control-room", "cr",
  "order", "orders", "rider", "admin", "hello", "support", "pandi-dev",
]);

export function hotelSite(host?: string): string | null {
  const h = (host ?? (typeof window === "undefined" ? "" : window.location.hostname))
    .split(":")[0]
    .toLowerCase();
  if (!h || h === "localhost" || /^\d+(\.\d+){3}$/.test(h)) return null;
  const parts = h.split(".");
  if (parts.length < 3) return null; // apex, e.g. dineai.cloud
  const label = parts[0];
  return FUNCTION_SUBDOMAINS.has(label) ? null : label;
}
