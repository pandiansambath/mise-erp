"use client";

// 👨‍🍳 THE KITCHEN SCREEN — the tab on the wall.
//
//   "at the same time other side customer, table, items etc super admin will
//    get and this will be displayed to tab which is inside the kitchen, so the
//    chef or whoever can make the dish and serve to that particular table."
//
// Designed for a screen nobody is standing in front of. Everything is sized to
// be read at arm's length with wet hands: big table numbers, one obvious button
// per ticket, and colour that means "how long has this been waiting" rather than
// decoration. It refreshes itself, because a chef will not remember to.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Card, Spinner } from "@/components/ui";
import { Workbench } from "@/components/Workbench";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";

type Item = { name: string; quantity: number };
type Order = {
  id: string;
  code: string;
  status: string;
  customer_name: string;
  fulfilment: string;
  table_label?: string | null;
  note?: string | null;
  total: string;
  created_at: string;
  help_requested_at?: string | null;
  items: Item[];
};

// What the chef presses next, and what it is called in kitchen words.
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

export default function KitchenPage() {
  const { user } = useAuth();
  const canWrite = can(user?.role, "orders:write");
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [screen, setScreen] = useState<{ url: string } | null>(null);
  const [prep, setPrep] = useState("");
  const [savingPrep, setSavingPrep] = useState(false);

  const load = useCallback(
    () =>
      api
        .get<{ orders: Order[] }>("/ordering/orders?status=live")
        .then((d) => setOrders(d.orders ?? []))
        .catch(() => {}),
    [],
  );

  // Refreshes itself. Nobody is going to press reload with a pan in one hand.
  useEffect(() => {
    load().finally(() => setLoading(false));
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // The login-free address for the tablet, and the prep time the diner's
  // countdown is built from — "where we will choose the estimate time?"
  useEffect(() => {
    api.get<{ url: string }>("/ordering/kitchen-screen").then(setScreen).catch(() => {});
    api.get<{ id: string; label: string }[]>("/ordering/tables").then(setTables).catch(() => {});
    api
      .get<{ prep_minutes?: number }>("/ordering/settings")
      .then((d) => setPrep(String(d.prep_minutes ?? 20)))
      .catch(() => {});
  }, []);

  async function savePrep() {
    setSavingPrep(true);
    try {
      await api.patch("/ordering/settings", { prep_minutes: Math.max(1, parseInt(prep, 10) || 20) });
    } finally {
      setSavingPrep(false);
    }
  }

  /** Clear a table down for the next party. */
  async function release(tableLabel: string, orderId: string) {
    const t = tables.find((x) => x.label === tableLabel);
    if (!t) return;
    setBusy(orderId);
    try {
      await api.post(`/ordering/tables/${t.id}/release`, {});
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function advance(o: Order) {
    const step = NEXT[o.status];
    if (!step) return;
    setBusy(o.id);
    try {
      await api.patch(`/ordering/orders/${o.id}`, { status: step.to });
      await load();
    } finally {
      setBusy(null);
    }
  }

  const live = useMemo(
    () =>
      [...orders]
        .filter((o) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(o.status))
        // Oldest first: the ticket that has been waiting longest is the one
        // that matters, and a kitchen screen sorted by anything else is a
        // kitchen that serves people in the wrong order.
        .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)),
    [orders],
  );

  const waiting = (o: Order) => Math.floor((now - +new Date(o.created_at)) / 60000);

  /** How long it has been waiting, in units a person reads.
   *
   *  "51655 min" is arithmetically right and humanly useless — a ticket left
   *  from last month should say so at a glance rather than make a chef do
   *  division while holding a pan. */
  const waited = (mins: number) => {
    if (mins < 60) return { n: String(mins), unit: "min" };
    if (mins < 60 * 24) return { n: (mins / 60).toFixed(mins < 600 ? 1 : 0), unit: "hr" };
    return { n: String(Math.round(mins / 1440)), unit: "days" };
  };
  const dineIn = live.filter((o) => o.fulfilment === "DINE_IN").length;

  if (!canWrite) {
    return (
      <Card>
        <p className="py-8 text-center text-sm text-fg-faint">
          You don&apos;t have access to the kitchen screen.
        </p>
      </Card>
    );
  }

  return (
    <Workbench
      title="Kitchen"
      subtitle="Every ticket waiting, oldest first. Tap to move it along."
      tools={
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-[11px] font-medium text-fg-soft">Food is ready in about</span>
            <span className="mt-1 flex items-center gap-1.5">
              <input
                inputMode="numeric"
                value={prep}
                onChange={(e) => setPrep(e.target.value.replace(/\D/g, ""))}
                aria-label="Minutes until food is ready"
                className="mise-well w-16 rounded-xl px-3 py-2.5 text-center text-sm outline-none"
              />
              <span className="text-xs text-fg-faint">min</span>
              <button
                type="button"
                onClick={savePrep}
                disabled={savingPrep}
                className="mise-press mise-raised rounded-xl px-3 py-2.5 text-xs font-medium text-fg-soft disabled:opacity-40"
              >
                {savingPrep ? "…" : "Save"}
              </button>
            </span>
          </label>
          {screen && (
            <a
              href={screen.url}
              target="_blank"
              rel="noreferrer"
              className="mise-press rounded-xl border border-brand-400/40 bg-brand-400/10 px-4 py-2.5 text-sm font-semibold text-brand-300"
              title="Opens a screen that needs no login — leave it on the kitchen tablet"
            >
              📺 Open kitchen screen
            </a>
          )}
        </div>
      }
      tally={
        <p className="text-xs text-fg-faint">
          <b className="text-fg-soft tabular-nums">{live.length}</b> on the pass ·{" "}
          <b className="text-fg-soft tabular-nums">{dineIn}</b> from tables in the room · refreshes
          itself every few seconds
        </p>
      }
    >
      {loading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : live.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <p className="text-4xl" aria-hidden>🍳</p>
            <p className="mt-3 text-sm font-medium text-fg">Nothing waiting</p>
            <p className="mt-1 text-xs text-fg-faint">
              New orders appear here the moment they are placed.
            </p>
          </div>
        </Card>
      ) : (
        <ul
          className="mise-stagger grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(18rem, 100%), 1fr))" }}
        >
          {live.map((o) => {
            const mins = waiting(o);
            const step = NEXT[o.status];
            const stage = STAGE[o.status] ?? STAGE.NEW;
            const help = !!o.help_requested_at;
            // Colour means how long it has waited, not decoration.
            const heat =
              mins >= 20 ? "ring-2 ring-rose-400/70" : mins >= 10 ? "ring-1 ring-amber-400/60" : "";
            return (
              <li key={o.id}>
                <div className={`mise-card3d relative overflow-hidden p-4 ${heat}`}>
                  {help && (
                    <p className="mb-2 rounded-lg bg-amber-400/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200">
                      🔔 This table asked for someone
                    </p>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {/* THE TABLE, as big as the card allows. It is the only
                          thing a chef needs to read from across the room. */}
                      <p className="font-display text-2xl font-semibold leading-none text-fg">
                        {o.fulfilment === "DINE_IN"
                          ? (o.table_label ?? o.customer_name)
                          : o.customer_name}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-faint">
                        <span aria-hidden className={`h-2 w-2 rounded-full ${stage.dot}`} />
                        {stage.label} ·{" "}
                        {o.fulfilment === "DINE_IN" ? "in the room" : o.fulfilment.toLowerCase()} ·{" "}
                        {o.code}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-right font-display text-xl font-semibold tabular-nums ${
                        mins >= 20 ? "text-rose-300" : mins >= 10 ? "text-amber-300" : "text-fg-soft"
                      }`}
                    >
                      {waited(mins).n}
                      <span className="ml-0.5 text-[10px] font-normal text-fg-faint">
                        {waited(mins).unit}
                      </span>
                    </span>
                  </div>

                  <ul className="mt-3 space-y-1 border-t border-line/60 pt-2.5">
                    {o.items.map((it, i) => (
                      <li key={i} className="flex items-baseline gap-2 text-sm">
                        <span className="font-display text-base font-semibold tabular-nums text-brand-300">
                          {it.quantity}×
                        </span>
                        <span className="min-w-0 flex-1 truncate text-fg">{it.name}</span>
                      </li>
                    ))}
                    {o.items.length === 0 && (
                      <li className="text-xs text-fg-faint">No food — they just need someone.</li>
                    )}
                  </ul>

                  {o.note && (
                    <p className="mise-tone-warn mt-2 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-xs">
                      “{o.note}”
                    </p>
                  )}

                  {o.fulfilment === "DINE_IN" && o.table_label && (
                    <button
                      type="button"
                      onClick={() => release(o.table_label!, o.id)}
                      disabled={busy === o.id}
                      className="mise-press mt-3 w-full rounded-xl border border-line px-3 py-2 text-xs font-medium text-fg-faint hover:border-amber-400/50 hover:text-amber-200 disabled:opacity-50"
                      title="They have left — clear it down for the next party"
                    >
                      🔄 Free up {o.table_label}
                    </button>
                  )}
                  {step && (
                    <button
                      type="button"
                      onClick={() => advance(o)}
                      disabled={busy === o.id}
                      className="mise-press mt-3 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {busy === o.id ? "…" : step.label}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Workbench>
  );
}
