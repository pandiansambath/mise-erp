"use client";

// 🛵 Online Orders — the live kitchen board + the public menu manager.
//
// Live board: every order rolls in at the top, NEW ones pulse until accepted,
// and each card advances along the kitchen flow (NEW → CONFIRMED → PREPARING →
// READY → OUT_FOR_DELIVERY/COMPLETED) with one tap. Polls every 8s in place.
// Menu: what the public ordering page sells — quick add, availability
// switches, and one-click import from priced recipes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Card, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  category: string;
  emoji: string | null;
  is_available: boolean;
  recipe_id: string | null;
};
type OrderLine = { name: string; quantity: number; unit_price: string; line_total: string };
type Order = {
  id: string;
  code: string;
  status: string;
  fulfilment: string;
  customer_name: string;
  phone: string;
  address_text: string | null;
  address_lat: string | null;
  address_lng: string | null;
  note: string | null;
  subtotal: string;
  delivery_fee: string;
  total: string;
  created_at: string | null;
  items: OrderLine[];
};
type Vitals = { today_orders: number; today_revenue: string; live: number };

// Mirrors backend ORDER_FLOW — the buttons each status offers.
const FLOW: Record<string, string[]> = {
  NEW: ["CONFIRMED", "REJECTED"],
  CONFIRMED: ["PREPARING", "REJECTED"],
  PREPARING: ["READY"],
  READY: ["OUT_FOR_DELIVERY", "COMPLETED"],
  OUT_FOR_DELIVERY: ["COMPLETED"],
};
const STATUS_META: Record<string, { label: string; tone: string; emoji: string }> = {
  NEW: { label: "New", tone: "bg-amber-500/15 text-amber-500", emoji: "🛎️" },
  CONFIRMED: { label: "Confirmed", tone: "bg-sky-500/15 text-sky-400", emoji: "👍" },
  PREPARING: { label: "Preparing", tone: "bg-violet-500/15 text-violet-400", emoji: "🔥" },
  READY: { label: "Ready", tone: "bg-emerald-500/15 text-emerald-400", emoji: "✅" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", tone: "bg-cyan-500/15 text-cyan-400", emoji: "🛵" },
  COMPLETED: { label: "Completed", tone: "bg-line/40 text-fg-soft", emoji: "🏁" },
  REJECTED: { label: "Rejected", tone: "bg-rose-500/15 text-rose-400", emoji: "🚫" },
  CANCELLED: { label: "Cancelled", tone: "bg-line/40 text-fg-faint", emoji: "—" },
};
const ADVANCE_LABEL: Record<string, string> = {
  CONFIRMED: "Accept 👍",
  PREPARING: "Start cooking 🔥",
  READY: "Mark ready ✅",
  OUT_FOR_DELIVERY: "Send rider 🛵",
  COMPLETED: "Complete 🏁",
  REJECTED: "Reject",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function OrderCard({ o, onMove }: { o: Order; onMove: (id: string, status: string) => void }) {
  const [open, setOpen] = useState(o.status === "NEW");
  const meta = STATUS_META[o.status] ?? STATUS_META.NEW;
  const nexts = FLOW[o.status] ?? [];
  return (
    <div
      className={`mise-feel rounded-2xl border border-line bg-paper p-4 transition ${
        o.status === "NEW" ? "mise-moved-glow" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left"
      >
        <span className="font-mono text-sm font-bold text-fg">{o.code}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.tone}`}>
          {meta.emoji} {meta.label}
        </span>
        <span className="text-sm text-fg">{o.customer_name}</span>
        <span className="rounded-full bg-line/30 px-2 py-0.5 text-[10px] font-medium text-fg-soft">
          {o.fulfilment === "DELIVERY" ? "🛵 delivery" : "🥡 pickup"}
        </span>
        <span className="ml-auto font-mono text-sm font-bold text-fg">£{o.total}</span>
        <span className="text-[11px] text-fg-faint">{timeAgo(o.created_at)}</span>
      </button>
      {open && (
        <div className="mise-cadence-in mt-3 border-t border-line pt-3">
          <ul className="space-y-1">
            {o.items.map((l, i) => (
              <li key={i} className="flex items-baseline gap-2 text-sm">
                <span className="font-mono text-fg-soft">{l.quantity}×</span>
                <span className="text-fg">{l.name}</span>
                <span className="mx-1 flex-1 border-b border-dotted border-line" aria-hidden />
                <span className="font-mono text-fg-soft">£{l.line_total}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 grid gap-1 text-xs text-fg-faint sm:grid-cols-2">
            <p>📞 {o.phone}</p>
            {o.address_text && (
              <p>
                📍 {o.address_text}
                {o.address_lat && o.address_lng && (
                  <a
                    href={`https://maps.google.com/?q=${o.address_lat},${o.address_lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1.5 font-semibold text-brand-400 underline-offset-2 hover:underline"
                  >
                    open map ↗
                  </a>
                )}
              </p>
            )}
            {o.note && <p className="sm:col-span-2">📝 “{o.note}”</p>}
          </div>
          {nexts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {nexts.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onMove(o.id, s)}
                  className={`mise-press rounded-lg px-3.5 py-2 text-xs font-semibold ${
                    s === "REJECTED"
                      ? "border border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                      : "bg-brand-600 text-white hover:bg-brand-700"
                  }`}
                >
                  {ADVANCE_LABEL[s] ?? s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── menu manager ── */
function MenuTab() {
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("Mains");
  const [emoji, setEmoji] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState<number | null>(null);

  const load = useCallback(() => {
    api.get<MenuItem[]>("/ordering/menu").then(setMenu).catch(() => setMenu([]));
  }, []);
  useEffect(load, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/ordering/menu", {
        name, price, category: category || "Mains",
        emoji: emoji || undefined, description: desc || undefined,
      });
      setName(""); setPrice(""); setEmoji(""); setDesc("");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function importRecipes() {
    setBusy(true);
    try {
      const created = await api.post<MenuItem[]>("/ordering/menu/import-recipes", {});
      setImported(created.length);
      load();
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const g = new Map<string, MenuItem[]>();
    for (const m of menu ?? []) {
      g.set(m.category, [...(g.get(m.category) ?? []), m]);
    }
    return [...g.entries()];
  }, [menu]);

  const inputCls = "mise-well rounded-lg px-3 py-2 text-sm text-fg outline-none";

  return (
    <div className="space-y-5">
      <Card className="mise-feel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-fg">Add to the menu</h3>
          <button
            type="button"
            onClick={importRecipes}
            disabled={busy}
            className="mise-raised mise-press rounded-lg px-3 py-1.5 text-xs font-medium text-fg-soft disabled:opacity-60"
          >
            🍲 Import priced recipes
          </button>
        </div>
        {imported !== null && (
          <p className="mise-tick-in mt-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500">
            {imported === 0
              ? "Nothing new to import — every priced recipe is already on the menu."
              : `${imported} dish${imported === 1 ? "" : "es"} joined the menu ✓`}
          </p>
        )}
        <form onSubmit={add} className="mt-3 grid gap-2 sm:grid-cols-[44px_1fr_90px_130px_auto]">
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🍛" aria-label="Emoji" className={`${inputCls} text-center`} />
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Dish name" aria-label="Dish name" className={inputCls} />
          <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} required inputMode="decimal" placeholder="£" aria-label="Price" className={inputCls} />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" aria-label="Category" className={inputCls} />
          <button type="submit" disabled={busy} className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
            Add
          </button>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Short description the customer sees (optional)" aria-label="Description" className={`${inputCls} sm:col-span-5`} />
        </form>
      </Card>

      {menu === null ? (
        <div className="mise-shimmer h-40 rounded-2xl border border-line bg-paper" />
      ) : menu.length === 0 ? (
        <Card className="mise-feel text-center">
          <p className="text-3xl" aria-hidden>🍽️</p>
          <p className="mt-2 font-semibold text-fg">Your public menu is empty</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-fg-faint">
            Add dishes above, or import every priced recipe in one click — customers
            only ever see what&apos;s switched ON.
          </p>
        </Card>
      ) : (
        grouped.map(([cat, items]) => (
          <Card key={cat} className="mise-feel">
            <h3 className="font-semibold text-fg">{cat}</h3>
            <div className="mt-2 divide-y divide-line">
              {items.map((m) => (
                <MenuRow key={m.id} m={m} onChanged={load} />
              ))}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

function MenuRow({ m, onChanged }: { m: MenuItem; onChanged: () => void }) {
  const [price, setPrice] = useState(m.price);
  const [avail, setAvail] = useState(m.is_available);

  async function save(patch: Record<string, unknown>) {
    await api.patch(`/ordering/menu/${m.id}`, patch).catch(() => {});
    onChanged();
  }

  return (
    <div className="flex flex-wrap items-center gap-3 py-2.5">
      <span className="text-lg" aria-hidden>{m.emoji || "🍽️"}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${avail ? "text-fg" : "text-fg-faint line-through"}`}>
          {m.name} {m.recipe_id && <span title="Linked to a costed recipe">🧾</span>}
        </p>
        {m.description && <p className="truncate text-xs text-fg-faint">{m.description}</p>}
      </div>
      <span className="flex items-center gap-1 font-mono text-sm text-fg-soft">
        £
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
          onBlur={() => price !== m.price && price && save({ price })}
          aria-label={`Price of ${m.name}`}
          className="mise-well w-20 rounded-md px-2 py-1 text-right text-sm text-fg outline-none"
        />
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={avail}
        aria-label={`${m.name} available`}
        onClick={() => { setAvail(!avail); save({ is_available: !avail }); }}
        className={`mise-press relative h-6 w-11 shrink-0 rounded-full transition-colors ${avail ? "bg-brand-500" : "mise-well bg-line/60"}`}
      >
        <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${avail ? "translate-x-[22px]" : "translate-x-0.5"}`} />
      </button>
      <button
        type="button"
        onDoubleClick={async () => { await api.delete(`/ordering/menu/${m.id}`).catch(() => {}); onChanged(); }}
        title="Double-click to remove from the menu forever"
        className="mise-press rounded-md px-1.5 text-fg-faint hover:text-rose-400"
      >
        ✕
      </button>
    </div>
  );
}

/* ── the new-order chime: two bright notes from a bare oscillator (no audio
      file needed). The AudioContext is created on the toggle CLICK — browsers
      only allow sound after a user gesture. ── */
const audioRef: { ctx: AudioContext | null } = { ctx: null };
function chime() {
  const ctx = audioRef.ctx;
  if (!ctx) return;
  [0, 0.18].forEach((delay, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = i === 0 ? 880 : 1320; // A5 → E6, a cheerful "ding-ding"
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + 0.55);
  });
}

/* ── the page ── */
export default function OrdersPage() {
  const { hotel } = useAuth();
  const [tab, setTab] = useState<"board" | "menu">("board");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [vitals, setVitals] = useState<Vitals | null>(null);
  const [copied, setCopied] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [prep, setPrep] = useState("20");
  const [paused, setPaused] = useState(false);
  const timer = useRef<number | null>(null);
  const knownIds = useRef<Set<string> | null>(null);
  const soundRef = useRef(false);
  useEffect(() => { soundRef.current = soundOn; }, [soundOn]);

  useEffect(() => {
    api
      .get<{ prep_minutes: number; ordering_paused: boolean }>("/ordering/settings")
      .then((s) => { setPrep(String(s.prep_minutes)); setPaused(s.ordering_paused); })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    api
      .get<{ orders: Order[]; vitals: Vitals }>("/ordering/orders")
      .then((r) => {
        // ring the bell for orders we've never seen before (not the first load)
        if (knownIds.current) {
          const fresh = r.orders.filter(
            (o) => o.status === "NEW" && !knownIds.current!.has(o.id),
          );
          if (fresh.length > 0) {
            if (soundRef.current) chime();
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification(`🛎️ New order ${fresh[0].code}`, {
                body: `${fresh[0].customer_name} · £${fresh[0].total}`,
              });
            }
          }
        }
        knownIds.current = new Set(r.orders.map((o) => o.id));
        setOrders(r.orders);
        setVitals(r.vitals);
      })
      .catch(() => setOrders([]));
  }, []);

  useEffect(() => {
    load();
    timer.current = window.setInterval(load, 8000); // the board breathes on its own
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [load]);

  async function move(id: string, status: string) {
    // optimistic: the card jumps immediately, the poll settles the truth
    setOrders((prev) => prev?.map((o) => (o.id === id ? { ...o, status } : o)) ?? null);
    await api.patch(`/ordering/orders/${id}`, { status }).catch(() => {});
    load();
  }

  const shareUrl = hotel ? `https://milagurestaurant.com/order/${hotel.id}` : "";
  const live = (orders ?? []).filter((o) => FLOW[o.status]);
  const done = (orders ?? []).filter((o) => !FLOW[o.status]);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Online Orders"
        subtitle="Your public menu, and every order the moment it lands."
      />

      {/* vitals */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        {[
          { label: "live now", value: vitals?.live ?? "—", hot: (vitals?.live ?? 0) > 0 },
          { label: "orders today", value: vitals?.today_orders ?? "—" },
          { label: "revenue today", value: vitals ? `£${vitals.today_revenue}` : "—" },
        ].map((v) => (
          <div key={v.label} className={`mise-well rounded-2xl p-4 text-center ${v.hot ? "mise-low-pulse" : ""}`}>
            <p className="font-mono text-2xl font-bold text-fg">{v.value}</p>
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-fg-faint">{v.label}</p>
          </div>
        ))}
      </div>

      {/* share link */}
      <Card className="mise-feel mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xl" aria-hidden>🔗</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">Your ordering page</p>
            <p className="truncate font-mono text-xs text-fg-faint">{shareUrl}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(shareUrl).catch(() => {});
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
            className="mise-raised mise-press rounded-lg px-3.5 py-2 text-xs font-semibold text-fg-soft"
          >
            {copied ? "Copied ✓" : "Copy link"}
          </button>
          <a
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            className="mise-press rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-700"
          >
            Open ↗
          </a>
        </div>
        <p className="mt-2 text-xs text-fg-faint">
          Share it on Instagram, WhatsApp status, your window sticker — customers order
          straight from the browser, no app install.
        </p>
        {/* kitchen switches: prep estimate · busy pause · new-order sound */}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3">
          <label className="flex items-center gap-2 text-xs text-fg-soft">
            ⏱️ Ready in ~
            <input
              value={prep}
              onChange={(e) => setPrep(e.target.value.replace(/\D/g, "").slice(0, 3))}
              onBlur={() => {
                const v = Math.min(180, Math.max(5, parseInt(prep || "20", 10)));
                setPrep(String(v));
                api.patch("/ordering/settings", { prep_minutes: v }).catch(() => {});
              }}
              aria-label="Prep minutes"
              className="mise-well w-14 rounded-md px-2 py-1 text-center text-xs text-fg outline-none"
            />
            min <span className="text-fg-faint">(customers see this)</span>
          </label>
          <button
            type="button"
            onClick={() => {
              const next = !paused;
              setPaused(next);
              api.patch("/ordering/settings", { ordering_paused: next }).catch(() => setPaused(!next));
            }}
            className={`mise-press rounded-lg px-3 py-1.5 text-xs font-semibold ${
              paused
                ? "bg-amber-500/15 text-amber-500"
                : "mise-raised text-fg-soft"
            }`}
          >
            {paused ? "⏸️ Paused — tap to reopen" : "▶️ Taking orders — tap to pause"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!soundOn) {
                type AC = typeof AudioContext;
                const Ctx: AC =
                  window.AudioContext ??
                  (window as unknown as { webkitAudioContext: AC }).webkitAudioContext;
                audioRef.ctx = audioRef.ctx ?? new Ctx();
                audioRef.ctx.resume().catch(() => {});
                chime(); // audible confirmation the bell works
                if (typeof Notification !== "undefined" && Notification.permission === "default") {
                  Notification.requestPermission().catch(() => {});
                }
              }
              setSoundOn((v) => !v);
            }}
            className={`mise-press rounded-lg px-3 py-1.5 text-xs font-semibold ${
              soundOn ? "bg-brand-500/15 text-brand-400" : "mise-raised text-fg-soft"
            }`}
          >
            {soundOn ? "🔔 Bell on" : "🔕 Bell off — tap to arm"}
          </button>
        </div>
      </Card>

      {/* tabs */}
      <div className="mise-well mb-5 flex gap-1.5 rounded-xl p-1.5">
        {(
          [
            ["board", `🔥 Live board${vitals?.live ? ` · ${vitals.live}` : ""}`],
            ["menu", "🍽️ Menu"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`mise-press flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === key ? "mise-raised text-fg" : "text-fg-faint"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "menu" ? (
        <MenuTab />
      ) : orders === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="mise-shimmer h-20 rounded-2xl border border-line bg-paper" />
          ))}
        </div>
      ) : live.length === 0 && done.length === 0 ? (
        <Card className="mise-feel text-center">
          <p className="text-3xl" aria-hidden>🛵</p>
          <p className="mt-2 font-semibold text-fg">No orders yet — but the door is open</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-fg-faint">
            Build your menu, share your ordering link, and this board lights up the
            second the first order lands.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {live.map((o) => (
            <OrderCard key={o.id} o={o} onMove={move} />
          ))}
          {done.length > 0 && (
            <details className="pt-2">
              <summary className="cursor-pointer text-sm text-fg-faint">
                Finished today ({done.length})
              </summary>
              <div className="mt-3 space-y-3 opacity-75">
                {done.slice(0, 30).map((o) => (
                  <OrderCard key={o.id} o={o} onMove={move} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
