"use client";

// 🥡 The public ordering page — what a hotel's customers see when they open
// the shared link. No login, no app install: browse the menu, build a cart,
// leave a name + phone, and watch the order move through the kitchen live.
// Theme-aware like /careers (dark premium by default, switcher in the header).

import { use, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/AppShell";
import { THEMES, themeVars, useTheme } from "@/lib/theme";

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  category: string;
  emoji: string | null;
};
type HotelInfo = { id: string; name: string; city: string | null; currency: string };
type Tracked = {
  id: string;
  code: string;
  status: string;
  fulfilment: string;
  total: string;
  items: { name: string; quantity: number; line_total: string }[];
};

const SYMBOL: Record<string, string> = { GBP: "£", INR: "₹", USD: "$", EUR: "€", AED: "د.إ" };

// The customer-facing journey; REJECTED renders its own sad-path panel.
const JOURNEY = ["NEW", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"];
const JOURNEY_META: Record<string, { label: string; emoji: string }> = {
  NEW: { label: "Sent to the kitchen", emoji: "🛎️" },
  CONFIRMED: { label: "Kitchen accepted", emoji: "👍" },
  PREPARING: { label: "Cooking now", emoji: "🔥" },
  READY: { label: "Ready", emoji: "✅" },
  OUT_FOR_DELIVERY: { label: "On its way", emoji: "🛵" },
  COMPLETED: { label: "Enjoy!", emoji: "🎉" },
};

const monogram = (name: string) =>
  name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

export default function PublicOrderPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = use(params);
  const { theme } = useTheme();
  const themed = { ...themeVars(theme), colorScheme: THEMES[theme].light ? "light" : ("dark" as const) };

  const [hotel, setHotel] = useState<HotelInfo | null>(null);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [checkout, setCheckout] = useState(false);
  const [tracked, setTracked] = useState<Tracked | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/public/order/${hotelId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setHotel(d.hotel); setMenu(d.menu); })
      .catch(() => setMissing(true));
  }, [hotelId]);

  // A placed order keeps polling so the customer watches it move.
  useEffect(() => {
    if (!tracked) return;
    const t = window.setInterval(() => {
      fetch(`${API_BASE}/api/public/order/track/${tracked.id}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then(setTracked)
        .catch(() => {});
    }, 6000);
    return () => window.clearInterval(t);
  }, [tracked?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = SYMBOL[hotel?.currency ?? "GBP"] ?? "£";
  const count = Object.values(cart).reduce((t, n) => t + n, 0);
  const total = useMemo(() => {
    let t = 0;
    for (const m of menu ?? []) t += (cart[m.id] ?? 0) * parseFloat(m.price);
    return t.toFixed(2);
  }, [cart, menu]);

  const grouped = useMemo(() => {
    const g = new Map<string, MenuItem[]>();
    for (const m of menu ?? []) g.set(m.category, [...(g.get(m.category) ?? []), m]);
    return [...g.entries()];
  }, [menu]);

  function bump(id: string, delta: number) {
    setCart((c) => {
      const n = Math.max(0, (c[id] ?? 0) + delta);
      const next = { ...c };
      if (n === 0) delete next[id];
      else next[id] = n;
      return next;
    });
  }

  if (missing) {
    return (
      <div data-mode={THEMES[theme].light ? "light" : "dark"} style={themed} className="mise-app grid min-h-screen place-items-center bg-shell p-6 text-fg">
        <div className="mise-well max-w-sm rounded-3xl p-8 text-center">
          <p className="text-4xl" aria-hidden>😔</p>
          <h1 className="mt-3 font-display text-xl text-fg">This kitchen isn&apos;t taking orders</h1>
          <p className="mt-2 text-sm text-fg-faint">The link may be old — check with the restaurant.</p>
        </div>
      </div>
    );
  }

  return (
    <div data-mode={THEMES[theme].light ? "light" : "dark"} style={themed} className="mise-app min-h-screen bg-shell pb-28 text-fg">
      {/* header */}
      <header className="sticky top-0 z-40 border-b border-glass/10 bg-shell/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          {hotel ? (
            <>
              <span aria-hidden className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-400 text-sm font-bold text-white">
                {monogram(hotel.name)}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="truncate font-display text-lg leading-tight text-fg">{hotel.name}</h1>
                <p className="text-[11px] text-fg-faint">
                  {hotel.city ? `📍 ${hotel.city} · ` : ""}order online — no app needed
                </p>
              </div>
            </>
          ) : (
            <div className="mise-shimmer h-10 flex-1 rounded-xl" />
          )}
          <ThemeSwitcher />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-6 sm:px-6">
        {tracked ? (
          <TrackPanel t={tracked} cur={cur} onNewOrder={() => { setTracked(null); setCart({}); }} />
        ) : menu === null ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="mise-shimmer h-24 rounded-2xl border border-line bg-paper" />
            ))}
          </div>
        ) : menu.length === 0 ? (
          <div className="mise-well rounded-3xl p-10 text-center">
            <p className="text-4xl" aria-hidden>🍳</p>
            <p className="mt-3 font-semibold text-fg">The menu is being written…</p>
            <p className="mt-1 text-sm text-fg-faint">Check back shortly — good things take a minute.</p>
          </div>
        ) : (
          grouped.map(([cat, items]) => (
            <section key={cat} className="mb-7">
              <h2 className="mb-3 font-display text-xl text-fg">{cat}</h2>
              <div className="space-y-2.5">
                {items.map((m) => {
                  const qty = cart[m.id] ?? 0;
                  return (
                    <div key={m.id} className={`mise-feel flex items-center gap-3 rounded-2xl border p-3.5 transition ${qty ? "border-brand-400/50 bg-brand-500/5" : "border-line bg-paper"}`}>
                      <span className="text-2xl" aria-hidden>{m.emoji || "🍽️"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-fg">{m.name}</p>
                        {m.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-fg-faint">{m.description}</p>
                        )}
                        <p className="mt-1 font-mono text-sm font-bold text-brand-400">{cur}{m.price}</p>
                      </div>
                      {qty === 0 ? (
                        <button
                          type="button"
                          onClick={() => bump(m.id, 1)}
                          className="mise-press shrink-0 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
                        >
                          Add
                        </button>
                      ) : (
                        <span className="mise-well flex shrink-0 items-center gap-1 rounded-xl p-1">
                          <button type="button" onClick={() => bump(m.id, -1)} aria-label={`One less ${m.name}`} className="mise-press grid h-8 w-8 place-items-center rounded-lg text-lg font-bold text-fg">−</button>
                          <span className="w-6 text-center font-mono text-sm font-bold text-fg">{qty}</span>
                          <button type="button" onClick={() => bump(m.id, 1)} aria-label={`One more ${m.name}`} className="mise-press grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-lg font-bold text-white">+</button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>

      {/* sticky cart bar */}
      {!tracked && count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4">
          <button
            type="button"
            onClick={() => setCheckout(true)}
            className="mise-press mise-pop mx-auto flex w-full max-w-3xl items-center justify-between rounded-2xl bg-gradient-to-r from-brand-600 to-brand-500 px-5 py-4 text-white shadow-2xl shadow-brand-500/30"
          >
            <span className="text-sm font-semibold">
              🧺 {count} item{count === 1 ? "" : "s"}
            </span>
            <span className="text-sm font-bold">
              Checkout · {cur}{total} →
            </span>
          </button>
        </div>
      )}

      {checkout && hotel && menu && (
        <CheckoutSheet
          hotel={hotel}
          menu={menu}
          cart={cart}
          cur={cur}
          total={total}
          onClose={() => setCheckout(false)}
          onPlaced={(t) => { setCheckout(false); setTracked(t); }}
        />
      )}
    </div>
  );
}

/* ── checkout ── */
function CheckoutSheet({
  hotel, menu, cart, cur, total, onClose, onPlaced,
}: {
  hotel: HotelInfo;
  menu: MenuItem[];
  cart: Record<string, number>;
  cur: string;
  total: string;
  onClose: () => void;
  onPlaced: (t: Tracked) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fulfilment, setFulfilment] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = menu.filter((m) => cart[m.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/public/order/${hotel.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: name,
          phone,
          fulfilment,
          address_text: fulfilment === "DELIVERY" ? address : undefined,
          note: note || undefined,
          items: lines.map((m) => ({ menu_item_id: m.id, quantity: cart[m.id] })),
        }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.detail ?? "Could not place the order");
      const track = await fetch(`${API_BASE}/api/public/order/track/${body.id}`);
      onPlaced(await track.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place the order");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "mise-well w-full rounded-xl px-3.5 py-2.5 text-sm text-fg outline-none focus:ring-2 focus:ring-brand-400/30";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="mise-fade absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="mise-drawer-in relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-glass/15 bg-paper-2 shadow-2xl shadow-black/50 sm:rounded-3xl">
        <div className="border-b border-glass/10 px-5 py-4">
          <h2 className="font-display text-lg text-fg">Almost there 🧺</h2>
          <p className="text-xs text-fg-faint">{hotel.name} · {cur}{total}</p>
        </div>
        <form onSubmit={submit} className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-5 py-4">
          {/* order summary */}
          <ul className="mise-well space-y-1 rounded-xl px-3.5 py-3">
            {lines.map((m) => (
              <li key={m.id} className="flex items-baseline gap-2 text-sm">
                <span className="font-mono text-fg-soft">{cart[m.id]}×</span>
                <span className="text-fg">{m.name}</span>
                <span className="mx-1 flex-1 border-b border-dotted border-line" aria-hidden />
                <span className="font-mono text-fg-soft">
                  {cur}{(cart[m.id] * parseFloat(m.price)).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>

          {/* pickup / delivery */}
          <div className="grid grid-cols-2 gap-2">
            {(["PICKUP", "DELIVERY"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFulfilment(f)}
                className={`mise-press rounded-xl px-3 py-3 text-sm font-semibold transition ${
                  fulfilment === f ? "bg-brand-600 text-white" : "mise-raised text-fg-soft"
                }`}
              >
                {f === "PICKUP" ? "🥡 Pickup" : "🛵 Delivery"}
              </button>
            ))}
          </div>

          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Your name *" aria-label="Your name" className={inputCls} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} required minLength={5} inputMode="tel" placeholder="Phone (the kitchen may call) *" aria-label="Phone" className={inputCls} />
          {fulfilment === "DELIVERY" && (
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              rows={2}
              placeholder="Delivery address — street, door, postcode *"
              aria-label="Delivery address"
              className={`${inputCls} resize-none`}
            />
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to the kitchen (allergies, spice level…)" aria-label="Note" className={inputCls} />

          {error && <p className="rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-400">{error}</p>}
          <p className="text-[11px] leading-relaxed text-fg-faint">
            💳 Pay at the counter / on delivery for now — online payment is coming soon.
          </p>
          <div className="flex gap-3 pb-1">
            <button
              type="submit"
              disabled={busy}
              className="mise-press flex-1 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-brand-500/25 disabled:opacity-60"
            >
              {busy ? "Sending to the kitchen…" : `Place order · ${cur}${total}`}
            </button>
            <button type="button" onClick={onClose} className="mise-raised mise-press rounded-xl px-4 py-3 text-sm text-fg-soft">
              Back
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── live tracking ── */
function TrackPanel({ t, cur, onNewOrder }: { t: Tracked; cur: string; onNewOrder: () => void }) {
  const rejected = t.status === "REJECTED" || t.status === "CANCELLED";
  const idx = JOURNEY.indexOf(t.status);
  const steps = t.fulfilment === "PICKUP" ? JOURNEY.filter((s) => s !== "OUT_FOR_DELIVERY") : JOURNEY;
  const prevIdx = useRef(idx);
  useEffect(() => { prevIdx.current = idx; }, [idx]);

  return (
    <div className="mise-pop mx-auto max-w-md">
      <div className="mise-feel rounded-3xl border border-line bg-paper p-6 text-center">
        {rejected ? (
          <>
            <p className="text-4xl" aria-hidden>😔</p>
            <h2 className="mt-3 font-display text-xl text-fg">The kitchen couldn&apos;t take this one</h2>
            <p className="mt-2 text-sm text-fg-faint">
              They may be slammed or out of an ingredient — give them a ring, or try again.
            </p>
          </>
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-400">your order code</p>
            <p className="mt-1 font-mono text-4xl font-bold tracking-wider text-fg">{t.code}</p>
            <p className="mt-1 text-xs text-fg-faint">
              {t.fulfilment === "PICKUP" ? "quote it at the counter" : "the rider will quote it"} · {cur}{t.total}
            </p>
            <div className="mt-6 space-y-0 text-left">
              {steps.map((s, i) => {
                const stepIdx = JOURNEY.indexOf(s);
                const done = idx >= stepIdx;
                const active = t.status === s;
                return (
                  <div key={s} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-base transition-all duration-500 ${
                          done ? "bg-brand-500/20 ring-2 ring-brand-400/60" : "mise-well opacity-50"
                        } ${active ? "mise-low-pulse" : ""}`}
                      >
                        {JOURNEY_META[s].emoji}
                      </span>
                      {i < steps.length - 1 && (
                        <span className={`h-6 w-0.5 ${done ? "bg-brand-400/60" : "bg-line"}`} aria-hidden />
                      )}
                    </div>
                    <p className={`pt-2 text-sm ${done ? "font-semibold text-fg" : "text-fg-faint"}`}>
                      {JOURNEY_META[s].label}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-[11px] text-fg-faint">updates live — keep this page open ✨</p>
          </>
        )}
        <button
          type="button"
          onClick={onNewOrder}
          className="mise-raised mise-press mt-6 rounded-xl px-5 py-2.5 text-sm font-medium text-fg-soft"
        >
          {rejected ? "Back to the menu" : "Order something else"}
        </button>
      </div>
    </div>
  );
}
