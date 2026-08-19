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
  /** What the table said, kept apart from the cooking note. */
  guest_message?: string | null;
  /** What the KITCHEN says this ticket takes. Null = the hotel default. */
  eta_minutes?: number | null;
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

  /** The kitchen's own estimate for THIS ticket. Blank puts it back on the
   *  hotel default. */
  async function setEta(o: Order, raw: string) {
    const n = raw.trim() === "" ? null : Math.max(1, parseInt(raw, 10) || 0);
    if ((o.eta_minutes ?? null) === n) return;
    try {
      await api.patch(`/ordering/orders/${o.id}/eta`, { minutes: n });
      await load();
    } catch {
      /* the box keeps what was typed; the board refreshes anyway */
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

  /** ONE CARD PER TABLE.
   *
   *  "if same table same customer do one more dish like juice, it's coming as a
   *   separate table 4 — I can see 2 table 4. Actually we need to group them
   *   until free up."
   *
   *  A table is one party until somebody clears it down, and two cards for one
   *  table is how a round of drinks gets carried to the wrong people. Each
   *  round keeps its own line and its own button, because the starters finish
   *  before the juice does. */
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; title: string; dineIn: boolean; rows: Order[] }>();
    for (const o of live) {
      const key = o.fulfilment === "DINE_IN" && o.table_label ? `t:${o.table_label}` : `o:${o.id}`;
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
    return [...m.values()].sort(
      (a, b) => +new Date(a.rows[0].created_at) - +new Date(b.rows[0].created_at),
    );
  }, [live]);

  /** WHOEVER IS WAITING FOR A PERSON, at the top.
   *
   *  "if some table sending msg or calling someone means it need to be at top
   *   portion... so that one can easily see and go to that table instantly."
   *
   *  A band that only exists when somebody is waiting — a permanent empty
   *  section teaches the eye to skip that part of the screen. */
  const calling = useMemo(
    () => groups.filter((g) => g.rows.some((r) => r.help_requested_at)),
    [groups],
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
        <>
          {/* WHOEVER IS WAITING FOR A PERSON — above everything else, and only
              when somebody is. A permanent empty band teaches the eye to skip
              that part of the screen. */}
          {calling.length > 0 && (
            <section className="mise-pop mb-4 rounded-2xl border border-amber-400/40 bg-amber-400/[0.07] p-3">
              <p className="mise-tone-warn mb-2 text-xs font-semibold uppercase tracking-wide">
                🔔 Waiting for someone
              </p>
              <ul className="flex flex-wrap gap-2">
                {calling.map((g) => {
                  const said = g.rows.find((r) => r.guest_message)?.guest_message;
                  const mins = Math.floor((now - +new Date(g.rows[0].created_at)) / 60000);
                  return (
                    <li key={g.key}>
                      <a
                        href={`#t-${g.key}`}
                        className="mise-press mise-card3d flex items-center gap-2.5 px-3 py-2 text-left"
                      >
                        <span className="font-display text-lg font-semibold text-fg">
                          {g.title}
                        </span>
                        <span className="min-w-0 max-w-[16rem]">
                          <span className="block truncate text-[11px] text-fg-soft">
                            {said ?? "Asked for a member of staff"}
                          </span>
                          <span className="mise-tone-warn block text-[10px]">
                            waiting {waited(mins).n} {waited(mins).unit}
                          </span>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <ul
            className="mise-stagger grid gap-3"
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
                <li key={g.key} id={`t-${g.key}`}>
                  <div className={`mise-card3d relative overflow-hidden p-4 ${heat}`}>
                    {help && (
                      <p className="mb-2 rounded-lg bg-amber-400/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200">
                        🔔 This table asked for someone
                      </p>
                    )}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {/* The table, as big as the card allows — the only
                            thing a chef needs from across the room. */}
                        <p className="font-display text-2xl font-semibold leading-none text-fg">
                          {g.title}
                        </p>
                        <p className="mt-1 text-[11px] text-fg-faint">
                          {g.dineIn ? "in the room" : first.fulfilment.toLowerCase()}
                          {g.rows.length > 1 ? ` · ${g.rows.length} rounds` : ""}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-right font-display text-xl font-semibold tabular-nums ${
                          mins >= 20 ? "text-rose-300" : mins >= 10 ? "text-amber-300" : "text-fg-soft"
                        }`}
                      >
                        {w.n}
                        <span className="ml-0.5 text-[10px] font-normal text-fg-faint">
                          {w.unit}
                        </span>
                      </span>
                    </div>

                    {g.rows.map((o, i) => {
                      const step = NEXT[o.status];
                      const stage = STAGE[o.status] ?? STAGE.NEW;
                      return (
                        <div key={o.id} className="mt-3 border-t border-line/60 pt-2.5">
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <p className="flex items-center gap-1.5 text-[11px] text-fg-faint">
                              <span aria-hidden className={`h-2 w-2 rounded-full ${stage.dot}`} />
                              {g.rows.length > 1 ? `Round ${i + 1} · ` : ""}
                              {stage.label} · {o.code}
                            </p>
                            {/* Per-ticket estimate. "chef and super admin can
                                change the estimated time for each table
                                order" — a biryani is forty minutes and a lassi
                                is two, and an average serves neither. */}
                            <span className="flex items-center gap-1">
                              <input
                                inputMode="numeric"
                                defaultValue={o.eta_minutes ?? ""}
                                placeholder="ETA"
                                aria-label={`Minutes for ${o.code}`}
                                onBlur={(e) => setEta(o, e.target.value)}
                                className="mise-well w-12 rounded-lg px-1.5 py-1 text-center text-[11px] outline-none"
                              />
                              <span className="text-[10px] text-fg-faint">min</span>
                            </span>
                          </div>
                          <ul className="space-y-1">
                            {o.items.map((it, k) => (
                              <li key={k} className="flex items-baseline gap-2 text-sm">
                                <span className="font-display text-base font-semibold tabular-nums text-brand-300">
                                  {it.quantity}×
                                </span>
                                <span className="min-w-0 flex-1 truncate text-fg">{it.name}</span>
                              </li>
                            ))}
                            {o.items.length === 0 && (
                              <li className="text-xs text-fg-faint">
                                No food — they just need someone.
                              </li>
                            )}
                          </ul>
                          {o.guest_message && (
                            <p className="mise-tone-warn mt-1.5 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-xs">
                              💬 “{o.guest_message}”
                            </p>
                          )}
                          {o.note && (
                            <p className="mt-1.5 rounded-lg bg-glass/5 px-2.5 py-1.5 text-xs text-fg-soft">
                              “{o.note}”
                            </p>
                          )}
                          {step && (
                            <button
                              type="button"
                              onClick={() => advance(o)}
                              disabled={busy === o.id}
                              className="mise-press mt-2 w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              {busy === o.id ? "…" : step.label}
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {g.dineIn && (
                      <button
                        type="button"
                        onClick={() => release(g.title, first.id)}
                        disabled={busy === first.id}
                        className="mise-press mt-3 w-full rounded-xl border border-line px-3 py-2 text-xs font-medium text-fg-faint hover:border-amber-400/50 hover:text-amber-200 disabled:opacity-50"
                        title="They have left — clear it down for the next party"
                      >
                        🔄 Free up {g.title}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Workbench>
  );
}
