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

// THIS SCREEN IS READ, NOT TOUCHED.
//
//   "this page is for focusing on SEEING — seeing from distance even, so need to
//    show data highlighted so they no need to touch the screen."
//
// So status is a colour BAND, not an 8px dot nobody resolves at three metres,
// and the words are large enough to read while walking past with a pan.
const STAGE: Record<string, { label: string; dot: string; band: string }> = {
  NEW: { label: "New", dot: "bg-amber-400", band: "bg-amber-400" },
  CONFIRMED: { label: "Accepted", dot: "bg-sky-400", band: "bg-sky-400" },
  PREPARING: { label: "Cooking", dot: "bg-brand-400", band: "bg-brand-400" },
  READY: { label: "Ready to serve", dot: "bg-emerald-400", band: "bg-emerald-400" },
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

  // THE LOCK.
  //
  // This page opens from a bare link with no sign-in, so the link IS the
  // access. The backend has been able to demand the restaurant's PIN since
  // `kds_pin_required` shipped, and nothing on this side ever asked for one —
  // so a locked restaurant would have got a silent, permanently empty board.
  //
  // The pass is derived server-side from the hotel id and the PIN HASH, not
  // stored as a session: changing the PIN invalidates every screen at once,
  // which is the entire point of being able to change it.
  //
  // Kept per SCREEN CODE in localStorage, so a tablet unlocks once and survives
  // a reload — a wall-mounted screen that asks again after every refresh is a
  // screen somebody tapes the PIN to.
  const passKey = `mise.kds.pass.${code}`;
  const [kdsPass, setKdsPass] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    try {
      setKdsPass(window.localStorage.getItem(passKey));
    } catch {
      /* a kiosk browser with storage disabled still works, it just asks each time */
    }
  }, [passKey]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/public/kds/${code}`, {
        headers: kdsPass ? { "X-Kds-Pass": kdsPass } : undefined,
      });
      if (r.status === 404) {
        setMissing(true);
        return;
      }
      if (r.status === 401) {
        // Either never unlocked, or the PIN has been changed since. Both mean
        // the same thing to whoever is standing here: ask again. Drop the stale
        // pass so we are not sending a dead one every five seconds.
        setLocked(true);
        setKdsPass(null);
        try {
          window.localStorage.removeItem(passKey);
        } catch {
          /* ignore */
        }
        return;
      }
      if (!r.ok) return;
      setLocked(false);
      const d = await r.json();
      setHotel(d.hotel);
      setOrders(d.orders ?? []);
    } catch {
      /* a kitchen's wifi drops; the last board on screen is better than an error */
    }
  }, [code, kdsPass, passKey]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length < 4 || unlocking) return;
    setUnlocking(true);
    setPinErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/public/kds/${code}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!r.ok) {
        // The server answers a wrong PIN and an unknown code identically, so
        // this message must not distinguish them either.
        setPinErr("That PIN is not right.");
        setPin("");
        return;
      }
      const d = (await r.json()) as { pass: string | null };
      if (d.pass) {
        try {
          window.localStorage.setItem(passKey, d.pass);
        } catch {
          /* no storage: it will ask again next reload, which is correct */
        }
        setKdsPass(d.pass);
      }
      setLocked(false);
      setPin("");
    } catch {
      setPinErr("Could not reach the restaurant. Check the wifi.");
    } finally {
      setUnlocking(false);
    }
  }

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
        // The pass goes on the WRITE as well. Without it a locked screen could
        // read the board and then fail silently on every tap, which is the
        // worst of both — it looks like it is working.
        headers: {
          "Content-Type": "application/json",
          ...(kdsPass ? { "X-Kds-Pass": kdsPass } : {}),
        },
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

  // THE GATE. Rendered INSTEAD of the board, never over it — a board blurred
  // behind a dialog still shows the orders, and hiding them is the whole job.
  if (locked) {
    return (
      <div
        data-mode={THEMES[theme].light ? "light" : "dark"}
        style={themed}
        className="mise-app grid min-h-dvh place-items-center bg-shell p-6 text-fg"
      >
        <form onSubmit={unlock} className="mise-well w-full max-w-sm rounded-3xl p-8 text-center">
          <p className="text-4xl" aria-hidden>🔒</p>
          <h1 className="mt-3 font-display text-xl">This kitchen screen is locked</h1>
          <p className="mt-2 text-sm text-fg-faint">
            Enter the restaurant&apos;s PIN. This screen will remember it.
          </p>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            // A kitchen tablet has no keyboard: bring up digits, not letters.
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            aria-label="Restaurant PIN"
            className="mise-card-inset mx-auto mt-5 block w-44 rounded-xl bg-transparent py-3 text-center font-mono text-2xl tracking-[0.4em] text-fg outline-none"
          />
          {pinErr && (
            <p role="alert" className="mise-tone-bad mt-3 text-sm">
              {pinErr}
            </p>
          )}
          <button
            type="submit"
            disabled={pin.length < 4 || unlocking}
            className="mise-press mt-5 w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {unlocking ? "Checking…" : "Unlock"}
          </button>
          <p className="mt-4 text-[11px] leading-relaxed text-fg-faint">
            It is the same PIN the team uses to clock in. If it has just been
            changed, every screen asks again — that is what changing it is for.
          </p>
        </form>
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
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(24rem, 100%), 1fr))" }}
        >
          {groups.map((g) => {
            const first = g.rows[0];
            const mins = Math.floor((now - +new Date(first.created_at)) / 60000);
            const w = waited(mins);
            const help = g.rows.some((r) => r.help_requested_at);
            const heat =
              mins >= 20 ? "ring-2 ring-rose-400/70" : mins >= 10 ? "ring-1 ring-amber-400/60" : "";
            return (
              <li key={g.key} className="h-full">
                <div className={`mise-card3d relative flex h-full flex-col overflow-hidden p-4 pl-5 ${heat}`}>
                  {/* The status, readable from the door. */}
                  <span
                    aria-hidden
                    className={`absolute inset-y-0 left-0 w-1.5 ${
                      (STAGE[first.status] ?? STAGE.NEW).band
                    }`}
                  />
                  {help && (
                    <p className="mb-2 rounded-lg bg-amber-400/15 px-2.5 py-2 text-sm font-semibold text-amber-200">
                      🔔 This table asked for someone
                    </p>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-4xl font-semibold leading-none">{g.title}</p>
                      <p className="mt-1 text-xs text-fg-faint">
                        {g.dineIn ? "in the room" : first.fulfilment.toLowerCase()}
                        {g.rows.length > 1 ? ` · ${g.rows.length} rounds` : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-right font-display text-3xl font-semibold tabular-nums ${
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
                            <li key={k} className="flex items-baseline gap-2 text-lg">
                              <span className="font-display text-xl font-semibold tabular-nums text-brand-300">
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
