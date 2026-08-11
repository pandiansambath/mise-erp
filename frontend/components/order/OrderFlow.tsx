"use client";

// Purchasing, built to his description. Three layers and a basket:
//
//   categories  ->  tap one, its items open as a POPUP (closable)
//                   ->  tap an item, a POPUP ON TOP of that one
//                       ->  choose how many, and in WHICH size
//                           ->  "Add to basket" BURSTS the popup into a bubble
//                               that shrinks across the screen into the basket
//   basket      ->  tap it any time: the list, the detail, the total
//
// Two things this gets right that the old page did not.
//
// NOTHING SCROLLS TO PICK. Categories fit; a category's items fit; the item
// popup is one card. "i should not feel the scroll... picking will be a fun."
//
// THE PRICE IS TOLD PROPERLY. A supplier quoting £30 for a bottle of thirty
// means a piece costs £1, and every surface here says both. Printing "£30 per
// piece" is wrong by a factor of thirty, and it is the number somebody uses to
// decide whether they can afford the order.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Item, SupplierOption } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { categoryEmoji, fmtQty, stockState } from "@/components/ItemPicker";
import { AnimatedNumber } from "@/components/fx";
import { levelName, orderSizes, priceLines, pricePerBase, tidy } from "@/lib/packs";
import { BASKET_PANEL_ID, burstToBasket } from "@/components/order/burst";
import ClickSpark from "@/components/reactbits/ClickSpark";
import GlareHover from "@/components/reactbits/GlareHover";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import Magnet from "@/components/reactbits/Magnet";

export type OrderLine = { item_id: string; qty: string };

const OTHER = "Other";
const groupOf = (it: Item) => it.category?.trim() || OTHER;

/** A popup. Escape closes, the backdrop closes, and it traps nothing it should
 *  not — these stack, so each one only ever closes itself. */
function Sheet({
  onClose,
  title,
  subtitle,
  depth = 1,
  panelId,
  children,
  footer,
}: {
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** 1 = over the page, 2 = over another sheet. Only the depth changes. */
  depth?: 1 | 2;
  /** So anything on the page can find this panel and animate it. */
  panelId?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const z = depth === 1 ? "z-[70]" : "z-[80]";
  // Centred, both axes, at every size. It used to be pinned to the top with
  // side insets, so it sat high and off-centre — "this popup is not centred".
  // No -translate-x-1/2 here: .mise-pop-centre carries the centring inside its
  // keyframes, because an animation's transform replaces the class's.
  const box =
    depth === 1
      ? "left-1/2 top-1/2 w-[min(64rem,94vw)]"
      : "left-1/2 top-1/2 w-[min(26rem,92vw)]";

  return (
    <>
      <div
        className={`mise-fade fixed inset-0 ${z} bg-black/50 backdrop-blur-sm`}
        onClick={onClose}
        aria-hidden
      />
      <div
        id={panelId}
        role="dialog"
        aria-label={title}
        className={`mise-pop-centre mise-sheet-sheen fixed ${box} ${z} flex max-h-[86dvh] flex-col overflow-hidden rounded-3xl border border-line bg-paper shadow-2xl`}
      >
        <div className="relative flex shrink-0 items-start justify-between gap-3 border-b border-line bg-gradient-to-b from-brand-500/10 to-transparent px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold text-fg">{title}</p>
            {subtitle && <p className="truncate text-xs text-fg-faint">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mise-press grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-2 text-fg-soft transition hover:border-brand-400/50"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-line p-3">{footer}</div>}
      </div>
    </>
  );
}

/** How much, and in which size. The whole point of the second popup. */
function ItemSheet({
  item,
  supplier,
  existing,
  onClose,
  onAdd,
}: {
  item: Item;
  supplier?: SupplierOption;
  existing?: string;
  onClose: () => void;
  onAdd: (baseQty: string, from: HTMLElement | null) => void;
}) {
  const { format } = useCurrency();
  const sizes = orderSizes(item);
  // Default to the size the supplier actually sells in — that is how you think
  // about buying it, and it is one fewer decision.
  const [sizeId, setSizeId] = useState<string | null>(supplier?.pack_level_id ?? null);
  const size = sizes.find((s) => s.id === sizeId)?.base ?? 1;
  const [n, setN] = useState(existing ? tidy((parseFloat(existing) || 0) / size) : "1");
  const card = useRef<HTMLDivElement>(null);

  const count = parseFloat(n || "0") || 0;
  const baseQty = count * size;
  const each = pricePerBase(item, supplier);
  const total = baseQty * each;

  return (
    <Sheet
      depth={2}
      onClose={onClose}
      title={item.name}
      subtitle={`${fmtQty(item.current_stock, item.unit)} in stock`}
      footer={
        <Magnet padding={70} magnetStrength={7} className="block">
          <button
            type="button"
            disabled={count <= 0}
            onClick={() => onAdd(tidy(baseQty), card.current)}
            className="mise-press w-full rounded-2xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-900/30 transition hover:bg-brand-700 disabled:opacity-40"
          >
            Add to basket{total > 0 ? ` · ${format(total.toFixed(2))}` : ""}
          </button>
        </Magnet>
      }
    >
      <div ref={card} className="space-y-4">
        {/* How many, in which size. Swapping the size keeps the NUMBER and
            changes what it means, because "2" of whatever you are thinking in
            is what a person types. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setN(tidy(Math.max(0, count - 1)))}
            aria-label="One fewer"
            className="mise-press grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-line-2 text-xl text-fg-soft"
          >
            −
          </button>
          <input
            value={n}
            onChange={(e) => setN(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            aria-label={`How many, of ${item.name}`}
            className="min-w-0 flex-1 rounded-2xl border border-line-2 bg-glass/5 px-3 py-3 text-center font-display text-2xl tabular-nums text-fg outline-none focus:border-brand-500"
          />
          <button
            type="button"
            onClick={() => setN(tidy(count + 1))}
            aria-label="One more"
            className="mise-press grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-line-2 text-xl text-fg-soft"
          >
            +
          </button>
        </div>

        {sizes.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {sizes.map((s) => (
              <button
                key={s.id ?? "base"}
                type="button"
                onClick={() => setSizeId(s.id)}
                className={`mise-press rounded-xl px-3 py-2 text-sm transition ${
                  (s.id ?? null) === sizeId
                    ? "bg-brand-500 font-semibold text-white"
                    : "border border-line text-fg-soft hover:border-brand-400/50"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {sizeId && (
          <p className="text-xs text-indigo-300">
            {tidy(count)} {levelName(item, sizeId)} = {tidy(baseQty)} {item.unit}
          </p>
        )}

        {/* What it costs, in every size it comes in. */}
        <div className="rounded-2xl border border-line bg-paper-2/60 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
            {supplier ? supplier.vendor_name : "No supplier yet"}
          </p>
          {supplier ? (
            <ul className="mt-1.5 space-y-0.5">
              {priceLines(item, supplier).map((l) => (
                <li key={l.label} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-fg-soft">
                    1 {l.label}
                    {l.note && <span className="ml-1 text-[11px] text-fg-faint">({l.note})</span>}
                  </span>
                  <span className="tabular-nums text-fg">{format(l.price.toFixed(2))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-amber-300">
              Nobody prices this yet — add one on Vendors and it becomes orderable.
            </p>
          )}
        </div>

        {total > 0 && (
          <p className="text-center font-display text-3xl font-semibold tabular-nums text-fg">
            {format(total.toFixed(2))}
          </p>
        )}
      </div>
    </Sheet>
  );
}

export function OrderFlow({
  items,
  suppliers,
  lines,
  onChange,
  onAddAllLow,
  footer,
}: {
  items: Item[];
  suppliers: Record<string, SupplierOption[]>;
  lines: OrderLine[];
  onChange: (next: OrderLine[]) => void;
  onAddAllLow?: () => void;
  footer?: React.ReactNode;
}) {
  const { format } = useCurrency();
  const [cat, setCat] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<Item | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);
  const [bump, setBump] = useState(false);

  // Where the basket has been dragged to, if anywhere. Remembered per browser,
  // because somewhere that suits your screen is not somewhere we can guess.
  const basketRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mise.basket.pos");
      if (raw) setPos(JSON.parse(raw));
    } catch {
      /* a basket in the default corner is fine */
    }
  }, []);

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const el = basketRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const offX = e.clientX - box.left;
    const offY = e.clientY - box.top;
    draggedRef.current = false;

    const move = (ev: PointerEvent) => {
      // A few pixels of slop, so a slightly shaky tap still opens the basket
      // rather than nudging it across the screen.
      if (
        !draggedRef.current &&
        Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5
      )
        return;
      draggedRef.current = true;
      const x = Math.min(Math.max(0, ev.clientX - offX), window.innerWidth - box.width);
      const y = Math.min(Math.max(0, ev.clientY - offY), window.innerHeight - box.height);
      setPos({ x, y });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (draggedRef.current) {
        try {
          const b = basketRef.current?.getBoundingClientRect();
          if (b) localStorage.setItem("mise.basket.pos", JSON.stringify({ x: b.left, y: b.top }));
        } catch {
          /* not worth failing a drag over */
        }
      }
      // Let the click that follows this pointerup see the flag, then clear it.
      window.setTimeout(() => (draggedRef.current = false), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const picked = useMemo(() => new Set(lines.map((l) => l.item_id)), [lines]);

  const supplierFor = useCallback(
    (id: string): SupplierOption | undefined => {
      const opts = suppliers[id] ?? [];
      if (!opts.length) return undefined;
      return (
        opts.find((v) => v.is_preferred) ??
        [...opts].sort(
          (a, b) => (parseFloat(a.price_per_unit) || 0) - (parseFloat(b.price_per_unit) || 0),
        )[0]
      );
    },
    [suppliers],
  );

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(groupOf(it), (m.get(groupOf(it)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) =>
      a[0] === OTHER ? 1 : b[0] === OTHER ? -1 : a[0].localeCompare(b[0]),
    );
  }, [items]);

  const low = useMemo(
    () =>
      items.filter((i) => {
        const l = stockState(i).label;
        return l === "running low" || l === "out of stock";
      }),
    [items],
  );

  const total = useMemo(
    () =>
      lines.reduce((t, l) => {
        const it = byId.get(l.item_id);
        if (!it) return t;
        return t + (parseFloat(l.qty) || 0) * pricePerBase(it, supplierFor(l.item_id));
      }, 0),
    [lines, byId, supplierFor],
  );

  /** Add, then burst the popup into the basket and let the basket react as it
   *  LANDS rather than on the click. */
  const add = async (item: Item, baseQty: string, from: HTMLElement | null) => {
    const next = picked.has(item.id)
      ? lines.map((l) => (l.item_id === item.id ? { ...l, qty: baseQty } : l))
      : [...lines, { item_id: item.id, qty: baseQty }];
    onChange(next);
    setOpenItem(null);
    // Adding from the basket should not throw a bubble at the basket you are
    // already looking at — it would fly to something behind the sheet.
    if (basketOpen) {
      setBump(true);
      window.setTimeout(() => setBump(false), 420);
      return;
    }
    await burstToBasket(from, "mise-basket", item.name);
    setBump(true);
    window.setTimeout(() => setBump(false), 420);
  };

  const shown = cat ? items.filter((i) => groupOf(i) === cat) : [];

  return (
    <div className="min-w-0">
      {low.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/35 bg-amber-400/[0.07] px-3.5 py-2.5">
          <span aria-hidden className="text-lg">⚠</span>
          <span className="min-w-0 flex-1 text-sm text-fg">
            <b className="text-amber-300">{low.length}</b> item
            {low.length === 1 ? " is" : "s are"} at or below minimum
          </span>
          {onAddAllLow && (
            <button
              type="button"
              onClick={onAddAllLow}
              className="mise-press shrink-0 rounded-xl bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/25"
            >
              Add them all
            </button>
          )}
        </div>
      )}

      {/* Layer one: the categories. Nothing else on screen. */}
      <ClickSpark sparkColor="#34d399" sparkCount={8} sparkRadius={16} duration={380}>
        <div className="mise-stagger grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {cats.map(([name, n]) => (
            <GlareHover
              key={name}
              width="100%"
              height="auto"
              background="transparent"
              borderColor="transparent"
              borderRadius="1rem"
              glareColor="#ffffff"
              glareOpacity={0.16}
              glareSize={220}
              transitionDuration={600}
              className="!block"
            >
              <button
                type="button"
                onClick={() => setCat(name)}
                className="mise-card3d mise-press flex w-full items-center gap-3 px-3.5 py-4 text-left"
              >
                <span aria-hidden className="text-2xl">{categoryEmoji(name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm font-semibold text-fg">
                    {name}
                  </span>
                  <span className="block text-[11px] text-fg-faint">{n} items</span>
                </span>
              </button>
            </GlareHover>
          ))}
        </div>
      </ClickSpark>

      {/* Layer two: that category's items. */}
      {cat && (
        <Sheet onClose={() => setCat(null)} title={cat} subtitle={`${shown.length} items`}>
          <ClickSpark sparkColor="#34d399" sparkCount={8} sparkRadius={16} duration={380}>
            <div className="mise-sheet-cascade grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((it, i) => {
                const sup = supplierFor(it.id);
                const on = picked.has(it.id);
                const st = stockState(it);
                return (
                  <SpotlightCard
                    key={it.id}
                    // The ramp caps so the fortieth card is not still waiting a
                    // second later — a cascade that outlasts your patience is
                    // just a slow screen.
                    style={{ "--i": Math.min(i, 14) } as React.CSSProperties}
                    className="!rounded-2xl !border-0 !bg-transparent !p-0"
                    spotlightColor="rgba(52, 211, 153, 0.14)"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenItem(it)}
                      className={`mise-card3d mise-press relative flex w-full flex-col items-start gap-1 p-3 text-left ${
                        on ? "!bg-brand-400/15 ring-2 ring-brand-500" : ""
                      }`}
                    >
                      <span className="flex w-full items-start justify-between gap-2">
                        <span aria-hidden className="text-2xl">{categoryEmoji(groupOf(it))}</span>
                        {/* Stock as a dot + word, top right, so the card is
                            scannable before it is read. */}
                        <span className={`flex items-center gap-1 text-[10px] ${st.cls}`}>
                          {st.dot}
                          {st.label}
                        </span>
                      </span>
                      <span className="line-clamp-2 text-sm font-semibold leading-snug text-fg">
                        {it.name}
                      </span>
                      {/* The dead space in the middle of these cards was doing
                          nothing — "every place is information, every click is
                          a feature". It now carries what you need to decide
                          WITHOUT opening it: what you have, what one costs, and
                          what a pack costs when it comes in packs. */}
                      <span className="mt-auto w-full space-y-0.5 pt-1.5 text-[11px]">
                        <span className="flex justify-between gap-2 text-fg-soft">
                          <span className="text-fg-faint">have</span>
                          <span className="tabular-nums">{fmtQty(it.current_stock, it.unit)}</span>
                        </span>
                        {sup ? (
                          priceLines(it, sup).map((l) => (
                            <span key={l.label} className="flex justify-between gap-2 text-fg-soft">
                              <span className="truncate text-fg-faint">1 {l.label}</span>
                              <span className="shrink-0 tabular-nums">
                                {format(l.price.toFixed(2))}
                              </span>
                            </span>
                          ))
                        ) : (
                          <span className="block text-amber-300">no supplier yet</span>
                        )}
                        {sup && (
                          <span className="block truncate pt-0.5 text-[10px] text-fg-faint">
                            {sup.vendor_name}
                          </span>
                        )}
                      </span>
                      {on && (
                        <span
                          aria-hidden
                          className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-[11px] leading-none text-white"
                        >
                          ✓
                        </span>
                      )}
                    </button>
                  </SpotlightCard>
                );
              })}
            </div>
          </ClickSpark>
        </Sheet>
      )}

      {/* Layer three: how many, and in which size. */}
      {openItem && (
        <ItemSheet
          item={openItem}
          supplier={supplierFor(openItem.id)}
          existing={lines.find((l) => l.item_id === openItem.id)?.qty}
          onClose={() => setOpenItem(null)}
          onAdd={(q, from) => add(openItem, q, from)}
        />
      )}

      {/* The basket. Always there so the bubble has somewhere to land, and so
          the count has somewhere to appear. */}
      {/* The basket lives ABOVE the sheets (z-[90]), because it was hiding
          behind the very popup you add things from — "that basket is behind
          this popup, make that basket to be viewable by user in this area
          itself in corner that he can open basket anytime".
          And it DRAGS: "make that basket draggable like user can drag and
          place anywhere in screen". Where it sits is remembered. */}
      <button
        id="mise-basket"
        type="button"
        ref={basketRef}
        onPointerDown={startDrag}
        onClick={() => {
          if (draggedRef.current) return; // a drag is not a click
          setBasketOpen(true);
        }}
        disabled={lines.length === 0}
        aria-label={`Basket — ${lines.length} items`}
        style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
        className={`mise-press fixed bottom-24 right-4 z-[90] flex touch-none items-center gap-2.5 rounded-2xl border border-brand-400/45 bg-paper-2/95 px-3.5 py-2.5 shadow-xl shadow-black/40 backdrop-blur transition-[opacity,transform] duration-300 sm:right-6 lg:bottom-8 ${
          lines.length === 0
            ? "pointer-events-none translate-y-3 scale-90 opacity-0"
            : "translate-y-0 scale-100 opacity-100"
        } ${bump ? "mise-pocket-bump ring-2 ring-brand-400" : ""}`}
      >
        <span aria-hidden className="relative text-xl leading-none">
          🧺
          <span className="absolute -right-2 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold tabular-nums text-white">
            {lines.length}
          </span>
        </span>
        <span className="text-left">
          <span className="block text-[11px] text-fg-faint">Basket</span>
          <AnimatedNumber
            value={total}
            from="previous"
            duration={520}
            format={(x) => format(x.toFixed(2))}
            className="block font-display text-sm font-semibold tabular-nums text-fg"
          />
        </span>
      </button>

      {basketOpen && (
        <BasketSheet
          lines={lines}
          byId={byId}
          supplierFor={supplierFor}
          onChange={onChange}
          onClose={() => setBasketOpen(false)}
          // Editing opens the quantity popup ON TOP of the basket, so you come
          // back to the basket when you are done rather than to the page.
          onEdit={(it) => setOpenItem(it)}
          footer={footer}
        />
      )}
    </div>
  );
}

/** Everything in the basket, grouped by who it is going to, with the unit
 *  detail spelled out — "1 bottle £30.00 (30 piece)" — because that is what he
 *  asked for and because it is the only way the total is checkable. */
function BasketSheet({
  lines,
  byId,
  supplierFor,
  onChange,
  onClose,
  onEdit,
  footer,
}: {
  lines: OrderLine[];
  byId: Map<string, Item>;
  supplierFor: (id: string) => SupplierOption | undefined;
  onChange: (next: OrderLine[]) => void;
  onClose: () => void;
  /** Reopen the quantity popup for this line. */
  onEdit: (it: Item) => void;
  footer?: React.ReactNode;
}) {
  const { format } = useCurrency();

  // "once user clicks submit indent button, burst that popup — entire popup you
  // need to burst like a yell — and back to original screen." The page fires
  // the burst; when it has finished it says so, and the basket steps aside.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const go = () => closeRef.current();
    window.addEventListener("mise:close-basket", go);
    return () => window.removeEventListener("mise:close-basket", go);
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; rows: { it: Item; qty: string }[]; total: number }>();
    for (const l of lines) {
      const it = byId.get(l.item_id);
      if (!it) continue;
      const sup = supplierFor(l.item_id);
      const key = sup?.vendor_id ?? "none";
      const g = m.get(key) ?? { name: sup?.vendor_name ?? "No supplier yet", rows: [], total: 0 };
      g.rows.push({ it, qty: l.qty });
      g.total += (parseFloat(l.qty) || 0) * pricePerBase(it, sup);
      m.set(key, g);
    }
    return [...m.values()];
  }, [lines, byId, supplierFor]);

  const grand = groups.reduce((t, g) => t + g.total, 0);

  return (
    <Sheet
      onClose={onClose}
      title="Your basket"
      panelId={BASKET_PANEL_ID}
      subtitle={`${lines.length} item${lines.length === 1 ? "" : "s"} · ${groups.length} supplier${
        groups.length === 1 ? "" : "s"
      }`}
      footer={
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-display text-2xl font-semibold tabular-nums text-fg">
              {format(grand.toFixed(2))}
            </span>
            <span className="text-[11px] text-fg-faint">
              priced at your chosen supplier, or the cheapest where none is set
            </span>
          </div>
          {footer}
        </div>
      }
    >
      <div className="mise-sheet-cascade space-y-3">
        {groups.map((g, gi) => (
          <div key={g.name} style={{ "--i": gi } as React.CSSProperties} className="rounded-2xl border border-line bg-paper-2/60 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold text-fg">{g.name}</span>
              <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-fg-soft">
                {format(g.total.toFixed(2))}
              </span>
            </div>
            <ul className="mt-2 space-y-2">
              {g.rows.map(({ it, qty }) => {
                const sup = supplierFor(it.id);
                const n = parseFloat(qty) || 0;
                return (
                  <li key={it.id} className="rounded-xl border border-line bg-paper/70 p-2.5">
                    <div className="flex items-center gap-2">
                      <span aria-hidden>{categoryEmoji(groupOf(it))}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">{it.name}</span>
                      <span className="shrink-0 tabular-nums text-sm text-fg-soft">
                        {tidy(n)} {it.unit}
                      </span>
                      {/* "have a button like edit — if i click that edit i need
                          to see that previous popup here as small popup to edit
                          things". The same quantity popup, reopened on top. */}
                      <button
                        type="button"
                        onClick={() => onEdit(it)}
                        aria-label={`Change how much ${it.name}`}
                        className="mise-press shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-fg-soft transition hover:border-brand-400/50 hover:text-brand-300"
                      >
                        edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onChange(lines.filter((l) => l.item_id !== it.id))}
                        aria-label={`Remove ${it.name}`}
                        className="mise-press shrink-0 rounded-lg px-1.5 py-1 text-fg-faint hover:text-rose-300"
                      >
                        ✕
                      </button>
                    </div>
                    {sup && (
                      <p className="mt-1 text-[11px] text-fg-faint">
                        {priceLines(it, sup)
                          .map(
                            (l) =>
                              `1 ${l.label} ${format(l.price.toFixed(2))}${l.note ? ` (${l.note})` : ""}`,
                          )
                          .join("  ·  ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
