"use client";

// 🍽️ THE TABLE. What a diner sees after scanning the card in front of them.
//
//   "customer comes to hotel and he needs to call the bearer to order food...
//    which means customer needs to call and wait for him to come and take the
//    orders. What if we automate this... customer comes and sits on the table
//    and he can scan the QR, here all items menu with detail, slogan for each
//    item, combos, literally the menu will be here. Customer can pick and order,
//    which will show real-time estimation to bring that food."
//
// Two things make this page different from the takeaway one, and both come from
// the fact that the person reading it is ALREADY HERE:
//
//   1. It asks for nothing. No name, no phone, no address — the table is the
//      address. Every field would be a reason to give up and wave at a waiter
//      instead, which is the exact behaviour this page exists to delete.
//   2. It stays open afterwards. The order becoming food is the interesting
//      part, so the page turns into a live ticket rather than a receipt.
import { use, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { THEMES, themeVars, useTheme } from "@/lib/theme";
import { dishPhoto } from "@/lib/dishPhoto";
import { TableTalk } from "@/components/order/TableTalk";
import { burstAway } from "@/components/order/burst";

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  category: string;
  emoji: string | null;
  has_photo?: boolean;
  /** Can it be added right now? */
  orderable?: boolean;
  /** If not: why, and when it is back. */
  unavailable_reason?: string | null;
};
type TableInfo = { label: string; code: string; seats: number };
type HotelInfo = {
  id: string;
  name: string;
  city: string | null;
  currency: string;
  prep_minutes?: number;
  paused?: boolean;
};
type LiveOrder = {
  id: string;
  code: string;
  status: string;
  total: string;
  created_at: string;
  updated_at?: string | null;
  items: { name: string; quantity: number; line_total: string }[];
};

const SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$", INR: "₹" };

/** What the diner is told is happening, in words a diner uses.
 *
 *  The kitchen's own words are for the kitchen — "CONFIRMED" tells somebody
 *  waiting for lunch nothing at all. */
const SAY: Record<string, { label: string; hint: string; tone: string }> = {
  NEW: { label: "Sent to the kitchen", hint: "They'll accept it in a moment", tone: "text-amber-300" },
  CONFIRMED: { label: "Accepted", hint: "You're in the queue", tone: "mise-tone-info" },
  PREPARING: { label: "Being cooked", hint: "On the stove now", tone: "mise-tone-info" },
  READY: { label: "Coming to your table", hint: "On its way over", tone: "mise-tone-good" },
  COMPLETED: { label: "Served", hint: "Enjoy", tone: "mise-tone-good" },
  REJECTED: { label: "Couldn't be made", hint: "Please ask a member of staff", tone: "text-rose-300" },
  CANCELLED: { label: "Cancelled", hint: "", tone: "text-fg-faint" },
};

export default function TablePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { theme } = useTheme();
  // Palette variables live on :root, so a public screen has to pin them itself
  // or it inherits whatever the last app page left behind.
  const themed = useMemo(() => themeVars(theme), [theme]);

  const [table, setTable] = useState<TableInfo | null>(null);
  const [hotel, setHotel] = useState<HotelInfo | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [missing, setMissing] = useState(false);
  const [cat, setCat] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [live, setLive] = useState<LiveOrder[]>([]);
  const [placing, setPlacing] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [helped, setHelped] = useState(false);
  const [basketOpen, setBasketOpen] = useState(false);
  // The talk sheet: null = shut, {dish} = opened about a dish.
  const [talk, setTalk] = useState<{ dish?: { id: string; name: string } | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const firstLoad = useRef(true);

  const money = (v: string | number) =>
    `${SYMBOL[hotel?.currency ?? "GBP"] ?? ""}${Number(v).toFixed(2)}`;

  useEffect(() => {
    fetch(`${API_BASE}/api/public/table/${code}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => {
        setTable(d.table);
        setHotel(d.hotel);
        setMenu(d.menu);
      })
      .catch(() => setMissing(true));
  }, [code]);

  // The live ticket. Polled rather than pushed because a diner's phone sleeps
  // in a pocket and a dropped socket is a page that quietly stops being true.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/public/table/${code}/orders`);
        if (r.ok && !stop) setLive((await r.json()).orders ?? []);
      } catch {
        /* a flaky dining-room wifi is not worth an error message */
      }
    };
    tick();
    const id = window.setInterval(tick, 6000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [code]);

  // Drives the countdown without re-fetching.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (menu.length && firstLoad.current) {
      firstLoad.current = false;
      setCat(menu[0]?.category ?? null);
    }
  }, [menu]);

  const cats = useMemo(() => {
    const seen: string[] = [];
    for (const m of menu) if (!seen.includes(m.category)) seen.push(m.category);
    return seen;
  }, [menu]);

  const shown = useMemo(() => menu.filter((m) => !cat || m.category === cat), [menu, cat]);
  const lines = useMemo(
    () => Object.entries(cart).map(([id, q]) => ({ item: menu.find((m) => m.id === id)!, q })).filter((l) => l.item),
    [cart, menu],
  );
  const subtotal = lines.reduce((t, l) => t + Number(l.item.price) * l.q, 0);
  const count = lines.reduce((t, l) => t + l.q, 0);

  function bump(id: string, d: number) {
    setCart((c) => {
      const n = Math.max(0, (c[id] ?? 0) + d);
      const next = { ...c };
      if (n === 0) delete next[id];
      else next[id] = n;
      return next;
    });
  }

  async function place() {
    if (!count) return;
    setPlacing(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/public/table/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: note.trim() || null,
          items: lines.map((l) => ({ menu_item_id: l.item.id, quantity: l.q })),
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? "Could not send that order");
      setCart({});
      setNote("");
      setBasketOpen(false);
      // "this is indirect marketing... we need a best top-notch animated page."
      // The celebration goes HERE and nowhere else: the order landing is the
      // one moment worth a party, and a page that sparkles while somebody is
      // reading a price is noise, not delight.
      burstAway(document.getElementById("mise-table-basket"));
      const rr = await fetch(`${API_BASE}/api/public/table/${code}/orders`);
      if (rr.ok) setLive((await rr.json()).orders ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send that order");
    } finally {
      setPlacing(false);
    }
  }

  async function callStaff() {
    setHelped(true);
    window.setTimeout(() => setHelped(false), 8000);
    await fetch(`${API_BASE}/api/public/table/${code}/help`, { method: "POST" }).catch(() => {});
  }

  if (missing) {
    return (
      <div
        data-mode={THEMES[theme].light ? "light" : "dark"}
        style={themed}
        className="mise-app grid min-h-dvh place-items-center bg-shell p-6 text-fg"
      >
        <div className="mise-well max-w-sm rounded-3xl p-8 text-center">
          <p className="text-4xl" aria-hidden>🍽️</p>
          <h1 className="mt-3 font-display text-xl">This table isn&apos;t taking orders</h1>
          <p className="mt-2 text-sm text-fg-faint">
            The card may be out of date — please ask a member of staff.
          </p>
        </div>
      </div>
    );
  }

  const active = live.filter((o) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(o.status));
  const runningTotal = live.reduce((t, o) => t + Number(o.total), 0);

  return (
    <div
      data-mode={THEMES[theme].light ? "light" : "dark"}
      style={themed}
      className="mise-app min-h-dvh bg-shell pb-32 text-fg"
    >
      {/* ── Where you are. The first thing to settle, because a QR could have
             been anything and a diner needs to know they scanned the right one. */}
      <header className="sticky top-0 z-40 border-b border-glass/10 bg-shell/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <span
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-400 text-sm font-bold text-white"
          >
            {(hotel?.name ?? "·").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg leading-tight">{hotel?.name ?? "…"}</h1>
            <p className="text-[11px] text-fg-faint">
              You&apos;re at <b className="text-brand-300">{table?.label ?? "…"}</b>
              {hotel?.prep_minutes ? ` · food in about ${hotel.prep_minutes} min` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTalk({})}
            className="mise-press mise-well shrink-0 rounded-xl px-3 py-2 text-xs font-semibold text-fg-soft"
          >
            💬 Ask
          </button>
          <button
            type="button"
            onClick={callStaff}
            className={`mise-press shrink-0 rounded-xl px-3 py-2 text-xs font-semibold transition ${
              helped ? "bg-brand-600 text-white" : "mise-well text-fg-soft"
            }`}
          >
            {helped ? "On their way" : "🔔 Need someone"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4">
        {/* ── The live ticket. "which will show real-time estimation to bring
               that food" — the reason this page stays open after ordering. */}
        {active.length > 0 && (
          <section className="mise-pop mt-4 space-y-2">
            {active.map((o) => {
              const say = SAY[o.status] ?? SAY.NEW;
              // The clock starts when the KITCHEN accepted it, not when it was
              // placed — a slammed kitchen that has not looked at the ticket is
              // not five minutes from serving it, and a countdown that lies is
              // worse than none.
              const from = o.status === "NEW" ? null : new Date(o.updated_at ?? o.created_at).getTime();
              const mins = hotel?.prep_minutes ?? 20;
              const left = from ? Math.max(0, Math.ceil((from + mins * 60000 - now) / 60000)) : null;
              return (
                <div
                  key={o.id}
                  className={`mise-card3d overflow-hidden p-3.5 ${
                    o.status === "PREPARING" ? "mise-cooking" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${say.tone}`}>{say.label}</p>
                      <p className="text-[11px] text-fg-faint">{say.hint}</p>
                    </div>
                    {left !== null && o.status !== "READY" && (
                      <div className="shrink-0 text-right">
                        <p className="font-display text-2xl font-semibold tabular-nums text-fg">
                          {left}
                          <span className="ml-1 text-xs font-normal text-fg-faint">min</span>
                        </p>
                        <p className="text-[10px] text-fg-faint">about</p>
                      </div>
                    )}
                    {o.status === "READY" && <span aria-hidden className="text-2xl">🛎️</span>}
                  </div>
                  {o.items.length > 0 && (
                    <p className="mt-2 truncate border-t border-line/50 pt-2 text-[11px] text-fg-soft">
                      {o.items.map((i) => `${i.quantity}× ${i.name}`).join(" · ")}
                    </p>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* ── The menu. */}
        {cats.length > 0 && (
          <div className="mise-noscrollbar sticky top-[4.25rem] z-30 -mx-4 flex gap-2 overflow-x-auto bg-shell/85 px-4 py-3 backdrop-blur-xl">
            {cats.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={`mise-press shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                  cat === c ? "bg-brand-600 text-white" : "mise-well text-fg-soft"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        <ul className="mt-1 space-y-2.5">
          {shown.map((m) => {
            const q = cart[m.id] ?? 0;
            return (
              <li
                key={m.id}
                className={`mise-card3d overflow-hidden p-3 ${m.orderable === false ? "opacity-60" : ""}`}
              >
                <div className="flex gap-3">
                  <span
                    aria-hidden
                    className="mise-well grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl text-2xl"
                  >
                    {/* Their own photo first, then the bundled library, then an
                        emoji. A menu of grey squares sells nothing, and most
                        kitchens will never get round to uploading photos. */}
                    {(() => {
                      const src = m.has_photo
                        ? `${API_BASE}/api/public/order/menu-photo/${m.id}`
                        : dishPhoto(m.name);
                      if (!src) return m.emoji ?? "🍽️";
                      return (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      );
                    })()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[15px] font-semibold leading-tight">{m.name}</p>
                    {/* The "slogan" he asked for — the line that sells the dish. */}
                    {m.description && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-fg-faint">
                        {m.description}
                      </p>
                    )}
                    {/* "touch me ai to see whats are all health benefits u will
                        get if u eat this" — offered on the dish itself, where
                        the curiosity actually happens. */}
                    <button
                      type="button"
                      onClick={() => setTalk({ dish: { id: m.id, name: m.name } })}
                      className="mise-press mise-tone-info mt-1 flex items-center gap-1 text-[11px] font-medium"
                    >
                      ✨ What&apos;s in it, and what it does for you
                    </button>

                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-semibold text-fg">
                        {money(m.price)}
                      </span>
                      {/* OFF THE MENU RIGHT NOW — said, not hidden. A dish that
                          silently disappears reads as "they don't do that";
                          one that says "served 07:00–11:00" brings them back
                          tomorrow. */}
                      {m.orderable === false ? (
                        <span className="mise-tone-warn rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[11px] font-medium">
                          {m.unavailable_reason ?? "Not available"}
                        </span>
                      ) : q === 0 ? (
                        <button
                          type="button"
                          onClick={() => bump(m.id, 1)}
                          className="mise-press rounded-xl bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white"
                        >
                          Add
                        </button>
                      ) : (
                        <span className="mise-well flex items-center gap-1 rounded-xl p-0.5">
                          <button
                            type="button"
                            onClick={() => bump(m.id, -1)}
                            aria-label={`One less ${m.name}`}
                            className="mise-press grid h-7 w-7 place-items-center rounded-lg text-fg-soft"
                          >
                            −
                          </button>
                          <span className="w-6 text-center text-sm font-semibold tabular-nums">{q}</span>
                          <button
                            type="button"
                            onClick={() => bump(m.id, 1)}
                            aria-label={`One more ${m.name}`}
                            className="mise-press grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-white"
                          >
                            +
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {runningTotal > 0 && (
          <p className="mt-5 text-center text-[11px] text-fg-faint">
            Ordered so far at this table:{" "}
            <b className="text-fg-soft">{money(runningTotal)}</b>
          </p>
        )}
      </main>

      {talk && (
        <TableTalk code={code} dish={talk.dish} onClose={() => setTalk(null)} />
      )}

      {/* ── The basket, pinned. Never a page you have to go to. */}
      {count > 0 && (
        <div
          id="mise-table-basket"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-glass/10 bg-shell/90 p-3 backdrop-blur-xl"
        >
          <div className="mx-auto max-w-2xl">
            {basketOpen && (
              <div className="mise-pop mb-2 max-h-[45vh] overflow-y-auto rounded-2xl">
                {lines.map((l) => (
                  <div
                    key={l.item.id}
                    className="flex items-center justify-between gap-3 border-b border-line/50 py-2 text-sm last:border-0"
                  >
                    <span className="min-w-0 truncate">
                      <b className="tabular-nums">{l.q}×</b> {l.item.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-fg-soft">
                      {money(Number(l.item.price) * l.q)}
                    </span>
                  </div>
                ))}
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything the kitchen should know? (no chilli, extra rice…)"
                  className="mise-well mt-2 w-full rounded-xl px-3 py-2 text-sm outline-none"
                />
              </div>
            )}
            {err && <p className="mb-2 text-center text-xs text-rose-300">{err}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBasketOpen((o) => !o)}
                className="mise-well mise-press shrink-0 rounded-2xl px-3.5 py-3 text-sm font-semibold"
              >
                {count} · {money(subtotal)}
              </button>
              <button
                type="button"
                onClick={place}
                disabled={placing || !!hotel?.paused}
                className="mise-press flex-1 rounded-2xl bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {hotel?.paused
                  ? "The kitchen has paused orders"
                  : placing
                    ? "Sending to the kitchen…"
                    : "Send to the kitchen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
