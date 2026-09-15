// Reading a hotel's pulse from the fields the fleet row already carries —
// moved out of page.tsx so every route (fleet table, hotel header, the
// Overview attention queue) uses the exact same definition of "healthy".

import type { HotelRow } from "./FleetProvider";

/** Active = traded/logged in this week · Quiet = seen in 14d · Dormant = gone cold.
 *  `now` is passed in rather than read here: reading the clock during render
 *  is impure, and a list that draws differently on two renders with no state
 *  change is a flicker nobody can point at (see TileCard.tsx:35-38). */
export function healthOf(h: HotelRow, now: number): { label: "Active" | "Quiet" | "Dormant"; tone: "green" | "amber" | "slate" } {
  const days = h.last_active ? (now - new Date(h.last_active).getTime()) / 86400000 : Infinity;
  if ((h.sales_entries_7d ?? 0) > 0 || days <= 3) return { label: "Active", tone: "green" };
  if (days <= 14) return { label: "Quiet", tone: "amber" };
  return { label: "Dormant", tone: "slate" };
}

export type AttentionItem = {
  hotelId: string;
  hotelName: string;
  reason: string;
  tone: "bad" | "warn" | "plain";
};

/**
 * One ranked, plain-English reason per row. Every signal here is a field
 * already returned by GET /platform/hotels or /platform/pulse — no new
 * backend work.
 *
 * `trialsEnding` is /platform/pulse's `tenants.trials_ending[]`, serialised
 * by backend/app/platform_admin/observability.py:155-163 as exactly
 * `{ id, name, handle, ends_on }`. Match that shape exactly.
 */
export function attention(hotels: HotelRow[], trialsEnding: unknown[] = []): AttentionItem[] {
  const now = Date.now();
  const trialFor = new Map<string, string>();
  for (const raw of trialsEnding) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = r.id as string | undefined;
    const ends = r.ends_on as string | undefined;
    if (id && ends) trialFor.set(id, ends);
  }

  const out: AttentionItem[] = [];
  for (const h of hotels) {
    if (!h.is_active) {
      out.push({ hotelId: h.id, hotelName: h.name, reason: "Suspended — nobody there can log in", tone: "bad" });
    }

    const endsOn = trialFor.get(h.id);
    if (endsOn) {
      out.push({
        hotelId: h.id,
        hotelName: h.name,
        reason: `Trial ends ${new Date(endsOn).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`,
        tone: "warn",
      });
    }

    const ageDays = (now - new Date(h.created_at).getTime()) / 86400000;
    if (!h.has_traded && ageDays > 14) {
      out.push({
        hotelId: h.id,
        hotelName: h.name,
        reason: `Signed up ${Math.floor(ageDays)} days ago, has never recorded a sale`,
        tone: "warn",
      });
    }

    if (h.is_active && healthOf(h, now).label === "Dormant") {
      const days = h.last_active ? Math.floor((now - new Date(h.last_active).getTime()) / 86400000) : null;
      out.push({
        hotelId: h.id,
        hotelName: h.name,
        reason: days != null ? `Not seen for ${days} days` : "Never seen active",
        tone: "plain",
      });
    }

    if (h.max_users > 0 && h.max_users < 100000 && h.user_count >= h.max_users) {
      out.push({
        hotelId: h.id,
        hotelName: h.name,
        reason: `Using all ${h.max_users} seat${h.max_users === 1 ? "" : "s"} — they cannot add staff without upgrading`,
        tone: "warn",
      });
    }

    if (h.is_comp || h.ai_daily_override || h.ai_monthly_override) {
      out.push({
        hotelId: h.id,
        hotelName: h.name,
        reason: "On an operator override — check it is still intended",
        tone: "plain",
      });
    }
  }

  const rank: Record<AttentionItem["tone"], number> = { bad: 0, warn: 1, plain: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
