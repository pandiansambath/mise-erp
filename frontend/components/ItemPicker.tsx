"use client";

// Chef-friendly item picker: no dropdowns. Items are grouped into category
// tabs (vegetables, meat, spices…), shown as big tappable cards with a live
// stock pill (🟢 in stock / 🟡 low / 🔴 out). Tapping a card adds it to the
// "Your list" tray below, where quantities are entered with kg + g fields for
// weighed items. Used by Purchasing (indents), Recipes (ingredients) and — in
// single-select mode — Price Comparison.
import { useMemo, useState, type ReactNode } from "react";
import type { Item } from "@/lib/api";

export type PickedLine = { item_id: string; qty: string };

/* Best-effort emoji for a category name, so the tabs read at a glance. */
export function categoryEmoji(name: string): string {
  const n = name.toLowerCase();
  if (/veg/.test(n)) return "🥬";
  if (/fruit/.test(n)) return "🍎";
  if (/meat|chicken|mutton|lamb|beef|pork/.test(n)) return "🍗";
  if (/fish|sea/.test(n)) return "🐟";
  if (/dairy|milk|cheese|paneer/.test(n)) return "🥛";
  if (/spice|masala|herb/.test(n)) return "🌶️";
  if (/grain|rice|flour|atta|pulse|lentil|dal/.test(n)) return "🌾";
  if (/oil|ghee|fat/.test(n)) return "🫒";
  if (/beverage|drink|juice|tea|coffee/.test(n)) return "🧃";
  if (/pack|box|container|bag/.test(n)) return "📦";
  if (/clean|chemical|soap/.test(n)) return "🧽";
  if (/bread|bakery|bake/.test(n)) return "🥖";
  if (/egg/.test(n)) return "🥚";
  if (/frozen|ice/.test(n)) return "🧊";
  if (/sauce|paste|tin|can/.test(n)) return "🥫";
  if (/dry|nut/.test(n)) return "🥜";
  return "🧺";
}

type StockState = { dot: string; label: string; cls: string };

export function stockState(it: Item): StockState {
  const qty = parseFloat(it.current_stock || "0");
  const min = parseFloat(it.min_stock_level || "0");
  if (qty <= 0) return { dot: "🔴", label: "out of stock", cls: "text-rose-300" };
  if (min > 0 && qty <= min) return { dot: "🟡", label: "running low", cls: "text-amber-200" };
  return { dot: "🟢", label: "in stock", cls: "text-brand-300" };
}

const OTHER = "Other";

function groupKey(it: Item): string {
  return it.category?.trim() || OTHER;
}

/* kg items get kg + g fields (chefs think in grams); everything else a plain qty. */
function QtyFields({
  item,
  qty,
  onQty,
}: {
  item: Item;
  qty: string;
  onQty: (v: string) => void;
}) {
  const isKg = item.unit.toLowerCase() === "kg";
  if (!isKg) {
    return (
      <input
        value={qty}
        onChange={(e) => onQty(e.target.value)}
        inputMode="decimal"
        placeholder="qty"
        aria-label={`Quantity of ${item.name} (${item.unit})`}
        className="w-20 rounded-lg border border-line-2 bg-white/5 px-2 py-1.5 text-center text-sm outline-none focus:border-brand-500"
      />
    );
  }
  const qnum = parseFloat(qty) || 0;
  const kgPart = Math.floor(qnum);
  const gPart = Math.round((qnum - kgPart) * 1000);
  const combine = (kg: number, g: number) => String(Math.round((kg + g / 1000) * 1000) / 1000);
  return (
    <span className="flex items-center gap-1">
      <input
        inputMode="numeric"
        value={kgPart ? String(kgPart) : ""}
        onChange={(e) => onQty(combine(parseInt(e.target.value) || 0, gPart))}
        placeholder="kg"
        aria-label={`${item.name} kilograms`}
        className="w-14 rounded-lg border border-line-2 bg-white/5 px-2 py-1.5 text-center text-sm outline-none focus:border-brand-500"
      />
      <span className="text-xs text-fg-faint">kg</span>
      <input
        inputMode="numeric"
        value={gPart ? String(gPart) : ""}
        onChange={(e) => onQty(combine(kgPart, parseInt(e.target.value) || 0))}
        placeholder="g"
        aria-label={`${item.name} grams`}
        className="w-14 rounded-lg border border-line-2 bg-white/5 px-2 py-1.5 text-center text-sm outline-none focus:border-brand-500"
      />
      <span className="text-xs text-fg-faint">g</span>
    </span>
  );
}

export function ItemPicker({
  items,
  lines,
  onChange,
  emptyHint = "Nothing here yet.",
  lineExtra,
}: {
  items: Item[];
  lines: PickedLine[];
  onChange: (lines: PickedLine[]) => void;
  emptyHint?: string;
  /** Extra controls per tray row (e.g. a supplier picker on Purchasing). */
  lineExtra?: (line: PickedLine, item: Item) => ReactNode;
}) {
  const [tab, setTab] = useState<string>("ALL");
  const [q, setQ] = useState("");

  const categories = useMemo(() => {
    const set = new Map<string, number>();
    for (const it of items) set.set(groupKey(it), (set.get(groupKey(it)) ?? 0) + 1);
    const names = [...set.keys()].sort((a, b) =>
      a === OTHER ? 1 : b === OTHER ? -1 : a.localeCompare(b)
    );
    return names.map((n) => ({ name: n, count: set.get(n)! }));
  }, [items]);

  const query = q.trim().toLowerCase();
  const visible = items.filter((it) => {
    if (query) return it.name.toLowerCase().includes(query);
    return tab === "ALL" || groupKey(it) === tab;
  });

  const picked = new Map(lines.map((l) => [l.item_id, l] as const));
  const chosen = lines
    .map((l) => ({ line: l, item: items.find((it) => it.id === l.item_id) }))
    .filter((x): x is { line: PickedLine; item: Item } => Boolean(x.item));

  function toggle(it: Item) {
    if (picked.has(it.id)) onChange(lines.filter((l) => l.item_id !== it.id));
    else onChange([...lines, { item_id: it.id, qty: "" }]);
  }

  function setQty(id: string, qty: string) {
    onChange(lines.map((l) => (l.item_id === id ? { ...l, qty } : l)));
  }

  if (items.length === 0) {
    return <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">{emptyHint}</p>;
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint">🔍</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search any item…"
          aria-label="Search items"
          className="w-full rounded-xl border border-line-2 bg-white/5 py-2.5 pl-9 pr-3 text-sm text-fg outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
        />
      </div>

      {/* Category tabs */}
      {!query && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Item categories">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ALL"}
            onClick={() => setTab("ALL")}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              tab === "ALL"
                ? "bg-brand-600 text-white shadow-lg shadow-brand-600/25"
                : "border border-line-2 text-fg-soft hover:bg-white/5"
            }`}
          >
            🧑‍🍳 All ({items.length})
          </button>
          {categories.map((c) => (
            <button
              key={c.name}
              type="button"
              role="tab"
              aria-selected={tab === c.name}
              onClick={() => setTab(c.name)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                tab === c.name
                  ? "bg-brand-600 text-white shadow-lg shadow-brand-600/25"
                  : "border border-line-2 text-fg-soft hover:bg-white/5"
              }`}
            >
              {categoryEmoji(c.name)} {c.name} ({c.count})
            </button>
          ))}
        </div>
      )}

      {/* Item cards — key remounts the grid per tab/search so the stagger replays */}
      <div
        key={query ? `q:${query}` : tab}
        className="mise-stagger grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4"
      >
        {visible.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-fg-faint">
            No items match{query ? ` “${q.trim()}”` : " this section"}.
          </p>
        )}
        {visible.map((it) => {
          const sel = picked.has(it.id);
          const st = stockState(it);
          return (
            <button
              key={it.id}
              type="button"
              aria-pressed={sel}
              onClick={() => toggle(it)}
              className={`rounded-xl border p-3 text-left transition duration-200 ${
                sel
                  ? "border-brand-500 bg-brand-400/15 shadow-lg shadow-brand-600/20"
                  : "border-line bg-white/5 hover:border-line-2 hover:bg-white/10"
              }`}
            >
              <span className="flex items-start justify-between gap-1">
                <span className="text-sm font-medium text-fg">{it.name}</span>
                <span
                  aria-hidden
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs transition ${
                    sel ? "bg-brand-500 text-white" : "border border-line-2 text-transparent"
                  }`}
                >
                  ✓
                </span>
              </span>
              <span className={`mt-1.5 block text-xs ${st.cls}`}>
                {st.dot} {st.label}
              </span>
              <span className="mt-0.5 block text-xs text-fg-faint">
                have {it.current_stock} {it.unit}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected tray */}
      <div className="rounded-xl border border-line bg-paper-2/60 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
          Your list {chosen.length > 0 && `· ${chosen.length} item${chosen.length === 1 ? "" : "s"}`}
        </p>
        {chosen.length === 0 ? (
          <p className="py-3 text-center text-sm text-fg-faint">
            Tap items above to add them here, then enter how much you need.
          </p>
        ) : (
          <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
            {chosen.map(({ line, item }) => (
              <li key={item.id} className="mise-pop rounded-lg border border-line bg-paper/80 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span aria-hidden>{categoryEmoji(groupKey(item))}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{item.name}</span>
                    <span className="block text-xs text-fg-faint">
                      {stockState(item).dot} have {item.current_stock} {item.unit}
                    </span>
                  </span>
                  <QtyFields item={item} qty={line.qty} onQty={(v) => setQty(item.id, v)} />
                  {item.unit.toLowerCase() !== "kg" && (
                    <span className="text-xs text-fg-faint">{item.unit}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(item)}
                    aria-label={`Remove ${item.name}`}
                    className="rounded-lg border border-line px-2 py-1 text-sm text-fg-faint hover:bg-rose-400/10 hover:text-rose-300"
                  >
                    ✕
                  </button>
                </div>
                {lineExtra && <div className="mt-1.5 pl-7">{lineExtra(line, item)}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* Single-select flavour — same tabs/cards, no tray/quantities. Used where one
   item must be chosen (e.g. Price Comparison). */
export function ItemPickerSingle({
  items,
  value,
  onChange,
}: {
  items: Item[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [tab, setTab] = useState<string>("ALL");
  const [q, setQ] = useState("");

  const categories = useMemo(() => {
    const set = new Map<string, number>();
    for (const it of items) set.set(groupKey(it), (set.get(groupKey(it)) ?? 0) + 1);
    const names = [...set.keys()].sort((a, b) =>
      a === OTHER ? 1 : b === OTHER ? -1 : a.localeCompare(b)
    );
    return names.map((n) => ({ name: n, count: set.get(n)! }));
  }, [items]);

  const query = q.trim().toLowerCase();
  const visible = items.filter((it) => {
    if (query) return it.name.toLowerCase().includes(query);
    return tab === "ALL" || groupKey(it) === tab;
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint">🔍</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search any item…"
          aria-label="Search items"
          className="w-full rounded-xl border border-line-2 bg-white/5 py-2.5 pl-9 pr-3 text-sm text-fg outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
        />
      </div>
      {!query && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Item categories">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ALL"}
            onClick={() => setTab("ALL")}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              tab === "ALL"
                ? "bg-brand-600 text-white shadow-lg shadow-brand-600/25"
                : "border border-line-2 text-fg-soft hover:bg-white/5"
            }`}
          >
            🧑‍🍳 All ({items.length})
          </button>
          {categories.map((c) => (
            <button
              key={c.name}
              type="button"
              role="tab"
              aria-selected={tab === c.name}
              onClick={() => setTab(c.name)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                tab === c.name
                  ? "bg-brand-600 text-white shadow-lg shadow-brand-600/25"
                  : "border border-line-2 text-fg-soft hover:bg-white/5"
              }`}
            >
              {categoryEmoji(c.name)} {c.name} ({c.count})
            </button>
          ))}
        </div>
      )}
      <div
        key={query ? `q:${query}` : tab}
        className="mise-stagger grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4"
      >
        {visible.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-fg-faint">
            No items match{query ? ` “${q.trim()}”` : " this section"}.
          </p>
        )}
        {visible.map((it) => {
          const sel = value === it.id;
          const st = stockState(it);
          return (
            <button
              key={it.id}
              type="button"
              aria-pressed={sel}
              onClick={() => onChange(it.id)}
              className={`rounded-xl border p-3 text-left transition duration-200 ${
                sel
                  ? "border-brand-500 bg-brand-400/15 shadow-lg shadow-brand-600/20"
                  : "border-line bg-white/5 hover:border-line-2 hover:bg-white/10"
              }`}
            >
              <span className="flex items-start justify-between gap-1">
                <span className="text-sm font-medium text-fg">{it.name}</span>
                <span
                  aria-hidden
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs transition ${
                    sel ? "bg-brand-500 text-white" : "border border-line-2 text-transparent"
                  }`}
                >
                  ✓
                </span>
              </span>
              <span className={`mt-1.5 block text-xs ${st.cls}`}>
                {st.dot} {st.label}
              </span>
              <span className="mt-0.5 block text-xs text-fg-faint">
                {it.unit} · have {it.current_stock}
              </span>
              {it.best_vendor ? (
                <span className="mt-1 block truncate text-xs text-brand-300">★ {it.best_vendor}</span>
              ) : (
                <span className="mt-1 block text-xs text-amber-300">no supplier yet</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
