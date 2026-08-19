"use client";

// 📺 THE KITCHEN SCREEN. A tablet on the wall, opened by a link, no login.
//
//   "we also need one button here to open a kiosk page of this, so that the
//    kitchen staff no need to have my super admin creds in tab."
//
// Built for a device nobody is holding: big type, one obvious button per
// ticket, no navigation to get lost in, and it refreshes itself because nobody
// reloads a page with a pan in one hand.
//
// Tickets from the SAME TABLE are stacked into one card — "if same table same
// customer do one more dish like juice, it's coming as a separate table 4, I
// can see 2 table 4, actually we need to group them until free up". A table is
// one party until somebody clears it down, and two cards for one table is how
// a round of drinks gets carried to the wrong people.
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE } from "@/lib/api";
import { THEMES, themeVars, useTheme } from "@/lib/theme";

type Item = { name: string; quantity: number };
type Order = {
  id: string;
  code: string;
  status: string;
  customer_name: string;
  fulfilment: string;
  table_label?: string | null;
  note?: string | null;
  created_at: string;
  help_requested_at?: string | null;
  items: Item[];
};

const NEXT: Record<string, { to: string; label: string }> = {
  NEW: { to: "CONFIRMED", label: "Accept" },
  CONFIRMED: { to: "PREPARING", label: "Start cooking" },
  PREPARING: { to: "READY", label: "Ready" },
  READY: { to: "COMPLETED", label: "Served" },
};

const STAGE: Record<string, { label: string; dot: string }> = {
  NEW: { label: "New", dot: "bg-amber-400" },
  CONFIRMED: { label: "Accepted", dot: "bg-sky-400" },
  PREPARING: { label: "Cooking", dot: "bg-brand-400" },
  READY: { label: "Ready to serve", dot: "bg-emerald-400" },
};

/** Waiting time in units a person reads, not 51655 minutes. */
function waited(mins: number) {
  if (mins < 60) return { n: String(mins), unit: "min" };
  if (mins < 60 * 24) return { n: (mins / 60).toFixed(mins < 600 ? 1 : 0), unit: "hr" };
  return { n: String(Math.round(mins / 1440)), unit: "days" };
}

export default function KitchenScreen({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { theme } = useTheme();
  const themed = useMemo(() => themeVars(theme), [theme]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [hotel, setHotel] = useState<{ name: string } | null>(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/public/kds/${code}`);
      if (r.status === 404) {
        setMissing(true);
        return;
      }
      if (!r.ok) return;
      const d = await r.json();
      setHotel(d.hotel);
      setOrders(d.orders ?? []);
    } catch {
      /* a kitchen's wifi drops; the last board on screen is better than an error */
    }
  }, [code]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  async function move(o: Order) {
    const step = NEXT[o.status];
    if (!step) return;
    setBusy(o.id);
    try {
      await fetch(`${API_BASE}/api/public/kds/${code}/orders/${o.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: step.to }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  /** ONE CARD PER TABLE. Everything that table has ordered since it was last
   *  freed sits together, oldest first, because that is one party eating one
   *  meal — not three unrelated jobs that happen to share a number. */
  const groups = useMemo(() => {
    const live = orders.filter((o) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(o.status));
    const m = new Map<string, { key: string; title: string; dineIn: boolean; rows: Order[] }>();
    for (const o of live) {
      const key =
        o.fulfilment === "DINE_IN" && o.table_label ? `t:${o.table_label}` : `o:${o.id}`;
      const g = m.get(key) ?? {
        key,
        title: o.fulfilment === "DINE_IN" ? (o.table_label ?? o.customer_name) : o.customer_name,
        dineIn: o.fulfilment === "DINE_IN",
        rows: [],
      };
      g.rows.push(o);
      m.set(key, g);
    }
    for (const g of m.values()) {
      g.rows.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    }
    // Oldest-waiting table first: any other order serves people out of turn.
    return [...m.values()].sort(
      (a, b) => +new Date(a.rows[0].created_at) - +new Date(b.rows[0].created_at),
    );
  }, [orders]);

  if (missing) {
    return (
      <div
        data-mode={THEMES[theme].light ? "light" : "dark"}
        style={themed}
        className="mise-app grid min-h-dvh place-items-center bg-shell p-6 text-fg"
      >
        <div className="mise-well max-w-sm rounded-3xl p-8 text-center">
          <p className="text-4xl" aria-hidden>📺</p>
          <h1 className="mt-3 font-display text-xl">This screen is no longer connected</h1>
          <p className="mt-2 text-sm text-fg-faint">
            Ask the owner to open Kitchen → <b>Open kitchen screen</b> for the current link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-mode={THEMES[theme].light ? "light" : "dark"}
      style={themed}
      className="mise-app min-h-dvh bg-shell p-4 text-fg"
    >
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">{hotel?.name ?? "Kitchen"}</h1>
          <p className="text-xs text-fg-faint">
            {groups.length} waiting · oldest first · updates itself
          </p>
        </div>
        <span className="text-xs text-fg-faint">
          {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </header>

      {groups.length === 0 ? (
        <div className="grid min-h-[60dvh] place-items-center">
          <div className="text-center">
            <p className="text-5xl" aria-hidden>🍳</p>
            <p className="mt-3 text-lg font-medium text-fg">Nothing waiting</p>
            <p className="mt-1 text-sm text-fg-faint">New orders appear the moment they land.</p>
          </div>
        </div>
      ) : (
        <ul
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(20rem, 100%), 1fr))" }}
        >
          {groups.map((g) => {
            const first = g.rows[0];
            const mins = Math.floor((now - +new Date(first.created_at)) / 60000);
            const w = waited(mins);
            const help = g.rows.some((r) => r.help_requested_at);
            const heat =
              mins >= 20 ? "ring-2 ring-rose-400/70" : mins >= 10 ? "ring-1 ring-amber-400/60" : "";
            return (
              <li key={g.key}>
                <div className={`mise-card3d overflow-hidden p-4 ${heat}`}>
                  {help && (
                    <p className="mb-2 rounded-lg bg-amber-400/15 px-2.5 py-2 text-sm font-semibold text-amber-200">
                      🔔 This table asked for someone
                    </p>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-3xl font-semibold leading-none">{g.title}</p>
                      <p className="mt-1 text-xs text-fg-faint">
                        {g.dineIn ? "in the room" : first.fulfilment.toLowerCase()}
                        {g.rows.length > 1 ? ` · ${g.rows.length} rounds` : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-right font-display text-2xl font-semibold tabular-nums ${
                        mins >= 20 ? "text-rose-300" : mins >= 10 ? "text-amber-300" : "text-fg-soft"
                      }`}
                    >
                      {w.n}
                      <span className="ml-0.5 text-[11px] font-normal text-fg-faint">{w.unit}</span>
                    </span>
                  </div>

                  {/* Each round keeps its own line and its own button — the
                      kitchen finishes the starters before the juice, and one
                      button for the lot would force them to lie about it. */}
                  {g.rows.map((o, i) => {
                    const step = NEXT[o.status];
                    const stage = STAGE[o.status] ?? STAGE.NEW;
                    return (
                      <div
                        key={o.id}
                        className={`mt-3 border-t border-line/60 pt-2.5 ${i > 0 ? "" : ""}`}
                      >
                        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-fg-faint">
                          <span aria-hidden className={`h-2 w-2 rounded-full ${stage.dot}`} />
                          {g.rows.length > 1 ? `Round ${i + 1} · ` : ""}
                          {stage.label} · {o.code}
                        </p>
                        <ul className="space-y-1">
                          {o.items.map((it, k) => (
                            <li key={k} className="flex items-baseline gap-2 text-base">
                              <span className="font-display text-lg font-semibold tabular-nums text-brand-300">
                                {it.quantity}×
                              </span>
                              <span className="min-w-0 flex-1 truncate">{it.name}</span>
                            </li>
                          ))}
                          {o.items.length === 0 && (
                            <li className="text-sm text-fg-faint">
                              No food — they just need someone.
                            </li>
                          )}
                        </ul>
                        {o.note && (
                          <p className="mise-tone-warn mt-1.5 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-sm">
                            “{o.note}”
                          </p>
                        )}
                        {step && (
                          <button
                            type="button"
                            onClick={() => move(o)}
                            disabled={busy === o.id}
                            className="mise-press mt-2 w-full rounded-xl bg-brand-600 py-3 text-base font-semibold text-white disabled:opacity-50"
                          >
                            {busy === o.id ? "…" : step.label}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
