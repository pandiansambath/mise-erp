"use client";

// /control-room/fleet — every hotel, one table, first thing under the
// header (rubric H3 — the deleted ledger left for /audit and does not
// live here any more).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";
import { STRIPE, type StripeTone } from "@/components/TileCard";
import { useFleet, type HotelRow } from "@/components/controlroom/FleetProvider";
import { healthOf } from "@/components/controlroom/health";
import { n, agoDays } from "@/components/controlroom/format";
import { errorCopy } from "@/components/controlroom/useOperatorQuery";
import { pageOf, Pager, useListFilter } from "@/components/ListControls";

const HEALTH_FILTERS = ["all", "Active", "Quiet", "Dormant", "suspended"] as const;
type HealthFilter = (typeof HEALTH_FILTERS)[number];
type SortKey = "name" | "health" | "last" | "sales" | "users";

const PLAN_CHIP_TONE: Record<string, string> = { starter: "slate", pro: "sky", enterprise: "tier" };

function ErrorCard({ title, error, retry }: { title: string; error: ApiError; retry: () => void }) {
  return (
    <div className="mise-card-inset relative flex items-start gap-3 overflow-hidden p-4 pl-5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-rose-400" />
      <span className="font-mono text-2xl font-bold leading-none text-danger">{error.status || "!"}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-soft">{errorCopy(error)}</p>
      </div>
      <button
        type="button"
        onClick={retry}
        className="mise-btn-flat mise-press shrink-0 px-3 py-1.5 text-xs font-semibold"
      >
        Retry
      </button>
    </div>
  );
}

/** suspended -> overdue · at-cap -> soon · dormant -> none · else -> ok.
 *  Trial-ending cannot be shown here — /platform/hotels does not return
 *  subscription_status/trial_ends_on, only /pulse's aggregate does. */
function railOf(h: HotelRow): StripeTone {
  if (!h.is_active) return "overdue";
  if (h.max_users > 0 && h.max_users < 100000 && h.user_count >= h.max_users) return "soon";
  if (healthOf(h).label === "Dormant") return "none";
  return "ok";
}

export default function FleetPage() {
  const { user } = useAuth();
  const { hotels, loading, error, reload } = useFleet();
  const [f, setF] = useListFilter("cr.fleet");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("health");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [nowTs] = useState(() => Date.now());

  // Default page size 50 (DESIGN-STANDARD) — there is no size control in this
  // UI (ListControls' own selector is deliberately not adopted, see the
  // column-sort note below), so this is the one and only value it ever takes.
  useEffect(() => {
    setF({ ...f, size: 50 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = f.q.trim().toLowerCase();
    const rank: Record<string, number> = { Active: 0, Quiet: 1, Dormant: 2 };
    let list = hotels.filter(
      (h) =>
        !s ||
        h.name.toLowerCase().includes(s) ||
        (h.admin_email ?? "").toLowerCase().includes(s) ||
        (h.city ?? "").toLowerCase().includes(s),
    );
    if (healthFilter === "suspended") list = list.filter((h) => !h.is_active);
    else if (healthFilter !== "all") list = list.filter((h) => h.is_active && healthOf(h).label === healthFilter);
    const val = (h: HotelRow): number | string => {
      if (sortKey === "name") return h.name.toLowerCase();
      if (sortKey === "health") return rank[healthOf(h).label] ?? 3;
      if (sortKey === "last") return h.last_active ? -new Date(h.last_active).getTime() : Infinity;
      if (sortKey === "sales") return -(h.sales_entries_7d ?? 0);
      return -h.user_count;
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
    });
  }, [hotels, f.q, healthFilter, sortKey, sortDir]);

  const pageRows = pageOf(filtered, f);

  // Any change to WHAT is shown resets to page 1 — the table's own column
  // sort included, or a re-sort while on page 3 can land on an empty page.
  function setSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(1);
    }
    setF({ ...f, page: 1 });
  }

  if (!user?.is_platform_owner) return null; // flash-guard; layout redirects

  if (loading && hotels.length === 0) return <Spinner />;
  if (error) return <ErrorCard title="Could not load the fleet" error={error} retry={reload} />;

  return (
    <div className="space-y-4">
      <PageHeader title="Hotels" subtitle="Every restaurant on DineAI — click one to manage it." />

      <div className="mise-card-inset p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <input
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })}
            placeholder="Search by name, city or admin email…"
            className="mise-well min-w-0 flex-1 basis-48 rounded-xl px-3 py-2 text-sm outline-none"
          />
          <div className="flex flex-wrap gap-1.5">
            {HEALTH_FILTERS.map((hf) => (
              <button
                key={hf}
                type="button"
                onClick={() => {
                  setHealthFilter(hf);
                  setF({ ...f, page: 1 });
                }}
                className={`mise-press rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide transition ${
                  healthFilter === hf ? "mise-btn-key" : "mise-btn-flat text-fg-soft"
                }`}
              >
                {hf}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState chef={false} icon="—" title="No hotels match" body="Try a different search or filter." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="mise-stack w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  {(
                    [
                      ["name", "Hotel"],
                      ["health", "Status"],
                      ["last", "Last active"],
                      ["sales", "Sales entries 7d"],
                      ["users", "Seats"],
                    ] as const
                  ).map(([k, label]) => (
                    <th key={k} className="px-4 py-2.5">
                      <button type="button" onClick={() => setSort(k)} className="uppercase tracking-[0.14em] hover:text-fg-soft">
                        {label} {sortKey === k ? (sortDir === 1 ? "↑" : "↓") : ""}
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-2.5">Plan</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((h) => {
                  const hp = healthOf(h);
                  const atCap = h.max_users > 0 && h.max_users < 100000 && h.user_count >= h.max_users;
                  return (
                    <tr key={h.id} className={`group border-b border-line/60 transition hover:bg-glass/[0.04] ${!h.is_active ? "opacity-70" : ""}`}>
                      <td className="relative py-2.5 pl-4 pr-3">
                        <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${STRIPE[railOf(h)]}`} />
                        <Link href={`/control-room/hotels/${h.id}`} className="block min-w-0">
                          <span className="block truncate text-sm font-semibold text-fg">{h.name}</span>
                          <span className="block truncate font-mono text-[11px] text-fg-faint">
                            {[h.city, h.admin_email ?? "no admin"].filter(Boolean).join(" · ")}
                          </span>
                        </Link>
                      </td>
                      <td data-label="Status" className="px-3 py-2.5">
                        <span className="mise-chip" data-tone={!h.is_active ? "red" : hp.tone}>
                          {!h.is_active ? "suspended" : hp.label}
                        </span>
                      </td>
                      <td data-label="Last active" className="px-3 py-2.5 text-right font-mono text-xs text-fg-soft">
                        {agoDays(h.last_active, nowTs)}
                      </td>
                      <td data-label="Sales entries 7d" className="px-3 py-2.5 text-right font-mono text-xs text-fg-soft">
                        {n(h.sales_entries_7d ?? 0)}
                      </td>
                      <td data-label="Seats" className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                        <span className={atCap ? "mise-chip-warn" : "text-fg-soft"}>
                          {h.user_count}/{h.max_users >= 100000 ? "∞" : h.max_users}
                        </span>
                      </td>
                      <td data-label="Plan" className="px-3 py-2.5">
                        <span className="mise-chip" data-tone={PLAN_CHIP_TONE[h.plan] ?? "slate"}>
                          {h.plan.toUpperCase()} {h.max_users >= 100000 ? "∞" : h.max_users}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pager value={f} onChange={setF} matched={filtered.length} />
      </div>
    </div>
  );
}
