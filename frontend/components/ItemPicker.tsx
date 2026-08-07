"use client";

// Chef-friendly item picker: no dropdowns. Items are grouped into category
// tabs (vegetables, meat, spices…), shown as big tappable cards with a live
// stock pill (🟢 in stock / 🟡 low / 🔴 out). Tapping a card adds it to the
// "Your list" tray below, where quantities are entered with kg + g fields for
// weighed items. Used by Purchasing (indents), Recipes (ingredients) and — in
// single-select mode — Price Comparison.
import { useMemo, useState, type ReactNode } from "react";
import type { Item } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { numeric } from "@/lib/sanitize";

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

type StockState = { dot: ReactNode; label: string; cls: string };

/** A clean status dot (replaces the cartoonish 🟢🟡🔴 emoji) — a small solid
    dot with a soft colour halo, used everywhere stock status is shown. */
function statusDot(cls: string): ReactNode {
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full align-middle ${cls}`} />;
}

export function stockState(it: Item): StockState {
  const qty = parseFloat(it.current_stock || "0");
  const min = parseFloat(it.min_stock_level || "0");
  if (qty <= 0)
    return { dot: statusDot("bg-rose-400 ring-2 ring-rose-400/20"), label: "out of stock", cls: "text-rose-300" };
  if (min > 0 && qty <= min)
    return { dot: statusDot("bg-amber-300 ring-2 ring-amber-300/20"), label: "running low", cls: "text-amber-200" };
  return { dot: statusDot("bg-brand-400 ring-2 ring-brand-400/20"), label: "in stock", cls: "text-brand-300" };
}

const OTHER = "Other";

function groupKey(it: Item): string {
  return it.category?.trim() || OTHER;
}

/* Units chefs enter as two boxes (whole + sub-unit): kg→g, litre→ml. Chefs say
   "200 g" / "200 ml", not "0.2 kg" / "0.2 litre", so we split the field. */
export function weighedParts(unit: string): { big: string; sub: string } | null {
  const u = unit.toLowerCase();
  if (u === "kg") return { big: "kg", sub: "g" };
  if (u === "litre" || u === "l") return { big: "litre", sub: "ml" };
  return null;
}

/** Friendly display of a weighed/poured quantity: "1 kg 500 g" / "500 g",
    "1 litre 200 ml" / "200 ml"; anything else stays as-is ("3 piece"). Shared so
    inventory, recipes etc. all read the same way. */
export function fmtQty(quantity: string | number, unit: string): string {
  const parts = weighedParts(unit);
  if (!parts) {
    // Numeric(12,3) comes back as "23.000", and printing it raw gave
    // "have 23.000 pack" beside a tidy "have 17 kg" — it reads as a bug even
    // though the number is right. Trim the trailing zeros a decimal column
    // always carries, and keep any decimals that actually mean something
    // ("1.5 pack" stays 1.5).
    const n = typeof quantity === "number" ? quantity : parseFloat(quantity);
    if (!Number.isFinite(n)) return `${quantity} ${unit}`;
    return `${Number(n.toFixed(3))} ${unit}`;
  }
  const { big, sub } = parts;
  const q = typeof quantity === "number" ? quantity : parseFloat(quantity) || 0;
  const whole = Math.floor(q);
  const small = Math.round((q - whole) * 1000);
  if (whole && small) return `${whole} ${big} ${small} ${sub}`;
  if (whole) return `${whole} ${big}`;
  return `${small} ${sub}`;
}

/** Reusable quantity entry: weighed/poured units (kg→g, litre→ml) get two boxes
    so chefs type "200 g" / "200 ml"; everything else gets a plain decimal field.
    Used by the picker tray, the waste log, inventory min-stock, etc. */
export function QtyInput({
  unit,
  value,
  onChange,
  label,
  plainClassName,
}: {
  unit: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
  /** Override the single-field className (split fields keep their own sizing). */
  plainClassName?: string;
}) {
  const parts = weighedParts(unit);
  const aria = label ?? "Quantity";
  if (!parts) {
    return (
      <input
        value={value}
        onChange={(e) => onChange(numeric(e.target.value))}
        inputMode="decimal"
        placeholder="qty"
        aria-label={aria}
        className={
          plainClassName ??
          "w-20 rounded-lg border border-line-2 bg-glass/5 px-2 py-1.5 text-center text-sm outline-none focus:border-brand-500"
        }
      />
    );
  }
  const { big, sub } = parts;
  const qnum = parseFloat(value) || 0;
  const wholePart = Math.floor(qnum);
  const subPart = Math.round((qnum - wholePart) * 1000);
  const combine = (w: number, s: number) => String(Math.round((w + s / 1000) * 1000) / 1000);
  return (
    <span className="flex items-center gap-1">
      <input
        inputMode="numeric"
        value={wholePart ? String(wholePart) : ""}
        onChange={(e) => onChange(combine(parseInt(e.target.value) || 0, subPart))}
        placeholder={big}
        aria-label={`${aria} ${big}`}
        className="w-14 rounded-lg border border-line-2 bg-glass/5 px-2 py-1.5 text-center text-sm outline-none focus:border-brand-500"
      />
      <span className="text-xs text-fg-faint">{big}</span>
      <input
        inputMode="numeric"
        value={subPart ? String(subPart) : ""}
        onChange={(e) => onChange(combine(wholePart, parseInt(e.target.value) || 0))}
        placeholder={sub}
        aria-label={`${aria} ${sub}`}
        className="w-14 rounded-lg border border-line-2 bg-glass/5 px-2 py-1.5 text-center text-sm outline-none focus:border-brand-500"
      />
      <span className="text-xs text-fg-faint">{sub}</span>
    </span>
  );
}

/* Picker tray row uses the shared QtyInput, plus a pack conversion hint so ordering
   in the base unit is legible ("25 kg ≈ 5 boxes") for items bought in packs. */
function QtyFields({ item, qty, onQty }: { item: Item; qty: string; onQty: (v: string) => void }) {
  const size = parseFloat(item.pack_size || "0");
  const n = parseFloat(qty || "0");
  const packs = item.pack_unit && size > 0 && n > 0 ? n / size : null;
  return (
    <div>
      <QtyInput
        unit={item.unit}
        value={qty}
        onChange={onQty}
        label={`Quantity of ${item.name} (${item.unit})`}
      />
      {item.pack_unit && size > 0 && (
        <p className="mt-0.5 text-[11px] text-indigo-300">
          📦 {packs ? `≈ ${packs < 10 ? packs.toFixed(1) : Math.round(packs)} ${item.pack_unit}${packs === 1 ? "" : "s"}` : `1 ${item.pack_unit} = ${item.pack_size} ${item.unit}`}
        </p>
      )}
    </div>
  );
}

export function ItemPicker({
  items,
  lines,
  onChange,
  emptyHint = "Nothing here yet.",
  lineExtra,
  trayFooter,
  staged = false,
  suppliers,
  dense,
  onOpenDetail,
}: {
  items: Item[];
  lines: PickedLine[];
  onChange: (lines: PickedLine[]) => void;
  emptyHint?: string;
  /** Goes at the bottom of the pinned tray — the submit button belongs WITH the
   *  list it submits, not a scroll below the grid that keeps growing. */
  trayFooter?: ReactNode;
  /** item id -> vendors. When given, each row lists its cheapest few. */
  suppliers?: Record<
    string,
    { vendor_name: string; price_per_unit: string; is_preferred: boolean }[]
  >;
  /** Rows instead of cards — see the note on ItemPickerSingle. Sixty items in
   *  cards is a wall; in rows it is a list. */
  dense?: boolean;
  /** Two stages instead of two columns.
   *
   *  Off (the default) keeps the side-by-side tray, which suits Waste and
   *  stock-take where the list is short and the point is speed. On, the list
   *  gets the WHOLE width and the tray becomes its own stage behind a pinned
   *  bar — which is what Purchasing needs, because a 21rem column could not
   *  hold a quantity, a unit and a supplier per row without an inner scroll
   *  inside an inner scroll.
   *
   *  His rule for this page: kill the split, one thing at a time, full width. */
  staged?: boolean;
  /** Extra controls per tray row (e.g. a supplier picker on Purchasing). */
  lineExtra?: (line: PickedLine, item: Item) => ReactNode;
  /** Open an item's full detail. Adding it to an order and INSPECTING it are
   *  different intents; the tile click still adds. */
  onOpenDetail?: (id: string) => void;
}) {
  const { format } = useCurrency();
  // Which stage a staged picker is showing. Picking is where you start,
  // because an empty tray is not worth a screen.
  const [trayStage, setTrayStage] = useState<"pick" | "tray">("pick");
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

  // What the list is worth so far, and who it is spread across.
  //
  // "4 items" is not a decision — it tells you nothing you did not already
  // know from looking. This is the page where money is actually spent, so the
  // bar carries the money. Priced at the chosen supplier where there is one,
  // the cheapest otherwise, which is the rule ordering itself follows.
  const running = chosen.reduce(
    (acc, { line, item }) => {
      const opts = suppliers?.[item.id] ?? [];
      if (opts.length === 0) return acc;
      // Chosen supplier, else cheapest — the same rule ordering follows, so
      // the figure here matches what the order will actually cost. A per-row
      // override is picked later; this is the estimate before that.
      const pick =
        opts.find((v) => v.is_preferred) ??
        [...opts].sort((a, b) => (parseFloat(a.price_per_unit) || 0) - (parseFloat(b.price_per_unit) || 0))[0];
      const qty = parseFloat(String(line.qty ?? "")) || 0;
      acc.total += (parseFloat(pick.price_per_unit) || 0) * qty;
      acc.vendors.add(pick.vendor_name);
      return acc;
    },
    { total: 0, vendors: new Set<string>() },
  );

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
          className="w-full rounded-xl border border-line-2 bg-glass/5 py-2.5 pl-9 pr-3 text-sm text-fg outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
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
                : "border border-line-2 text-fg-soft hover:bg-glass/5"
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
                  : "border border-line-2 text-fg-soft hover:bg-glass/5"
              }`}
            >
              {categoryEmoji(c.name)} {c.name} ({c.count})
            </button>
          ))}
        </div>
      )}

      {/* Side by side when the tray is small enough to earn a column; two
          full-width stages when it is not. */}
      <div
        className={
          staged
            ? "block"
            : "grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] lg:items-start"
        }
      >
      <div className={staged && trayStage === "tray" ? "hidden" : "contents"}>
      {/* Item cards — key remounts the grid per tab/search so the stagger replays */}
      <div
        key={query ? `q:${query}` : tab}
        className={
          dense
            ? "mise-stagger max-h-[28rem] divide-y divide-line/60 overflow-y-auto rounded-xl border border-line"
            : "mise-stagger grid max-h-[28rem] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3"
        }
      >
        {visible.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-fg-faint">
            No items match{query ? ` “${q.trim()}”` : " this section"}.
          </p>
        )}
        {visible.map((it) => {
          const sel = picked.has(it.id);
          const st = stockState(it);

          if (dense) {
            const rows = suppliers?.[it.id];
            const sorted = rows
              ? [...rows].sort(
                  (a, b) =>
                    (parseFloat(a.price_per_unit) || 0) - (parseFloat(b.price_per_unit) || 0),
                )
              : null;
            return (
              <div
                key={it.id}
                className={`flex w-full items-center gap-2.5 px-3 py-2 transition ${
                  sel ? "bg-brand-400/[0.13]" : "hover:bg-glass/5"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={sel}
                  onClick={() => toggle(it)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span
                    aria-hidden
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded text-[9px] leading-none ${
                      sel ? "bg-brand-500 text-white" : "border border-line-2 text-transparent"
                    }`}
                  >
                    ✓
                  </span>
                  <span aria-hidden className="shrink-0 text-base">
                    {categoryEmoji(groupKey(it))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span
                        className={`truncate text-sm ${sel ? "font-semibold text-fg" : "font-medium text-fg-soft"}`}
                      >
                        {it.name}
                      </span>
                      <span className={`shrink-0 text-[10px] ${st.cls}`}>{st.dot}</span>
                      <span className="shrink-0 text-[10px] text-fg-faint">
                        {fmtQty(it.current_stock, it.unit)}
                      </span>
                    </span>
                    {sorted && sorted.length > 0 && (
                      <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[10.5px] leading-tight">
                        {sorted.slice(0, 3).map((v, vi) => (
                          <span key={v.vendor_name} className="whitespace-nowrap">
                            <span className={v.is_preferred ? "text-brand-300" : "text-fg-faint"}>
                              {v.is_preferred ? "★" : ""}
                              {v.vendor_name}
                            </span>{" "}
                            <span
                              className={`font-mono ${vi === 0 ? "text-emerald-300" : "text-fg-faint"}`}
                            >
                              {format(v.price_per_unit)}
                            </span>
                          </span>
                        ))}
                        {sorted.length > 3 && (
                          <span className="text-[10px] text-fg-faint">+{sorted.length - 3}</span>
                        )}
                      </span>
                    )}
                  </span>
                </button>
                {onOpenDetail && (
                  <button
                    type="button"
                    onClick={() => onOpenDetail(it.id)}
                    aria-label={`See suppliers and prices for ${it.name}`}
                    className="mise-press shrink-0 rounded-lg border border-line-2 px-2 py-1 text-[10px] font-medium text-fg-faint transition hover:border-brand-400/60 hover:text-brand-300"
                  >
                    compare ›
                  </button>
                )}
              </div>
            );
          }

          return (
            <button
              key={it.id}
              type="button"
              aria-pressed={sel}
              onClick={() => toggle(it)}
              className={`mise-feel relative flex flex-col rounded-2xl border p-3 pb-11 text-left transition duration-200 hover:-translate-y-0.5 ${
                sel
                  ? "border-brand-500 bg-brand-400/15 shadow-lg shadow-brand-600/20"
                  : "border-line bg-glass/5 hover:border-line-2 hover:bg-glass/10"
              }`}
            >
              <span
                aria-hidden
                className={`absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full text-[11px] leading-none transition ${
                  sel ? "bg-brand-500 text-white" : "border border-line-2 text-transparent"
                }`}
              >
                ✓
              </span>
              {/* The emoji tile, as on the recipe cards. These grids are scanned,
                  not read, and a picture lands before a word does. */}
              <span
                aria-hidden
                className="mise-neo-raised mb-1.5 grid h-8 w-8 place-items-center rounded-xl text-base"
              >
                {categoryEmoji(groupKey(it))}
              </span>
              <span className="block pr-8 font-display text-sm font-semibold leading-snug text-fg">{it.name}</span>
              {onOpenDetail && (
                // span + role=button: a <button> inside a <button> is invalid
                // HTML and browsers resolve the click unpredictably.
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`See suppliers and prices for ${it.name}`}
                  onClick={(e) => { e.stopPropagation(); onOpenDetail(it.id); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onOpenDetail(it.id);
                    }
                  }}
                  className="absolute bottom-2 right-2 flex cursor-pointer items-center gap-1 rounded-lg border border-line-2 px-2 py-1 text-[10px] font-medium text-fg-faint transition hover:border-brand-400/60 hover:bg-brand-400/10 hover:text-brand-300"
                >
                  compare ›
                </span>
              )}
              <span className={`mt-1.5 block text-xs ${st.cls}`}>
                {st.dot} {st.label}
              </span>
              <span className="mt-0.5 block text-xs text-fg-faint">
                have {fmtQty(it.current_stock, it.unit)}
              </span>

              {/* What it costs, and from whom. Deciding what to order IS
                  deciding what it costs — that number had no business being
                  one click away on the page whose whole job is spending. */}
              {(() => {
                const rows = suppliers?.[it.id];
                if (!rows) return null;
                if (rows.length === 0) {
                  return (
                    <span className="mt-2 block text-[11px] text-amber-300/90">
                      no supplier yet
                    </span>
                  );
                }
                const sorted = [...rows].sort(
                  (a, b) => (parseFloat(a.price_per_unit) || 0) - (parseFloat(b.price_per_unit) || 0),
                );
                const best = parseFloat(sorted[0].price_per_unit) || 0;
                return (
                  <span className="mt-2 block border-t border-line/70 pt-1.5">
                    {sorted.slice(0, 4).map((v, vi) => {
                      const extra = (parseFloat(v.price_per_unit) || 0) - best;
                      return (
                        <span
                          key={v.vendor_name}
                          className="flex items-baseline gap-1.5 text-[11px] leading-relaxed"
                        >
                          <span
                            className={`min-w-0 flex-1 truncate ${
                              v.is_preferred ? "font-medium text-brand-300" : "text-fg-soft"
                            }`}
                          >
                            {v.is_preferred ? "★ " : ""}
                            {v.vendor_name}
                          </span>
                          <span
                            className={`shrink-0 font-mono tabular-nums ${
                              vi === 0 ? "text-emerald-300" : "text-fg-faint"
                            }`}
                          >
                            {format(v.price_per_unit)}
                          </span>
                          {extra > 0.001 && (
                            <span className="shrink-0 text-[9px] text-rose-300/80">
                              +{extra.toFixed(2)}
                            </span>
                          )}
                        </span>
                      );
                    })}
                    {sorted.length > 4 && (
                      <span className="mt-0.5 block text-[10px] text-fg-faint">
                        +{sorted.length - 4} more — open compare
                      </span>
                    )}
                  </span>
                );
              })()}
            </button>
          );
        })}
      </div>

      </div>

      {/* Selected tray — a column beside the grid, or a stage of its own. */}
      <div
        className={`rounded-xl border border-line bg-paper-2/60 p-3 ${
          staged
            ? trayStage === "tray"
              ? "block"
              : "hidden"
            : "lg:sticky lg:top-4"
        }`}
      >
        {staged && (
          <button
            type="button"
            onClick={() => setTrayStage("pick")}
            className="mise-press mb-3 inline-flex items-center gap-2 rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-fg-soft transition hover:border-brand-400/50 hover:text-brand-300"
          >
            <span aria-hidden>‹</span> Add more items
          </button>
        )}
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
          Your list {chosen.length > 0 && `· ${chosen.length} item${chosen.length === 1 ? "" : "s"}`}
        </p>

        {/* What it comes to, and who it is going to.
            Submitting an order is a considered act, so the review stage should
            read like one — the total and the spread stated before the lines,
            not left for somebody to add up in their head. */}
        {staged && trayStage === "tray" && running.total > 0 && (
          <div className="mise-neo-raised mt-2 flex flex-wrap items-baseline justify-between gap-3 rounded-xl px-4 py-3">
            <span className="font-display text-2xl font-semibold tabular-nums text-fg">
              {format(running.total.toFixed(2))}
            </span>
            <span className="text-[11px] text-fg-faint">
              {chosen.length} item{chosen.length === 1 ? "" : "s"} · {running.vendors.size} supplier
              {running.vendors.size === 1 ? "" : "s"}
              <span className="mt-0.5 block">
                priced at your chosen supplier, or the cheapest where none is set
              </span>
            </span>
          </div>
        )}
        {chosen.length === 0 ? (
          <p className="py-3 text-center text-sm text-fg-faint">
            Tap items above to add them here, then enter how much you need.
          </p>
        ) : (
          // No inner scrollbar until the list is genuinely long. A short list
          // inside its own scroll area gave two scrollbars on one screen and a
          // cramped window for two items — the page can just grow instead.
          <ul className={`mt-2 grid grid-cols-1 gap-2 ${
            chosen.length > 3 ? "max-h-[24rem] overflow-y-auto pr-1" : ""
          }`}>
            {chosen.map(({ line, item }) => (
              // The id lets a caller scroll to and ring ONE line — arriving from
              // Inventory should land on that item's supplier row, not the top
              // of the page with the row somewhere below the fold.
              <li
                key={item.id}
                id={`picked-${item.id}`}
                className="mise-pop scroll-mt-24 rounded-lg border border-line bg-paper/80 px-3 py-2"
              >
                {/* Row 1: name + remove. Row 2: quantity controls. Stacking the
                    qty inputs onto their own row keeps them usable on the
                    narrowest phones (no cramping the kg/g fields). */}
                <div className="flex items-start gap-2">
                  <span aria-hidden className="mt-0.5">{categoryEmoji(groupKey(item))}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{item.name}</span>
                    <span className="block text-xs text-fg-faint">
                      {stockState(item).dot} have {fmtQty(item.current_stock, item.unit)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => toggle(item)}
                    aria-label={`Remove ${item.name}`}
                    className="shrink-0 rounded-lg border border-line px-2 py-1 text-sm text-fg-faint hover:bg-rose-400/10 hover:text-rose-300"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
                  <QtyFields item={item} qty={line.qty} onQty={(v) => setQty(item.id, v)} />
                  {!weighedParts(item.unit) && (
                    <span className="text-xs text-fg-faint">{item.unit}</span>
                  )}
                </div>
                {lineExtra && <div className="mt-1.5 pl-7">{lineExtra(line, item)}</div>}
              </li>
            ))}
          </ul>
        )}
        {trayFooter && <div className="mt-3 border-t border-line pt-3">{trayFooter}</div>}
      </div>
      </div>

      {/* The bar that carries you across.
          Always in reach while picking, so the list you are building is never
          out of sight even though it is no longer beside you — and it states
          the count, because "how many have I got" is the only thing you need
          from the tray while you are still choosing. */}
      {staged && trayStage === "pick" && chosen.length > 0 && (
        <div className="sticky bottom-3 z-20 mt-3 flex items-center gap-3 rounded-2xl border border-brand-400/40 bg-paper-2/95 px-4 py-3 shadow-lg shadow-black/30 backdrop-blur">
          <span className="min-w-0 flex-1 text-sm text-fg-soft">
            {running.total > 0 ? (
              <>
                <b className="font-display text-lg tabular-nums text-fg">
                  {format(running.total.toFixed(2))}
                </b>{" "}
                <span className="text-xs">
                  · {chosen.length} item{chosen.length === 1 ? "" : "s"}
                  {running.vendors.size > 0 && (
                    <> across {running.vendors.size} supplier{running.vendors.size === 1 ? "" : "s"}</>
                  )}
                </span>
              </>
            ) : (
              <>
                <b className="text-fg">{chosen.length}</b> item{chosen.length === 1 ? "" : "s"} —
                <span className="text-xs"> add quantities to see the total</span>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => setTrayStage("tray")}
            className="mise-press shrink-0 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Review &amp; submit ›
          </button>
        </div>
      )}
    </div>
  );
}

/* Single-select flavour — same tabs/cards, no tray/quantities. Used where one
   item must be chosen (e.g. Price Comparison). */
export function ItemPickerSingle({
  items,
  value,
  onChange,
  gridCls,
  suppliers,
  dense,
  onCreate,
  onOpenDetail,
}: {
  items: Item[];
  value: string;
  onChange: (id: string) => void;
  /** Column classes for the card grid. A picker sitting in half a page needs
   *  fewer, wider columns than one spanning the whole width. */
  gridCls?: string;
  /** item id -> vendors, cheapest first. When given, each row lists its top
   *  few suppliers inline. Opening a sheet to read two numbers is a lot of
   *  ceremony for two numbers. */
  suppliers?: Record<
    string,
    { vendor_name: string; price_per_unit: string; is_preferred: boolean }[]
  >;
  /** Rows instead of cards.
   *
   *  Cards are for a handful of things you are choosing between. Sixty-one
   *  items in cards is a wall you scroll past, not a list you scan — each one
   *  240px tall to carry four words. Dense rows put the same information in a
   *  fifth of the height, which is the difference between seeing three items
   *  and seeing fifteen. */
  dense?: boolean;
  /** Offered when a search matches nothing. A supplier selling something you
   *  have not stocked yet used to mean leaving for Inventory, creating it, and
   *  finding your way back — and the price you came to enter is gone by then.
   *  Receives what was typed. */
  onCreate?: (name: string) => void;
  /** Open the full detail for an item. When given, each card grows a chevron:
   *  picking an item and INSPECTING it are different intents, and making the
   *  comparison something you scroll to find is what made this page tiring. */
  onOpenDetail?: (id: string) => void;
}) {
  const { format } = useCurrency();
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
          className="w-full rounded-xl border border-line-2 bg-glass/5 py-2.5 pl-9 pr-3 text-sm text-fg outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
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
                : "border border-line-2 text-fg-soft hover:bg-glass/5"
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
                  : "border border-line-2 text-fg-soft hover:bg-glass/5"
              }`}
            >
              {categoryEmoji(c.name)} {c.name} ({c.count})
            </button>
          ))}
        </div>
      )}
      <div
        key={query ? `q:${query}` : tab}
        className={
          dense
            ? "mise-stagger max-h-[32rem] divide-y divide-line/60 overflow-y-auto rounded-xl border border-line"
            : `mise-stagger grid max-h-[30rem] gap-2 overflow-y-auto pr-1 ${
                gridCls ?? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
              }`
        }
      >
        {visible.length === 0 && (
          <div className="col-span-full py-6 text-center">
            <p className="text-sm text-fg-faint">
              No items match{query ? ` “${q.trim()}”` : " this section"}.
            </p>
            {onCreate && query && (
              <button
                type="button"
                onClick={() => onCreate(q.trim())}
                className="mise-press mt-2 rounded-lg border border-brand-400/40 bg-brand-400/10 px-3 py-1.5 text-sm font-medium text-brand-300"
              >
                ＋ Create “{q.trim()}” as a new item
              </button>
            )}
          </div>
        )}
        {visible.map((it) => {
          const sel = value === it.id;
          const st = stockState(it);
          const rows = suppliers?.[it.id];

          if (dense) {
            const sorted = rows
              ? [...rows].sort(
                  (a, b) =>
                    (parseFloat(a.price_per_unit) || 0) - (parseFloat(b.price_per_unit) || 0),
                )
              : null;
            return (
              <button
                key={it.id}
                type="button"
                aria-pressed={sel}
                onClick={() => onChange(it.id)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                  sel ? "bg-brand-400/[0.13]" : "hover:bg-glass/5"
                }`}
              >
                <span aria-hidden className="shrink-0 text-base">
                  {categoryEmoji(groupKey(it))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span
                      className={`truncate text-sm ${sel ? "font-semibold text-fg" : "font-medium text-fg-soft"}`}
                    >
                      {it.name}
                    </span>
                    <span className={`shrink-0 text-[10px] ${st.cls}`}>{st.dot}</span>
                    <span className="shrink-0 text-[10px] text-fg-faint">
                      {fmtQty(it.current_stock, it.unit)}
                    </span>
                  </span>
                  {/* The suppliers, on one line. Everything he asked to see,
                      in the height of a single row rather than a card. */}
                  {sorted && sorted.length > 0 && (
                    <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[10.5px] leading-tight">
                      {sorted.slice(0, 4).map((v, vi) => (
                        <span key={v.vendor_name} className="whitespace-nowrap">
                          <span className={v.is_preferred ? "text-brand-300" : "text-fg-faint"}>
                            {v.is_preferred ? "★" : ""}
                            {v.vendor_name}
                          </span>{" "}
                          <span
                            className={`font-mono ${vi === 0 ? "text-emerald-300" : "text-fg-faint"}`}
                          >
                            {format(v.price_per_unit)}
                          </span>
                        </span>
                      ))}
                      {sorted.length > 4 && (
                        <span className="text-[10px] text-fg-faint">+{sorted.length - 4}</span>
                      )}
                    </span>
                  )}
                  {sorted && sorted.length === 0 && (
                    <span className="mt-0.5 block text-[10.5px] text-amber-300/90">
                      no supplier yet
                    </span>
                  )}
                </span>
                <span
                  aria-hidden
                  className={`shrink-0 text-xs ${sel ? "text-brand-300" : "text-fg-faint"}`}
                >
                  ›
                </span>
              </button>
            );
          }

          return (
            <button
              key={it.id}
              type="button"
              aria-pressed={sel}
              onClick={() => onChange(it.id)}
              className={`mise-feel relative flex flex-col rounded-2xl border p-3 pb-11 text-left transition duration-200 hover:-translate-y-0.5 ${
                sel
                  ? "border-brand-500 bg-brand-400/15 shadow-lg shadow-brand-600/20"
                  : "border-line bg-glass/5 hover:border-line-2 hover:bg-glass/10"
              }`}
            >
              <span
                aria-hidden
                className={`absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full text-[11px] leading-none transition ${
                  sel ? "bg-brand-500 text-white" : "border border-line-2 text-transparent"
                }`}
              >
                ✓
              </span>
              {/* An emoji tile, like the recipe cards: a picture is recognised
                  before a word is read, and these grids are scanned not read. */}
              <span
                aria-hidden
                className="mise-neo-raised mb-1.5 grid h-8 w-8 place-items-center rounded-xl text-base"
              >
                {categoryEmoji(groupKey(it))}
              </span>
              <span className="block pr-8 font-display text-sm font-semibold leading-snug text-fg">{it.name}</span>
              {onOpenDetail && (
                // A span, not a nested <button> — a button inside a button is
                // invalid HTML and browsers resolve it unpredictably.
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`See all supplier prices for ${it.name}`}
                  onClick={(e) => { e.stopPropagation(); onOpenDetail(it.id); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onOpenDetail(it.id);
                    }
                  }}
                  className="absolute bottom-2 right-2 grid h-6 w-6 cursor-pointer place-items-center rounded-lg border border-line-2 text-xs text-fg-faint transition hover:border-brand-400/60 hover:bg-brand-400/10 hover:text-brand-300"
                >
                  ›
                </span>
              )}
              <span className={`mt-1.5 block text-xs ${st.cls}`}>
                {st.dot} {st.label}
              </span>
              <span className="mt-0.5 block text-xs text-fg-faint">
                have {fmtQty(it.current_stock, it.unit)}
              </span>
              {/* Who sells it and for how much — the question this page exists
                  to answer, on the card rather than one click away. Cheapest
                  first, four at most; the rest sit behind "compare". */}
              {(() => {
                const rows = suppliers?.[it.id];
                if (!rows) {
                  // No supplier data supplied by the caller: fall back to the
                  // single best vendor the item itself carries.
                  return it.best_vendor ? (
                    <span
                      className={`mt-1 block truncate text-xs ${it.best_vendor_chosen ? "text-brand-300" : "text-amber-300"}`}
                    >
                      {it.best_vendor_chosen ? "★ " : ""}
                      {it.best_vendor}
                      {it.best_vendor_price ? ` · ${format(it.best_vendor_price)}` : ""}
                    </span>
                  ) : (
                    <span className="mt-1 block text-xs text-amber-300">no supplier yet</span>
                  );
                }
                if (rows.length === 0) {
                  return <span className="mt-1 block text-xs text-amber-300">no supplier yet</span>;
                }
                const best = parseFloat(rows[0].price_per_unit) || 0;
                return (
                  <span className="mt-2 block border-t border-line/70 pt-1.5">
                    {rows.slice(0, 4).map((v, vi) => {
                      const extra = (parseFloat(v.price_per_unit) || 0) - best;
                      return (
                        <span
                          key={v.vendor_name}
                          className="flex items-baseline gap-1.5 text-[11px] leading-relaxed"
                        >
                          <span
                            className={`min-w-0 flex-1 truncate ${
                              v.is_preferred ? "font-medium text-brand-300" : "text-fg-soft"
                            }`}
                          >
                            {v.is_preferred ? "★ " : ""}
                            {v.vendor_name}
                          </span>
                          <span
                            className={`shrink-0 font-mono tabular-nums ${
                              vi === 0 ? "text-emerald-300" : "text-fg-faint"
                            }`}
                          >
                            {format(v.price_per_unit)}
                          </span>
                          {extra > 0.001 && (
                            <span className="shrink-0 text-[9px] text-rose-300/80">
                              +{extra.toFixed(2)}
                            </span>
                          )}
                        </span>
                      );
                    })}
                    {rows.length > 4 && (
                      <span className="mt-0.5 block text-[10px] text-fg-faint">
                        +{rows.length - 4} more — open compare
                      </span>
                    )}
                  </span>
                );
              })()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
