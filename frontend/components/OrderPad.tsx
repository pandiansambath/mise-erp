"use client";

// Purchasing, rebuilt. See docs/PURCHASING_REDESIGN.md for the reasoning.
//
// The one idea: ORDERING IS NOT SHOPPING — IT IS WRITING A LIST. A chef already
// knows the kitchen needs onions. They are not browsing, so a catalogue to
// search and scroll is work invented by the app.
//
// And his sharpest constraint: "i should not feel the scroll... without scroll
// how we can allow user to pick item... picking will be a fun."
//
// You never need to SEE sixty items to pick six. Two ways in, neither scrolls:
//
//   TYPE   "onion 25" — three letters summons it, a number sizes it, Enter
//          sends it. You never meet the other fifty-seven.
//   TAP    one level into a category, whose items fit the panel as tiles. Like
//          a POS, which every chef already knows.
//
// Paging is a decision you make. Scrolling is a thing that happens to you.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Item, SupplierOption } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { categoryEmoji, fmtQty, stockState } from "@/components/ItemPicker";
import { flyToPocket } from "@/components/Pocket";
import ClickSpark from "@/components/reactbits/ClickSpark";
import Magnet from "@/components/reactbits/Magnet";
import { CountUp } from "@/components/reactbits/CountUp";
import GlareHover from "@/components/reactbits/GlareHover";

export type OrderLine = { item_id: string; qty: string };

const OTHER = "Other";
const groupOf = (it: Item) => it.category?.trim() || OTHER;

/** "onion 25 packets" -> { name: "onion", qty: "25", unit: "packets" }
 *
 *  Written the way somebody writes a list, so the parser has to meet them
 *  there rather than the other way round. The quantity is the first number;
 *  everything before it is the name; anything after is a size.
 */
export function parseLine(raw: string): { name: string; qty: string; unit: string } {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const at = parts.findIndex((p) => /^\d/.test(p));
  if (at < 0) return { name: parts.join(" "), qty: "", unit: "" };
  return {
    name: parts.slice(0, at).join(" "),
    qty: (parts[at].match(/[\d.]+/) ?? [""])[0],
    unit: parts.slice(at + 1).join(" ").trim(),
  };
}

/** Best matches for what has been typed. Prefix beats contains, so "on" puts
 *  Onion above Bacon — the thing you meant is the thing you get. */
export function matchItems(items: Item[], query: string, limit = 6): Item[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts: Item[] = [];
  const has: Item[] = [];
  for (const it of items) {
    const n = it.name.toLowerCase();
    if (n.startsWith(q)) starts.push(it);
    else if (n.includes(q)) has.push(it);
  }
  return [...starts, ...has].slice(0, limit);
}

export function OrderPad({
  items,
  suppliers,
  lines,
  onChange,
  footer,
  onAddAllLow,
  overrides,
  onOverride,
}: {
  items: Item[];
  suppliers: Record<string, SupplierOption[]>;
  lines: OrderLine[];
  onChange: (next: OrderLine[]) => void;
  /** The submit control — owned by the page, since it knows what submitting means. */
  footer?: React.ReactNode;
  /** Load everything below its minimum, topped up to par. */
  onAddAllLow?: () => void;
  /** item id -> a vendor deliberately chosen for this order, overriding the
   *  usual "chosen supplier, else cheapest" rule. */
  overrides?: Record<string, string>;
  onOverride?: (itemId: string, vendorId: string | null) => void;
}) {
  const { format } = useCurrency();
  const [cat, setCat] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const picked = useMemo(() => new Set(lines.map((l) => l.item_id)), [lines]);

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(groupOf(it), (m.get(groupOf(it)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) =>
      a[0] === OTHER ? 1 : b[0] === OTHER ? -1 : a[0].localeCompare(b[0]),
    );
  }, [items]);

  const parsed = parseLine(text);
  const matches = useMemo(
    () => matchItems(items, parsed.name || text, 6),
    [items, parsed.name, text],
  );

  /** The supplier a line will be bought from: the chosen one, else cheapest. */
  const supplierFor = useCallback(
    (id: string): SupplierOption | undefined => {
      const opts = suppliers[id] ?? [];
      if (!opts.length) return undefined;
      const forced = overrides?.[id];
      if (forced) {
        const hit = opts.find((v) => v.vendor_id === forced);
        if (hit) return hit;
      }
      return (
        opts.find((v) => v.is_preferred) ??
        [...opts].sort(
          (a, b) => (parseFloat(a.price_per_unit) || 0) - (parseFloat(b.price_per_unit) || 0),
        )[0]
      );
    },
    [suppliers, overrides],
  );

  const add = useCallback(
    (it: Item, qty: string, from?: HTMLElement | null) => {
      if (from) flyToPocket(from, it.name);
      const existing = lines.find((l) => l.item_id === it.id);
      if (existing) {
        onChange(lines.map((l) => (l.item_id === it.id ? { ...l, qty: qty || l.qty } : l)));
      } else {
        onChange([...lines, { item_id: it.id, qty }]);
      }
    },
    [lines, onChange],
  );

  const remove = (id: string) => onChange(lines.filter((l) => l.item_id !== id));

  const commit = (el?: HTMLElement | null) => {
    const it = matches[hi];
    if (!it) return;
    add(it, parsed.qty, el ?? input.current);
    setText("");
    setHi(0);
    input.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      setText("");
      setHi(0);
    }
  };

  useEffect(() => setHi(0), [text]);

  // The order, grouped the way it will actually be sent.
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; rows: { it: Item; qty: string; each: number }[]; total: number }>();
    for (const l of lines) {
      const it = byId.get(l.item_id);
      if (!it) continue;
      const sup = supplierFor(l.item_id);
      const key = sup?.vendor_id ?? "none";
      const each = parseFloat(sup?.price_per_unit ?? "0") || 0;
      const g = m.get(key) ?? {
        name: sup?.vendor_name ?? "No supplier yet",
        rows: [],
        total: 0,
      };
      g.rows.push({ it, qty: l.qty, each });
      g.total += each * (parseFloat(l.qty) || 0);
      m.set(key, g);
    }
    return [...m.values()];
  }, [lines, byId, supplierFor]);

  const grand = groups.reduce((t, g) => t + g.total, 0);

  // What needs ordering, worked out here rather than asked for.
  const low = useMemo(
    () => items.filter((i) => {
      const l = stockState(i).label;
      return l === "running low" || l === "out of stock";
    }),
    [items],
  );
  const out = useMemo(
    () => items.filter((i) => stockState(i).label === "out of stock").length,
    [items],
  );

  const shown = cat ? items.filter((i) => groupOf(i) === cat) : [];
  // Tiles shrink to fit rather than scroll. Below the floor it pages.
  const tileMin = shown.length > 24 ? "7rem" : shown.length > 12 ? "8.5rem" : "10rem";

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[1.15fr_1fr]">
      {/* ── picking ─────────────────────────────────────────────── */}
      {/* Sparks wrap the picking side only. "picking will be a fun" — a spark
          at the exact point of contact is the cheapest way to make a tap feel
          like it landed. Deliberately NOT around the order panel, where taps
          are edits and a shower of sparks would be noise. */}
      <ClickSpark sparkColor="#34d399" sparkCount={8} sparkRadius={18} duration={420}>
      <div className="flex min-h-0 flex-col gap-3">
        {/* NEEDS YOU — the answer before the question.
            You arrive at this page already knowing you have to order something.
            It knows what is below its minimum, so it should say so rather than
            open an empty search box and wait. One tap loads them all at
            par-topping quantities. */}
        {/* A quiet amber panel, not a lightning border.
            The ElectricBorder that was here crackled continuously, and he was
            blunt: "i dont like this lighting.. its irritating me". He is right
            — this sits above the thing you came to the page to do, so it has to
            be readable at a glance and then get out of the way. Continuous
            motion beside a form you are typing into is the opposite of that. */}
        {low.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/35 bg-amber-400/[0.07] px-3.5 py-2.5">
              <span aria-hidden className="text-lg">⚠</span>
              <span className="min-w-0 flex-1 text-sm text-fg">
                <b className="text-amber-300">{low.length}</b> item
                {low.length === 1 ? " is" : "s are"} at or below minimum
                {out > 0 && (
                  <span className="text-rose-300"> · {out} out of stock</span>
                )}
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

        {/* The pad. Type a name, then a number. */}
        <div className="mise-neo-raised rounded-2xl p-3">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="text-lg">✎</span>
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder="onion 25   —  type a name, then how much"
              aria-label="Add an item by name and quantity"
              className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-faint/70"
            />
            {text && (
              <button
                type="button"
                onClick={() => setText("")}
                aria-label="Clear"
                className="mise-press rounded-lg px-2 py-1 text-fg-faint"
              >
                ✕
              </button>
            )}
          </div>

          {matches.length > 0 && (
            <ul className="mise-stagger mt-2 space-y-1 border-t border-line pt-2">
              {matches.map((it, i) => {
                const sup = supplierFor(it.id);
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setHi(i)}
                      onClick={(e) => {
                        setHi(i);
                        add(it, parsed.qty, e.currentTarget);
                        setText("");
                        input.current?.focus();
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                        i === hi ? "bg-brand-400/15 ring-1 ring-brand-400/50" : "hover:bg-glass/5"
                      }`}
                    >
                      <span aria-hidden className="text-base">{categoryEmoji(groupOf(it))}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                        {it.name}
                      </span>
                      {parsed.qty && (
                        <span className="shrink-0 rounded-lg bg-brand-500/20 px-2 py-0.5 text-xs font-semibold tabular-nums text-brand-200">
                          {parsed.qty} {parsed.unit || it.unit}
                        </span>
                      )}
                      <span className="shrink-0 text-[11px] text-fg-faint">
                        {sup ? `${sup.vendor_name} ${format(sup.price_per_unit)}` : "no supplier"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {text && matches.length === 0 && (
            <p className="mt-2 border-t border-line pt-2 text-sm text-fg-faint">
              Nothing called “{parsed.name || text}”. Add it in Inventory first.
            </p>
          )}
        </div>

        {/* Or tap one level in. Never a scroll. */}
        {!text && (
          <div className="min-h-0 flex-1">
            {cat === null ? (
              <div className="mise-stagger grid grid-cols-2 gap-2 sm:grid-cols-3">
                {cats.map(([name, n]) => (
                  // A light sweeps across as the cursor passes, which makes a
                  // grid of tiles read as objects you could pick up rather than
                  // rectangles you click.
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
                    transitionDuration={650}
                    className="!block"
                  >
                  <button
                    type="button"
                    onClick={() => setCat(name)}
                    className="mise-neo-raised mise-press flex w-full items-center gap-2.5 rounded-2xl px-3 py-3 text-left transition hover:-translate-y-0.5"
                  >
                    <span aria-hidden className="text-xl">{categoryEmoji(name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-fg">{name}</span>
                      <span className="block text-[11px] text-fg-faint">{n} items</span>
                    </span>
                  </button>
                  </GlareHover>
                ))}
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => setCat(null)}
                  className="mise-press mb-2 inline-flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-sm text-fg-soft transition hover:border-brand-400/50"
                >
                  <span aria-hidden>‹</span> All categories
                </button>
                <div
                  className="mise-stagger grid gap-2"
                  style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileMin}, 1fr))` }}
                >
                  {shown.map((it) => {
                    const on = picked.has(it.id);
                    const st = stockState(it);
                    return (
                      <button
                        key={it.id}
                        type="button"
                        aria-pressed={on}
                        onClick={(e) =>
                          on ? remove(it.id) : add(it, "", e.currentTarget)
                        }
                        className={`mise-press relative flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition duration-200 hover:-translate-y-0.5 ${
                          on
                            ? "border-brand-500 bg-brand-400/15 shadow-lg shadow-brand-600/20"
                            : "mise-neo-raised border-transparent"
                        }`}
                      >
                        <span aria-hidden className="text-2xl">{categoryEmoji(groupOf(it))}</span>
                        <span className="line-clamp-2 text-sm font-semibold leading-snug text-fg">
                          {it.name}
                        </span>
                        <span className={`text-[11px] ${st.cls}`}>
                          {fmtQty(it.current_stock, it.unit)}
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
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      </ClickSpark>

      {/* ── the order, live ─────────────────────────────────────── */}
      <div className="mise-feel flex min-h-0 flex-col rounded-2xl border border-line bg-paper-2/60 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
            The order
          </p>
          {lines.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mise-press rounded-lg px-2 py-1 text-[11px] text-fg-faint hover:text-rose-300"
            >
              clear
            </button>
          )}
        </div>

        {groups.length === 0 ? (
          <div className="grid flex-1 place-items-center px-4 py-10 text-center">
            <div>
              <p className="text-3xl opacity-40" aria-hidden>🧺</p>
              <p className="mt-2 text-sm text-fg-faint">
                Type a name above, or tap a category.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
            {groups.map((g) => (
              <div key={g.name} className="mise-pop rounded-xl border border-line bg-paper/70 p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-fg">{g.name}</span>
                  <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-fg-soft">
                    {format(g.total.toFixed(2))}
                  </span>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {g.rows.map(({ it, qty }) => (
                    <li key={it.id} className="flex items-center gap-2">
                      <span aria-hidden className="text-sm">{categoryEmoji(groupOf(it))}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg-soft">
                        {it.name}
                      </span>
                      <input
                        value={qty}
                        onChange={(e) =>
                          onChange(
                            lines.map((l) =>
                              l.item_id === it.id
                                ? { ...l, qty: e.target.value.replace(/[^\d.]/g, "") }
                                : l,
                            ),
                          )
                        }
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`How much ${it.name}`}
                        className="w-16 rounded-lg border border-line-2 bg-glass/5 px-2 py-1 text-center text-sm tabular-nums outline-none focus:border-brand-500"
                      />
                      <span className="w-10 shrink-0 truncate text-[11px] text-fg-faint">
                        {it.unit}
                      </span>
                      {/* Whose it is, changeable here.
                          The rule is chosen-supplier-else-cheapest, and it is
                          right most of the time — but the chef knows when it is
                          not, and this is the row where they are looking at it.
                          Only offered when there is actually a choice. */}
                      {onOverride && (suppliers[it.id] ?? []).length > 1 && (
                        <select
                          value={overrides?.[it.id] ?? ""}
                          onChange={(e) => onOverride(it.id, e.target.value || null)}
                          aria-label={`Who supplies ${it.name} on this order`}
                          className="w-24 shrink-0 rounded-lg border border-line-2 bg-glass/5 px-1.5 py-1 text-[11px] text-fg-soft outline-none focus:border-brand-500"
                        >
                          <option value="">auto</option>
                          {(suppliers[it.id] ?? []).map((v) => (
                            <option key={v.vendor_id} value={v.vendor_id}>
                              {v.vendor_name}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(it.id)}
                        aria-label={`Remove ${it.name}`}
                        className="mise-press shrink-0 rounded-lg px-1.5 py-1 text-fg-faint hover:text-rose-300"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {lines.length > 0 && (
          <div className="mt-2 shrink-0 border-t border-line pt-2.5">
            <div className="flex items-baseline justify-between gap-3">
              {/* The money rolls to its new value as items land. The item
                  count beside it does not — a rolling "6 items" tells you
                  nothing that "6" did not. */}
              <CountUp
                to={grand}
                format={(n) => format(n.toFixed(2))}
                className="font-display text-2xl font-semibold tabular-nums text-fg"
              />
              <span className="text-[11px] text-fg-faint">
                {lines.length} item{lines.length === 1 ? "" : "s"} · {groups.length} supplier
                {groups.length === 1 ? "" : "s"}
              </span>
            </div>
            {/* Exactly one Magnet on the page, on the primary action. It is a
                way of saying "this is the one" — a second would undo the
                first. */}
            {footer && (
              <Magnet padding={60} magnetStrength={6} className="mt-2.5 block">
                {footer}
              </Magnet>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
