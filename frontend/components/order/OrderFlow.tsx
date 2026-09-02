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
import { levelName, orderSizes, priceLines, pricePerBase, stockInPacks, tidy } from "@/lib/packs";
import { BASKET_PANEL_ID, burstToBasket } from "@/components/order/burst";
import ClickSpark from "@/components/reactbits/ClickSpark";
import GlareHover from "@/components/reactbits/GlareHover";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import Magnet from "@/components/reactbits/Magnet";
import { SheetPopup as Sheet } from "@/components/SheetPopup";
import { useConfirm } from "@/components/confirm";

export type OrderLine = {
  item_id: string;
  qty: string;
  /** An EXPLICIT supplier for this line — pinned in the popup or chosen in the
   *  basket. Undefined means "let the server decide", which is what every line
   *  meant before and what most still mean. */
  vendor_id?: string;
  /** Which of that supplier's forms. Only meaningful with vendor_id. */
  pack_level_id?: string;
};

/** What makes two basket lines the SAME line.
 *
 *   "what if I choose 1 item now it's in basket, and I'm choosing same item but
 *    different vendor — basket needs to allow, treat as different item. Basket
 *    is now overriding and showing... both item names are same, also the vendor
 *    is different nah."
 *
 * Right: a kilo from one supplier and a kilo from another are two purchases,
 * not one, and they end up on two different purchase orders. Keying on the item
 * alone made the second choice silently replace the first. Two lines with no
 * explicit supplier are still one line — that is the ordinary case and it
 * should go on merging.
 */
export function lineKey(l: OrderLine): string {
  return `${l.item_id}|${l.vendor_id ?? ""}|${l.pack_level_id ?? ""}`;
}

/** Kill floating-point dust: 0.30000000000000004 is not a quantity anyone
 *  typed, and it becomes a penny somewhere downstream. */
function exact(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** A number as a person would write it — no trailing zeros, no 1E+3. */
function show(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 1e6) / 1e6);
}

/** The stripe MEANS something.
 *
 *  "also the colour in corner of cards, you randomly gave I guess — please have
 *   a meaning for that, don't give colour randomly."
 *
 *  Correct, and a fair thing to catch: it was a hash of the category name, so
 *  the colours were stable but arbitrary, and a colour that carries no
 *  information is just noise pretending to be design.
 *
 *  Now it says what KIND of thing this is — the distinction a kitchen actually
 *  makes, because it decides where a delivery goes and how fast it has to be
 *  used: fresh, chilled, dry store, or not food at all. Anything unrecognised
 *  gets the neutral tone rather than a colour invented for it.
 */
// WORDS, NOT REGEXES.
//
// The regex version shipped broken and every category on his screen read
// "other". The cause was invisible: this file held a real BACKSPACE byte
// (U+0008) where a word-boundary escape was intended, so every pattern
// demanded a control character before the word and matched nothing. It
// survived review because a backspace renders as nothing — the line looked
// exactly right in the editor, in grep, and in a diff.
//
// Plain token matching cannot carry that bug: there is no escape sequence to
// get wrong, and the rules read as what they are, the words a kitchen uses.
//
// ORDER MATTERS. Frozen is checked first because it is the most specific
// signal there is (frozen peas are frozen, not produce; ice cream is frozen,
// not dairy), and dry store is checked before anything that could read the
// "ice" inside "rice".
/** One neutral edge for every card.
 *
 *  "the colour you gave for each card is not nice — actually I loved the
 *   previous version we had, only grey kinda colour for all category cards,
 *   which resembles shadow."
 *
 *  Fair, and it does not cost the meaning: the KIND is written on the tile in
 *  words, which is the part that can be read and checked. A colour per category
 *  was a second, weaker way of saying the same thing, and it turned a calm grid
 *  into a paint chart.
 */
const NEUTRAL = "bg-fg-faint/35";

const CATEGORY_KIND: { words: string[]; tint: string; kind: string }[] = [
  { words: ["frozen", "freezer", "ice cream", "ice-cream"], tint: NEUTRAL, kind: "frozen" },
  { words: ["veg", "fruit", "herb", "salad", "greens", "produce"], tint: NEUTRAL, kind: "fresh produce" },
  { words: ["meat", "poultry", "fish", "seafood", "chicken", "mutton", "lamb", "beef", "pork", "prawn"], tint: NEUTRAL, kind: "fresh, raw" },
  { words: ["dairy", "milk", "cheese", "butter", "yog", "cream", "egg", "paneer", "curd"], tint: NEUTRAL, kind: "chilled" },
  { words: ["rice", "grain", "flour", "pulse", "lentil", "dal", "spice", "masala", "oil", "sugar", "salt", "dry", "staple", "condiment", "sauce", "pickle"], tint: NEUTRAL, kind: "dry store" },
  { words: ["drink", "bever", "juice", "water", "soda", "tea", "coffee", "squash"], tint: NEUTRAL, kind: "drinks" },
  { words: ["clean", "chemical", "hygiene", "packag", "disposab", "paper", "equip", "cutlery", "utensil", "stationery"], tint: NEUTRAL, kind: "not food" },
];

function categoryKind(name: string): { tint: string; kind: string } {
  const hay = name.toLowerCase();
  const hit = CATEGORY_KIND.find((k) => k.words.some((w) => hay.includes(w)));
  return hit ? { tint: hit.tint, kind: hit.kind } : { tint: NEUTRAL, kind: "other" };
}

function categoryTint(name: string): string {
  return categoryKind(name).tint;
}

const OTHER = "Other";
const groupOf = (it: Item) => it.category?.trim() || OTHER;

/** A popup. Escape closes, the backdrop closes, and it traps nothing it should
 *  not — these stack, so each one only ever closes itself. */
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
  const sizes = orderSizes(item, supplier);

  // ── HOW MUCH is held in BASE UNITS, always. ──────────────────────────────
  //
  // It used to be held as "a number, in whatever size is selected", and that
  // quietly lost money. Editing 1 piece of a £30 bottle of thirty opened in
  // BOTTLES, wrote 1/30 into the box, rounded it to 0.033 for display, and then
  // multiplied that back — so one piece became 0.99 of a piece and £1.00 became
  // £0.99. His words, and he is right that it is the dangerous kind of bug:
  // "if we not looking at this confusion then it will pile and at the end will
  // be a big money issue."
  //
  // So the quantity is the truth and the number in the box is a VIEW of it.
  // Rounding a view cannot change what you ordered.
  const startQty = existing ? parseFloat(existing) || 0 : 0;

  // Open in the size the amount is actually a whole number of — "what we have
  // in cart is piece so auto select should be piece". Largest first, so 60
  // pieces opens as 2 bottles rather than 60. Nothing to edit yet? Then the
  // size the supplier sells in, which is how you think about buying it.
  const [sizeId, setSizeId] = useState<string | null>(() => {
    if (startQty > 0) {
      const fits = [...sizes]
        .sort((a, b) => b.base - a.base)
        .find((s) => s.base > 0 && Math.abs(startQty / s.base - Math.round(startQty / s.base)) < 1e-9);
      if (fits) return fits.id;
    }
    return supplier?.pack_level_id ?? null;
  });
  const size = sizes.find((s) => s.id === sizeId)?.base ?? 1;

  const [qty, setQty] = useState(startQty || size);
  // What is typed, kept separately so a half-finished "1." survives a keystroke.
  const [text, setText] = useState(() => show((startQty || size) / (size || 1)));
  const card = useRef<HTMLDivElement>(null);

  /** Type a count → the amount is that many of the CHOSEN size. */
  function typed(v: string) {
    const clean = v.replace(/[^\d.]/g, "");
    setText(clean);
    const c = parseFloat(clean);
    if (Number.isFinite(c)) setQty(exact(c * size));
  }

  /** Step by one of the chosen size. */
  function step(by: number) {
    const next = Math.max(0, exact(qty + by * size));
    setQty(next);
    setText(show(next / (size || 1)));
  }

  /** Change the size. The AMOUNT does not move — only how it is expressed.
   *  "when i click piece again it's showing 0.033 pounds, actually it needs to
   *  change as 1 pound right" — quite so: switching the unit is a change of
   *  wording, not a change of order. */
  function chooseSize(id: string | null) {
    const nextSize = sizes.find((x) => x.id === id)?.base ?? 1;
    setSizeId(id);
    setText(show(qty / (nextSize || 1)));
  }

  const count = qty / (size || 1);
  const baseQty = qty;
  const each = pricePerBase(item, supplier);
  const total = exact(baseQty * each);

  return (
    <Sheet
      depth={2}
      onClose={onClose}
      title={item.name}
      subtitle={
        stockInPacks(item)
          ? `${fmtQty(item.current_stock, item.unit)} in stock · ${stockInPacks(item)}`
          : `${fmtQty(item.current_stock, item.unit)} in stock`
      }
      footer={
        <Magnet padding={70} magnetStrength={7} style={{ display: "block" }}>
          <button
            type="button"
            disabled={count <= 0}
            onClick={() => onAdd(String(baseQty), card.current)}
            className="mise-btn-key mise-press w-full px-4 py-3 text-sm font-semibold disabled:opacity-40"
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
            onClick={() => step(-1)}
            aria-label="One fewer"
            className="mise-press grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-line-2 text-xl text-fg-soft"
          >
            −
          </button>
          <input
            value={text}
            onChange={(e) => typed(e.target.value)}
            inputMode="decimal"
            aria-label={`How many, of ${item.name}`}
            className="min-w-0 flex-1 rounded-2xl border border-line-2 bg-glass/5 px-3 py-3 text-center font-display text-2xl tabular-nums text-fg outline-none focus:border-brand-500"
          />
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="One more"
            className="mise-press grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-line-2 text-xl text-fg-soft"
          >
            +
          </button>
        </div>

        {/* A segmented control, not loose pills: these are alternatives to one
            another, and a shared track is what says so. */}
        {sizes.length > 1 && (
          <div className="mise-well flex flex-wrap gap-1 rounded-2xl p-1">
            {sizes.map((s) => (
              <button
                key={s.id ?? "base"}
                type="button"
                onClick={() => chooseSize(s.id)}
                className={`mise-press flex-1 rounded-xl px-3 py-2 text-sm transition ${
                  (s.id ?? null) === sizeId
                    ? "mise-btn-key font-semibold"
                    : "text-fg-soft hover:bg-glass/[0.06]"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {sizeId && (
          <p className="text-xs text-indigo-300">
            {show(count)} {levelName(item, sizeId)} = {show(baseQty)} {item.unit}
          </p>
        )}

        {/* Price list AND total in one block, so the number you came for is
            never below the fold. */}
        <div className="rounded-2xl border border-line bg-paper-2/60 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
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

          {/* The number this popup exists to produce, on the last line of the
              same block. It COUNTS to its new value rather than swapping —
              money that moves is money you notice, and noticing before you
              commit is the entire point of showing it. */}
          {total > 0 && (
            <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line/70 pt-2">
              {/* The second line only when it SAYS something. For an item with
                  no pack chain both lines are identical — "1 pack / 1 pack" —
                  which reads as a mistake rather than as detail. */}
              <span className="text-[11px] leading-tight text-fg-faint">
                {tidy(count)} {levelName(item, sizeId)}
                {count === 1 ? "" : "s"}
                {sizeId && (
                  <span className="block">
                    {tidy(baseQty)} {item.unit}
                  </span>
                )}
              </span>
              <AnimatedNumber
                value={total}
                from="previous"
                duration={420}
                format={(x) => format(x.toFixed(2))}
                className="font-display text-2xl font-semibold tabular-nums text-fg"
              />
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/** The item tiles.
 *
 * Pulled out of the category popup because there are three ways to reach a list
 * of items now — by category, by supplier, and dearest-first — and a tile that
 * looked different depending on how you arrived would make the same item read
 * as three different things.
 */
function ItemGrid({
  shown,
  supplierFor,
  picked,
  onOpen,
}: {
  shown: Item[];
  supplierFor: (id: string) => SupplierOption | undefined;
  picked: Set<string>;
  onOpen: (it: Item) => void;
}) {
  const { format } = useCurrency();
  return (
  <ClickSpark sparkColor="#34d399" sparkCount={8} sparkRadius={16} duration={380}>
    <div
      className="mise-sheet-cascade grid gap-2.5"
      /* auto-fit, not a fixed count. Four columns of 11rem cannot fit a
         390px screen, so the popup scrolled SIDEWAYS — "in mobile it's
         showing sideways, we need to scroll horizontal to see the
         items; please have a vertical way". Now the row holds as many
         as fit and wraps down, which is the direction a phone scrolls. */
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(min(9.5rem, 100%), 1fr))`,
        maxWidth: shown.length < 4 ? `${shown.length * 12}rem` : undefined,
      }}
    >
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
              data-testid="item-tile"
              onClick={() => onOpen(it)}
              className={`mise-card-inset mise-press relative flex w-full flex-col items-start gap-1 overflow-hidden p-3 pl-3.5 text-left ${
                on ? "!bg-brand-400/15 ring-2 ring-brand-500" : ""
              }`}
            >
              <span
                aria-hidden
                className={`absolute inset-y-0 left-0 w-1 ${categoryTint(groupOf(it))}`}
              />
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
              {/* "that tick mark is hiding the details." It was — a
                  disc dropped on top of the corner where the stock
                  label lives. It sits in the corner of the card now,
                  clipped by the rounded edge, so it marks the card
                  without landing on anything. */}
              {on && (
                <span
                  aria-hidden
                  className="absolute -right-5 -top-5 h-10 w-10 rotate-45 bg-brand-500"
                />
              )}
              {on && (
                <span
                  aria-hidden
                  className="absolute right-0.5 top-0.5 text-[10px] font-bold leading-none text-white"
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
  );
}


export function OrderFlow({
  items,
  suppliers,
  lines,
  onChange,
  onAddAllLow,
  footer,
  vendorPick,
  formPick,
  onVendorPick,
}: {
  items: Item[];
  suppliers: Record<string, SupplierOption[]>;
  lines: OrderLine[];
  onChange: (next: OrderLine[]) => void;
  onAddAllLow?: () => void;
  footer?: React.ReactNode;
  /** item_id -> the vendor picked for THIS order only. */
  vendorPick?: Record<string, string>;
  /** item_id -> which of that vendor's FORMS (their pack level id, "" = loose). */
  formPick?: Record<string, string>;
  /** Choose a supplier for one purchase. Never touches the ★ chosen supplier:
   *  "this is not overwrite default vendor, just for that 1 purchase I can
   *   choose." Passing "" puts the line back on the default. */
  onVendorPick?: (itemId: string, vendorId: string, packLevelId: string) => void;
}) {
  const { format } = useCurrency();
  const [cat, setCat] = useState<string | null>(null);
  // "in purchasing we need show by option — category, vendor, price high to low."
  //
  // Category is what the pad has always been, and it stays the default: it is
  // how a kitchen thinks about a shopping list. The other two answer questions
  // category cannot — "what am I buying from Rudra" and "what is costing me
  // the most" — and the second one has no groups at all, because a price
  // ranking that is broken into buckets is not a ranking.
  const [showBy, setShowBy] = useState<"category" | "vendor" | "price">("category");
  // ONE SUPPLIER FOR THIS POPUP, for this sitting only.
  //
  //   "I also want the same in categories (the items showing popup) — so that
  //    all items will show as per that 1 vendor (reset will reset the normal).
  //    Also this is IN PLACE only, not global: it will not affect the globally
  //    selected from price comparison, that is fixed."
  //
  // Never written anywhere. It ranks above the ★ chosen supplier while the
  // popup is open and evaporates on reset — the ★ is untouched throughout.
  const [catVendor, setCatVendor] = useState<string>("");
  // What the dropdown is SHOWING, before it is applied.
  //
  //   "we need to show confirmation button instead... every place we need this
  //    confirmation so that it will be a gate for user's intuition — even in
  //    that 1 sec they will change their mind and regret."
  //
  // A control that acts the instant it is touched gives you nowhere to stand
  // between the thought and the consequence. Choosing and committing are two
  // moments now, and the second one is a button you have to mean.
  const [catDraft, setCatDraft] = useState<string>("");
  const [openItem, setOpenItem] = useState<Item | null>(null);

  // Submitting clears the whole stack, not just the basket. He watched the
  // order leave and the category popup was still sitting there behind it.
  useEffect(() => {
    const clear = () => {
      setCat(null);
      setOpenItem(null);
    };
    window.addEventListener("mise:close-basket", clear);
    return () => window.removeEventListener("mise:close-basket", clear);
  }, []);
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
    (id: string, line?: OrderLine): SupplierOption | undefined => {
      const opts = suppliers[id] ?? [];
      if (!opts.length) return undefined;
      // 0. The line's OWN choice, when it has one. Two lines of the same item
      //    can sit in the basket against different suppliers, and each must be
      //    priced as itself.
      if (line?.vendor_id) {
        const theirs = opts.filter((v) => v.vendor_id === line.vendor_id);
        const exact = theirs.find((v) => (v.pack_level_id ?? "") === (line.pack_level_id ?? ""));
        if (exact) return exact;
        if (theirs.length) {
          const it0 = byId.get(id);
          return it0
            ? [...theirs].sort(
                (a, b) => (pricePerBase(it0, a) || Infinity) - (pricePerBase(it0, b) || Infinity),
              )[0]
            : theirs[0];
        }
      }
      // 1. Whoever was PICKED for this order. Same precedence the server uses
      //    when it splits the indent into purchase orders, so what the basket
      //    prices is what the purchase order will say.
      const picked = vendorPick?.[id];
      if (picked) {
        const mine = opts.filter((v) => v.vendor_id === picked);
        if (mine.length) {
          // A form was named as well — honour it even when it is the dearer
          // one. Otherwise take that supplier's best rate, which is what the
          // server does.
          const form = formPick?.[id];
          const exact = mine.find((v) => (v.pack_level_id ?? "") === (form ?? ""));
          if (form !== undefined && exact) return exact;
          const it0 = byId.get(id);
          return it0
            ? [...mine].sort((a, b) => (pricePerBase(it0, a) || Infinity) - (pricePerBase(it0, b) || Infinity))[0]
            : mine[0];
        }
      }
      // 2. The supplier this POPUP is pinned to, if they price it. Temporary
      //    and unwritten — it outranks the ★ only while the sheet is open.
      const it = byId.get(id);
      if (catVendor) {
        const theirs = opts.filter((v) => v.vendor_id === catVendor);
        if (theirs.length) {
          return it
            ? [...theirs].sort(
                (a, b) => (pricePerBase(it, a) || Infinity) - (pricePerBase(it, b) || Infinity),
              )[0]
            : theirs[0];
        }
      }
      // 3. The ★ chosen supplier. 4. Otherwise the genuinely cheapest — per
      //    BASE unit, not per quote: a £20 box of 10 kg is not cheaper than a
      //    £50 box of 50 kg.
      return (
        opts.find((v) => v.is_preferred) ??
        [...opts].sort((a, b) => {
          if (!it) return (parseFloat(a.price_per_unit) || 0) - (parseFloat(b.price_per_unit) || 0);
          return (pricePerBase(it, a) || Infinity) - (pricePerBase(it, b) || Infinity);
        })[0]
      );
    },
    [suppliers, vendorPick, formPick, byId, catVendor],
  );

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(groupOf(it), (m.get(groupOf(it)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) =>
      a[0] === OTHER ? 1 : b[0] === OTHER ? -1 : a[0].localeCompare(b[0]),
    );
  }, [items]);

  /** Every supplier who prices anything on this pad, and what they cover.
   *
   * Keyed by id rather than name: two suppliers can share a name, and merging
   * them here would put one vendor's items into another's basket. */
  const vendors = useMemo(() => {
    const m = new Map<string, { name: string; items: Item[] }>();
    for (const it of items) {
      for (const v of suppliers[it.id] ?? []) {
        const row = m.get(v.vendor_id) ?? { name: v.vendor_name, items: [] };
        // A supplier can price the same item twice (two pack forms). The tile
        // counts ITEMS, so it must not count that item twice.
        if (!row.items.some((x) => x.id === it.id)) row.items.push(it);
        m.set(v.vendor_id, row);
      }
    }
    return [...m.entries()]
      .map(([id, r]) => ({ id, ...r }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, suppliers]);

  /** Dearest first, per BASE unit.
   *
   * Per base unit and not per pack, for the reason the comparison page exists:
   * one supplier's £50 is a 5 kg box and another's is 100 kg, so ranking on the
   * sticker price puts the cheapest thing you buy at the top of the list. */
  const dearest = useMemo(
    () =>
      [...items]
        .map((it) => ({ it, each: pricePerBase(it, supplierFor(it.id)) || 0 }))
        .sort((a, b) => b.each - a.each)
        .map((r) => r.it),
    [items, supplierFor],
  );

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
      exact(
        lines.reduce((t, l) => {
          const it = byId.get(l.item_id);
          if (!it) return t;
          return t + (parseFloat(l.qty) || 0) * pricePerBase(it, supplierFor(l.item_id));
        }, 0),
      ),
    [lines, byId, supplierFor],
  );

  /** Add, then burst the popup into the basket and let the basket react as it
   *  LANDS rather than on the click. */
  const add = async (item: Item, baseQty: string, from: HTMLElement | null) => {
    // A pinned popup supplier is an EXPLICIT choice and travels with the line,
    // so pinning a different vendor and adding the same item makes a second
    // line rather than overwriting the first.
    const mine: OrderLine = {
      item_id: item.id,
      qty: baseQty,
      ...(catVendor ? { vendor_id: catVendor } : {}),
    };
    const k = lineKey(mine);
    const next = lines.some((l) => lineKey(l) === k)
      ? lines.map((l) => (lineKey(l) === k ? { ...l, qty: baseQty } : l))
      : [...lines, mine];
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

  const shown = !cat
    ? []
    : showBy === "vendor"
      ? (vendors.find((v) => v.id === cat)?.items ?? [])
      : items.filter((i) => groupOf(i) === cat);

  /** Everything this supplier sells, straight into the basket.
   *
   * "when showing by vendor, move that vendor's whole list into the basket."
   *
   * Quantity is what the item is SHORT by, topped up to its minimum — an empty
   * line is not an order, and a pad full of zeroes is worse than an empty one.
   * The vendor travels on every line, because the whole point of arriving here
   * by supplier is that this is the supplier you meant. */
  const addWholeVendor = (vendorId: string) => {
    const v = vendors.find((x) => x.id === vendorId);
    if (!v) return;
    const next = [...lines];
    for (const it of v.items) {
      const mine: OrderLine = { item_id: it.id, qty: "0", vendor_id: vendorId };
      const short = Math.max(
        0,
        parseFloat(it.min_stock_level ?? "0") - parseFloat(it.current_stock ?? "0"),
      );
      // Nothing short still gets a line — he is looking at this supplier's list
      // because he intends to buy from them — but it starts at one unit rather
      // than at zero, which submits as nothing.
      mine.qty = String(short > 0 ? exact(short) : 1);
      const k = lineKey(mine);
      const at = next.findIndex((l) => lineKey(l) === k);
      if (at >= 0) next[at] = { ...next[at], qty: mine.qty };
      else next.push(mine);
    }
    onChange(next);
    setBump(true);
    window.setTimeout(() => setBump(false), 420);
  };

  return (
    <div className="min-w-0">
      {low.length > 0 && (
        <div className="mise-card3d mise-card3d-wide relative mb-3 flex items-center gap-2.5 overflow-hidden py-2 pl-3.5 pr-2">
          <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-amber-400" />
          <span aria-hidden className="shrink-0 text-base leading-none">⚠</span>
          {/* One line that fits. It used to wrap and hang out of its own box —
              "this section also handing like it's not fitting in that place". */}
          <span className="min-w-0 flex-1 truncate text-sm text-fg">
            <b className="text-amber-300">{low.length}</b> item
            {low.length === 1 ? " is" : "s are"} low
          </span>
          {onAddAllLow && (
            <button
              type="button"
              onClick={onAddAllLow}
              title="Pull every low-stock item into this order, topped up to its minimum"
              className="mise-btn mise-press shrink-0 px-2.5 py-1.5 text-xs font-semibold text-amber-300"
            >
              Add them all
            </button>
          )}
        </div>
      )}

      {/* "show by" — category, vendor, or dearest first.
          Three buttons rather than a dropdown: the whole pad is built on
          tapping rather than scrolling, and a select would be the one control
          on the page that hides its own options. */}
      <div className="mb-3 flex items-center gap-2 overflow-x-auto">
        <span className="shrink-0 text-xs text-fg-faint">Show by</span>
        <div className="mise-well flex shrink-0 gap-1 rounded-xl p-1">
          {(
            [
              ["category", "Category"],
              ["vendor", "Supplier"],
              ["price", "Price high–low"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-testid={`showby-${key}`}
              aria-pressed={showBy === key}
              onClick={() => {
                // Leaving a grouping must close whatever it had open, or the
                // popup outlives the list it belongs to.
                setShowBy(key);
                setCat(null);
                setCatVendor("");
                setCatDraft("");
              }}
              className={`mise-press rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                showBy === key
                  ? "bg-brand-600 text-white"
                  : "text-fg-soft hover:text-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Dearest first has no groups: a price ranking split into buckets is not
          a ranking. Straight to the items, most expensive at the top. */}
      {showBy === "price" && (
        <ItemGrid
          shown={dearest}
          supplierFor={supplierFor}
          picked={picked}
          onOpen={setOpenItem}
        />
      )}

      {/* Layer one, by supplier: tap to see their list, or send the whole list
          to the basket without opening it. */}
      {showBy === "vendor" && (
        <ClickSpark sparkColor="#34d399" sparkCount={8} sparkRadius={16} duration={380}>
          <div className="mise-stagger grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {vendors.length === 0 && (
              <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
                No supplier prices yet — add one on the <b>Vendors</b> page.
              </p>
            )}
            {vendors.map((v) => (
              <div
                key={v.id}
                className="mise-card-inset relative flex items-center gap-3 overflow-hidden px-3.5 py-4 pl-4"
              >
                <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-sky-400" />
                <button
                  type="button"
                  data-testid="vendor-tile"
                  /* PIN THE POPUP TO THIS SUPPLIER.
                     Without this, tapping "Exotic" opened a sheet headed
                     "Exotic · 48 items" that priced Aluminium Containers from
                     SK and Bell Pepper from Farm2Land — the LIST was Exotic's,
                     the PRICES were whoever happened to be each item's chosen
                     supplier. "if i touch means it need only show its own
                     supplier item alone and i can order from that."

                     `catVendor` already existed for exactly this: it outranks
                     the ★ while a sheet is open and is never written down.
                     Arriving by supplier tile simply means arriving with it
                     already set. */
                  onClick={() => {
                    setCatVendor(v.id);
                    setCatDraft(v.id);
                    setCat(v.id);
                  }}
                  className="mise-press flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span aria-hidden className="text-2xl">🚚</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-sm font-semibold text-fg">
                      {v.name}
                    </span>
                    <span className="block truncate text-[11px] text-fg-faint">
                      {v.items.length} item{v.items.length === 1 ? "" : "s"} priced
                    </span>
                  </span>
                </button>
                {/* His item 5. Separate button, not the tile itself: filling a
                    basket and looking at a list are different intentions, and
                    one tap must not do the other by accident. */}
                <button
                  type="button"
                  data-testid="vendor-add-all"
                  onClick={() => addWholeVendor(v.id)}
                  title={`Put all ${v.items.length} of ${v.name}'s items in the basket`}
                  className="mise-btn mise-press shrink-0 px-2.5 py-1.5 text-xs font-semibold text-brand-300"
                >
                  Add all
                </button>
              </div>
            ))}
          </div>
        </ClickSpark>
      )}

      {/* Layer one: the categories. Nothing else on screen. */}
      {showBy === "category" && (
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
                data-testid="category-tile"
                onClick={() => setCat(name)}
                /* The stripe is what he said made the basket cards readable at
                   a glance — "all cards are looking same once I see suddenly".
                   Same idiom here, so the page is one design rather than three. */
                className="mise-card-inset mise-press relative flex w-full items-center gap-3 overflow-hidden px-3.5 py-4 pl-4 text-left"
              >
                <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${categoryTint(name)}`} />
                <span aria-hidden className="text-2xl">{categoryEmoji(name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm font-semibold text-fg">
                    {name}
                  </span>
                  {/* The stripe's meaning, in words, once — so the colour stops
                      being decoration the moment you read it. */}
                  <span className="block truncate text-[11px] text-fg-faint">
                    {n} items · {categoryKind(name).kind}
                  </span>
                </span>
              </button>
            </GlareHover>
          ))}
        </div>
      </ClickSpark>
      )}

      {/* Layer two: that category's items. */}
      {cat && (
        <Sheet
          onClose={() => { setCat(null); setCatVendor(""); setCatDraft(""); }}
          title={showBy === "vendor" ? (vendors.find((v) => v.id === cat)?.name ?? cat) : cat}
          subtitle={`${shown.length} items`}
          // Two items stay square; nine spread out rather than scrolling.
          columns={shown.length >= 9 ? 4 : shown.length >= 5 ? 3 : shown.length >= 3 ? 2 : 1}
        >
          {/* Pin the whole popup to one supplier, for this sitting only. He
              asked for it AND for it to look temporary in the same breath:
              "why highlighting means, this will create confusion, that's why."
              So it wears amber — the colour this app already uses for "not the
              usual" — and says plainly that it is not saved. */}
          {(() => {
            const inCat = new Map<string, string>();
            for (const it of shown) {
              for (const v of suppliers[it.id] ?? []) inCat.set(v.vendor_id, v.vendor_name);
            }
            if (inCat.size < 2) return null;
            return (
              <div
                className={`mb-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                  catVendor
                    ? "border-amber-400/45 bg-amber-400/10"
                    : "border-line bg-paper-2/50"
                }`}
              >
                <span className={catVendor ? "mise-tone-warn font-medium" : "text-fg-faint"}>
                  {catVendor ? "Showing prices from" : "Show prices from one supplier"}
                </span>
                <select
                  value={catDraft}
                  onChange={(e) => setCatDraft(e.target.value)}
                  aria-label="Choose a supplier to price every item at"
                  className="mise-well rounded-lg px-2 py-1 text-xs outline-none"
                >
                  <option value="">every supplier (normal)</option>
                  {[...inCat.entries()].map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>

                {/* The gate. Nothing has changed on the page until this is
                    pressed, so the second between picking and meaning it is
                    yours. */}
                {catDraft !== catVendor && (
                  <button
                    type="button"
                    onClick={() => setCatVendor(catDraft)}
                    className="mise-press rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white"
                  >
                    {catDraft ? "Show these prices" : "Back to normal"}
                  </button>
                )}
                {catVendor && catDraft === catVendor && (
                  <button
                    type="button"
                    onClick={() => { setCatVendor(""); setCatDraft(""); }}
                    className="mise-press rounded-lg border border-line px-2 py-1 text-xs text-fg-soft hover:text-fg"
                  >
                    Reset
                  </button>
                )}
                {catVendor && (
                  <span className="w-full text-[11px] text-fg-faint">
                    Just for now — your ★ chosen supplier is unchanged, and nothing here is
                    saved.
                  </span>
                )}
              </div>
            );
          })()}

          <ItemGrid
            shown={shown}
            supplierFor={supplierFor}
            picked={picked}
            onOpen={setOpenItem}
          />
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
          suppliers={suppliers}
          onVendorPick={onVendorPick}
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
  suppliers,
  onVendorPick,
}: {
  lines: OrderLine[];
  byId: Map<string, Item>;
  supplierFor: (id: string, line?: OrderLine) => SupplierOption | undefined;
  onChange: (next: OrderLine[]) => void;
  onClose: () => void;
  /** Reopen the quantity popup for this line. */
  onEdit: (it: Item) => void;
  footer?: React.ReactNode;
  suppliers: Record<string, SupplierOption[]>;
  /** Present = the basket may re-point a line at another supplier. */
  onVendorPick?: (itemId: string, vendorId: string, packLevelId: string) => void;
}) {
  const { format } = useCurrency();
  const confirm = useConfirm();

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

  // How the basket is arranged. Grouping by supplier is what it does now and it
  // IS the useful default — "we are grouping and showing item based on vendor,
  // which is a great useful one" — but it is not the only question. Sorting by
  // price answers "what is making this order expensive", and by category
  // answers "have I done the vegetables yet".
  const [groupBy, setGroupBy] = useState<"vendor" | "category" | "price">("vendor");
  // "when you group by supplier we need one minimise feature inside that, so
  // that we can see the next supplier easily and can maximise when we want —
  // default is maximise." Folded by name, so folding Farm2Land and then
  // regrouping does not fold something unrelated.
  const [folded, setFolded] = useState<Set<string>>(new Set());

  /** Which cards are showing their back. */
  const [turned, setTurned] = useState<Set<string>>(new Set());
  const turn = (id: string) =>
    setTurned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // THE REVEAL, in sequence.
  //
  // "the flipping and i button glowing happening at the same time makes things
  //  worse... first make the flip smooth. Once user enters basket, flip the
  //  card for a sec to realise, then flip back to normal."
  //
  // So: a beat to let the basket settle, turn, hold long enough to register,
  // turn back. One idea at a time. The i button is gone entirely — the turn is
  // the teacher, and a control that needs its own explanation is not one.
  const [shine, setShine] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ids = lines.map((l) => l.item_id);
    if (!ids.length) return;

    const t1 = window.setTimeout(() => {
      setShine(true);
      setTurned(new Set(ids));
    }, 520);
    const t2 = window.setTimeout(() => setShine(false), 1900);
    const t3 = window.setTimeout(() => setTurned(new Set()), 2200);
    return () => {
      [t1, t2, t3].forEach(window.clearTimeout);
      setTurned(new Set());
      setShine(false);
    };
    // Once per opening, not once per change — re-running it whenever a quantity
    // changed would spin the cards under his hands.
  }, []);
  const toggleFold = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const groups = useMemo(() => {
    const m = new Map<
      string,
      { key: string; name: string; rows: { it: Item; qty: string; line: OrderLine }[]; total: number }
    >();
    for (const l of lines) {
      const it = byId.get(l.item_id);
      if (!it) continue;
      const sup = supplierFor(l.item_id);
      const money = exact((parseFloat(l.qty) || 0) * pricePerBase(it, sup));

      let key: string;
      let name: string;
      if (groupBy === "category") {
        key = groupOf(it);
        name = `${categoryEmoji(groupOf(it))} ${groupOf(it)}`;
      } else if (groupBy === "price") {
        // One bucket, sorted by what each line costs — the expensive lines are
        // the ones worth a second look before you send it.
        key = "__all__";
        name = "Dearest first";
      } else {
        key = sup?.vendor_id ?? "none";
        name = sup?.vendor_name ?? "No supplier yet";
      }

      const g = m.get(key) ?? { key, name, rows: [], total: 0 };
      g.rows.push({ it, qty: l.qty, line: l });
      g.total = exact(g.total + money);
      m.set(key, g);
    }
    const out = [...m.values()];
    if (groupBy === "price") {
      for (const g of out) {
        g.rows.sort((a, b) => {
          const cost = (r: { it: Item; qty: string }) =>
            (parseFloat(r.qty) || 0) * pricePerBase(r.it, supplierFor(r.it.id));
          return cost(b) - cost(a);
        });
      }
    }
    return out;
  }, [lines, byId, supplierFor, groupBy]);

  const grand = exact(groups.reduce((t, g) => t + g.total, 0));

  /** Take a whole group out at once. */
  const dropGroup = (g: { rows: { it: Item }[] }) => {
    const ids = new Set(g.rows.map((r) => r.it.id));
    onChange(lines.filter((l) => !ids.has(l.item_id)));
  };

  return (
    <Sheet
      onClose={onClose}
      title="Your basket"
      panelId={BASKET_PANEL_ID}
      // A basket with two lines had a scrollbar. It grows with what it holds
      // now, up to the same cap every other popup uses — "make the basket popup
      // size bigger, it needs to grow based on the number of items it has."
      // "Grow the size of basket popup if we have more items in it... now only
      // 1 item I can see clearly, to see next item I need to scroll down. This
      // is worst UI." Four across once there are enough to warrant it.
      columns={lines.length >= 7 ? 4 : lines.length >= 4 ? 3 : lines.length >= 2 ? 2 : 1}
      subtitle={`${lines.length} item${lines.length === 1 ? "" : "s"} · ${format(grand.toFixed(2))}`}
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
      {/* Arrange it, and empty it. Both were missing: the basket could only be
          read one way, and the only way to remove anything was one ✕ at a time.
          Kept to one line so it does not become the thing you scroll past. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <span className="mr-0.5 text-[11px] text-fg-faint">group by</span>
          {([
            ["vendor", "supplier"],
            ["category", "kind"],
            ["price", "price"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setGroupBy(k)}
              className={`mise-press rounded-lg px-2.5 py-1 text-[11px] transition ${
                groupBy === k
                  ? "bg-brand-500 font-semibold text-white"
                  : "border border-line text-fg-soft hover:border-brand-400/40"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={async () => {
            // "the empty basket feature -> need to ask for confirmation before
            // empty. Same for the remove all feature in the supplier card."
            // Quite right — a basket is ten minutes of work and there is no undo.
            if (
              await confirm({
                title: "Empty the whole basket?",
                message: `${lines.length} item${lines.length === 1 ? "" : "s"} will be taken out. This cannot be undone.`,
                confirmText: "Empty it",
                tone: "danger",
              })
            ) {
              onChange([]);
            }
          }}
          className="mise-press rounded-lg border border-line px-2.5 py-1 text-[11px] text-fg-soft transition hover:border-rose-400/50 hover:text-rose-300"
        >
          Empty the basket
        </button>
      </div>

      <div className="mise-sheet-cascade space-y-3">
        {groups.map((g, gi) => (
          <div key={g.key} style={{ "--i": gi } as React.CSSProperties} className="rounded-2xl border border-line bg-paper-2/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => toggleFold(g.key)}
                aria-expanded={!folded.has(g.key)}
                className="mise-press flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <span
                  aria-hidden
                  className={`text-[10px] text-fg-faint transition-transform ${
                    folded.has(g.key) ? "" : "rotate-90"
                  }`}
                >
                  ▶
                </span>
                <span className="truncate text-sm font-semibold text-fg">{g.name}</span>
                <span className="shrink-0 rounded-full bg-glass/10 px-1.5 text-[10px] tabular-nums text-fg-faint">
                  {g.rows.length}
                </span>
              </button>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="font-display text-sm font-semibold tabular-nums text-fg-soft">
                  {format(g.total.toFixed(2))}
                </span>
                {/* Cancel a whole supplier, or a whole category — "we need a
                    cancel all button with flexibility, cancel all or cancel
                    particular vendor or particular category". */}
                {groups.length > 1 && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `Remove everything from ${g.name}?`,
                          message: `${g.rows.length} item${g.rows.length === 1 ? "" : "s"} will be taken out of the basket.`,
                          confirmText: "Remove them",
                          tone: "danger",
                        })
                      ) {
                        dropGroup(g);
                      }
                    }}
                    title={`Remove everything from ${g.name}`}
                    className="mise-press rounded-lg px-1.5 py-0.5 text-[11px] text-fg-faint transition hover:text-rose-300"
                  >
                    remove all
                  </button>
                )}
              </span>
            </div>
            {/* Two across when there is room. A tall thin list of 20 items is
                the scroll he was complaining about. */}
            {!folded.has(g.key) && (
            <ul
              className="mt-2 grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(10.5rem, 100%), 1fr))" }}
            >
              {g.rows.map(({ it, qty, line: l }) => {
                // Priced for THIS line's supplier, so two lines of the same
                // item can legitimately show two different numbers.
                const sup = supplierFor(it.id, l);
                const n = parseFloat(qty) || 0;
                const had = parseFloat(it.current_stock) || 0;
                const after = exact(had + n);
                const min = parseFloat(it.min_stock_level || "0") || 0;
                const short = min > 0 && after < min;
                const tint = categoryTint(groupOf(it));
                const flipped = turned.has(it.id);
                const sizes = sup ? priceLines(it, sup) : [];
                const money = n * pricePerBase(it, sup);
                return (
                  <li key={lineKey(l)} className="mise-flip" data-flipped={flipped ? "true" : "false"}>
                    {/* The whole card turns. Not a corner of it — all of it. */}
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`${it.name} — tap for the full detail`}
                      onClick={() => turn(it.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          turn(it.id);
                        }
                      }}
                      className="mise-flip-inner cursor-pointer"
                    >
                      {/* ── FRONT ─────────────────────────────────────────── */}
                      <div className="mise-card3d mise-flip-face mise-shine relative overflow-hidden p-2.5 pl-3.5">
                        <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${tint}`} />

                        {/* Name and money on one baseline, the money in the
                            display face so the eye lands on it first. */}
                        {/* Stacked, not spread. On a narrow card the eye reads
                            top to bottom, and the money is the line it should
                            land on. */}
                        <div className="flex items-start gap-1.5">
                          <span aria-hidden className="shrink-0 text-base leading-none">
                            {categoryEmoji(groupOf(it))}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight text-fg">
                            {it.name}
                          </span>
                        </div>

                        <div className="mt-1 flex items-baseline justify-between gap-2">
                          <span className="font-display text-base font-semibold leading-none tabular-nums text-fg">
                            {format(money.toFixed(2))}
                          </span>
                          <span className="shrink-0 text-[11px] font-medium tabular-nums text-fg-soft">
                            {tidy(n)} {it.unit}
                          </span>
                        </div>

                        {/* WHO THIS ONE IS COMING FROM — changeable here, for
                            this purchase only. "I need flexibility to choose my
                            vendor as per my wish... currently I need to go to
                            price comparison page to change default vendor and
                            use this for all purchase. This is not overwrite
                            default vendor, just for that 1 purchase."

                            The ★ chosen supplier is untouched; the server's
                            precedence is picked > chosen > cheapest, which is
                            exactly what supplierFor does above, so the basket
                            prices what the purchase order will say. */}
                        {(() => {
                          const opts = suppliers[it.id] ?? [];
                          if (!onVendorPick || opts.length < 2) {
                            return (
                              <p className="mt-0.5 truncate text-[10px] text-fg-faint">
                                {sup?.vendor_name ?? "no supplier"}
                              </p>
                            );
                          }
                          const chosen = l.vendor_id ?? "";
                          const chosenForm = l.pack_level_id ?? "";
                          const ways = opts
                            .map((v) => ({ v, per: pricePerBase(it, v) || 0 }))
                            .filter((x) => x.per > 0)
                            .sort((a, b) => a.per - b.per);
                          const key = (v: SupplierOption) =>
                            `${v.vendor_id}|${v.pack_level_id ?? ""}`;
                          return (
                            <label className="mt-0.5 block" onClick={(e) => e.stopPropagation()}>
                              <span className="sr-only">
                                Supplier and pack for {it.name}, this order only
                              </span>
                              <select
                                value={chosen ? `${chosen}|${chosenForm}` : ""}
                                onChange={(e) => {
                                  const [vid, lvl] = (e.target.value || "").split("|");
                                  const k = lineKey(l);
                                  const updated: OrderLine = {
                                    ...l,
                                    vendor_id: vid || undefined,
                                    pack_level_id: vid ? lvl || undefined : undefined,
                                  };
                                  // Changing a line onto a supplier that is
                                  // already in the basket MERGES the two, since
                                  // they are now the same purchase.
                                  const nk = lineKey(updated);
                                  const clash = lines.find((x) => lineKey(x) !== k && lineKey(x) === nk);
                                  onChange(
                                    clash
                                      ? lines
                                          .filter((x) => lineKey(x) !== k)
                                          .map((x) =>
                                            lineKey(x) === nk
                                              ? { ...x, qty: String((parseFloat(x.qty) || 0) + (parseFloat(l.qty) || 0)) }
                                              : x,
                                          )
                                      : lines.map((x) => (lineKey(x) === k ? updated : x)),
                                  );
                                }}
                                className={`w-full truncate rounded border-0 bg-transparent px-0 py-0 text-[10px] outline-none ${
                                  chosen ? "mise-tone-warn font-medium" : "text-fg-faint"
                                }`}
                              >
                                <option value="">
                                  {sup
                                    ? `${sup.vendor_name}${sup.is_preferred ? " ★" : " (best rate)"}`
                                    : "no supplier"}
                                </option>
                                {ways.map(({ v, per }) => (
                                  <option key={key(v)} value={key(v)}>
                                    {v.vendor_name} ·{" "}
                                    {v.pack_level_id ? `by the ${levelName(it, v.pack_level_id)}` : "loose"}{" "}
                                    · {format(per.toFixed(2))}/{it.unit}
                                  </option>
                                ))}
                              </select>
                            </label>
                          );
                        })()}

                        {/* FIXED SLOTS — the same four rows on every card,
                            whether or not there is something to put in them.
                            That is what makes a grid of cards a grid rather
                            than a staircase, and it costs no information: an
                            item with no pack chain shows a dash where the pack
                            price would be. */}
                        <dl className="mt-1.5 space-y-0.5 border-t border-line/50 pt-1.5 text-[10px] leading-tight">
                          <div className="flex items-baseline justify-between gap-2">
                            <dt className="mise-tone-info">in stock</dt>
                            <dd className="mise-tone-info shrink-0 font-semibold tabular-nums">
                              {fmtQty(String(had), it.unit)}
                            </dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <dt className={short ? "mise-tone-warn" : "mise-tone-good"}>
                              after this
                            </dt>
                            <dd
                              className={`shrink-0 font-semibold tabular-nums ${
                                short ? "mise-tone-warn" : "mise-tone-good"
                              }`}
                            >
                              {fmtQty(String(after), it.unit)}
                            </dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <dt className="truncate text-fg-soft">
                              {sizes[1] ? `1 ${sizes[1].label}` : "one pack"}
                            </dt>
                            <dd className="shrink-0 font-semibold tabular-nums text-fg">
                              {sizes[1] ? format(sizes[1].price.toFixed(2)) : "—"}
                            </dd>
                          </div>
                        </dl>

                        {/* Small, quiet, and they never flip the card. */}
                        <div className="mt-1.5 flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(it);
                            }}
                            aria-label={`Change how much ${it.name}`}
                            title="Change how much"
                            className="mise-press grid h-6 w-6 place-items-center rounded-md border border-line text-[10px] text-fg-soft transition hover:border-brand-400/50 hover:text-brand-300"
                          >
                            &#9998;
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onChange(lines.filter((l) => l.item_id !== it.id));
                            }}
                            aria-label={`Remove ${it.name}`}
                            title="Take it out"
                            className="mise-press grid h-6 w-6 place-items-center rounded-md text-[10px] text-fg-faint transition hover:text-rose-300"
                          >
                            &#10005;
                          </button>
                        </div>
                      </div>

                      {/* ── BACK — every size, priced, and the pack maths ──
                          No close button: the card itself turns back, and a
                          second ✕ next to the remove ✕ only asks "which one
                          takes it out of my basket?" */}
                      <div className="mise-card3d mise-flip-face mise-flip-back relative overflow-hidden p-2.5 pl-3.5">
                        <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${tint}`} />
                        <p className="truncate font-display text-[13px] font-semibold leading-tight text-brand-300">
                          {it.name}
                        </p>
                        <dl className="mt-1 space-y-0.5 text-[11px] leading-tight">
                          {sizes.map((l) => (
                            <div key={l.label} className="flex items-baseline justify-between gap-2">
                              <dt className="min-w-0 truncate text-fg-faint">
                                1 {l.label}
                                {l.note ? ` = ${l.note}` : ""}
                              </dt>
                              <dd className="shrink-0 font-medium tabular-nums text-fg">
                                {format(l.price.toFixed(2))}
                              </dd>
                            </div>
                          ))}
                          <div className="flex items-baseline justify-between gap-2 border-t border-line/50 pt-1">
                            <dt className="text-fg-faint">in stock</dt>
                            <dd className="shrink-0 tabular-nums text-fg-soft">
                              {fmtQty(String(had), it.unit)}
                              {stockInPacks(it, had) ? ` (${stockInPacks(it, had)})` : ""}
                            </dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <dt className="text-fg-faint">after this</dt>
                            <dd
                              className={`shrink-0 tabular-nums ${short ? "text-amber-300" : "text-fg-soft"}`}
                            >
                              {fmtQty(String(after), it.unit)}
                              {stockInPacks(it, after) ? ` (${stockInPacks(it, after)})` : ""}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
