// Saying what a price actually buys.
//
// His complaint, and he is right that it is a correctness problem rather than a
// polish one:
//
//   "here that leomon3 is showing as 30 per piece... actually it should be
//    1 per piece and 30 per bottle, like this it need to show clearly"
//
// A supplier quotes £30 for a BOTTLE. A bottle is 30 pieces. So a piece costs
// £1. Printing "£30 per piece" is not a rounding difference — it is off by
// thirtyfold, and it is the number somebody uses to decide whether an order is
// affordable.
//
// One helper, used by every screen that shows a price, so the four of them
// cannot drift into saying four different things.

import type { Item, PackLevel, SupplierOption } from "@/lib/api";

/** 1500 -> "1500", 1.5 -> "1.5". Never 1E+3. */
export function tidy(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 1000) / 1000);
}

/** How many base units one of this level is. Falls back to 1 (the base unit). */
export function baseSizeOf(item: Item, levelId?: string | null): number {
  if (!levelId) return 1;
  const lv = (item.pack_levels ?? []).find((l) => l.id === levelId);
  return lv ? parseFloat(lv.base_size) || 1 : 1;
}

/** How big THIS supplier's pack is.
 *
 *  "Some vendor will have 1 bottle = 30 piece, some vendor will have 1 bottle =
 *   20 piece — how are we gonna handle this confusion?"
 *
 *  By letting the supplier say so. Their own size wins, because the person
 *  opening the delivery is opening their bottle, not the item's idea of one.
 */
export function supplierPackSize(item: Item, sup?: SupplierOption | null): number {
  if (!sup) return 1;
  const own = parseFloat(sup.pack_size_override ?? "");
  if (Number.isFinite(own) && own > 0) return own;
  return baseSizeOf(item, sup.pack_level_id);
}

/** What a supplier's price buys, named: "bottle", or the base unit. */
export function levelName(item: Item, levelId?: string | null): string {
  if (!levelId) return item.unit;
  return (item.pack_levels ?? []).find((l) => l.id === levelId)?.name ?? item.unit;
}

/** The price of ONE base unit, whatever size the supplier happens to quote. */
export function pricePerBase(item: Item, sup?: SupplierOption | null): number {
  if (!sup) return 0;
  const price = parseFloat(sup.price_per_unit) || 0;
  const size = supplierPackSize(item, sup);
  return size > 0 ? price / size : 0;
}

export type PriceLine = { label: string; price: number; note?: string };

/**
 * Every size this item can be bought in, priced — smallest first.
 *
 *   1 piece    £1.00
 *   1 bottle   £30.00     30 pieces
 *
 * The base unit is always first even when the supplier quotes a bottle, because
 * "what does one of the things I actually cook with cost" is the question the
 * kitchen asks. Everything above it is derived from the chain, so the numbers
 * cannot disagree with each other.
 */
export function priceLines(item: Item, sup?: SupplierOption | null): PriceLine[] {
  const perBase = pricePerBase(item, sup);
  const out: PriceLine[] = [{ label: item.unit, price: perBase }];
  const own = parseFloat(sup?.pack_size_override ?? "");
  const hasOwn = Number.isFinite(own) && own > 0;

  for (const lv of item.pack_levels ?? []) {
    // When this supplier has said their own pack size, the level they SELL in
    // takes it. Otherwise two suppliers both saying "bottle" would print the
    // same size while meaning different things — which is the confusion he
    // spotted, and it is worth ten pieces a delivery.
    const isTheirs = hasOwn && lv.id === sup?.pack_level_id;
    const size = isTheirs ? own : parseFloat(lv.base_size) || 0;
    if (size <= 0) continue;
    out.push({
      label: lv.name,
      price: perBase * size,
      note: `${tidy(size)} ${item.unit}${isTheirs ? " at this supplier" : ""}`,
    });
  }
  return out;
}

/** The same thing as one line of prose, for somewhere a list will not fit.
 *
 *    "1 piece £1.00 · 1 bottle £30.00 (30 pieces)"
 */
export function priceSummary(
  item: Item,
  sup: SupplierOption | null | undefined,
  money: (n: string | number) => string,
): string {
  return priceLines(item, sup)
    .map((l) => `1 ${l.label} ${money(l.price.toFixed(2))}${l.note ? ` (${l.note})` : ""}`)
    .join("  ·  ");
}

/** Plain English for the chain alone, no prices: "1 bottle = 30 piece". */
export function chainSummary(item: Item): string[] {
  const levels = item.pack_levels ?? [];
  return levels
    .map((lv, i) => {
      const size = parseFloat(lv.base_size) || 0;
      const parts = [`1 ${lv.name}`];
      for (let k = i - 1; k >= 0; k--) {
        const below = parseFloat(levels[k].base_size) || 0;
        if (below > 0) parts.push(`${tidy(size / below)} ${levels[k].name}`);
      }
      parts.push(`${tidy(size)} ${item.unit}`);
      return parts.join(" = ");
    })
    .reverse();
}

/** Sizes you can order this item in — the base unit, then the chain.
 *  `levelId` of null means the base unit. */
export function orderSizes(
  item: Item,
  // WHOSE box. Without this the order sheet said "1 box (100 kg at this
  // supplier)" in its price panel and converted the very same box at the
  // item's 10 kg — so ordering one box priced 10 kg and charged £100 where the
  // supplier wanted £1,000. Two halves of one popup, disagreeing tenfold.
  sup?: SupplierOption | null,
): { id: string | null; name: string; base: number }[] {
  return [
    { id: null, name: item.unit, base: 1 },
    ...(item.pack_levels ?? []).map((lv: PackLevel) => ({
      id: lv.id,
      name: lv.name,
      base:
        sup && sup.pack_level_id === lv.id
          ? supplierPackSize(item, sup)
          : parseFloat(lv.base_size) || 1,
    })),
  ];
}

/**
 * What you have, said in the sizes you buy it in.
 *
 *   "we show stock like we have 1 piece of lemon — so even if we buy 1 bottle
 *    we also show 30 pieces of lemon. Instead shall we show like 1 piece, as a
 *    bottle can have 30..."
 *
 * Stock is counted in the base unit and has to stay that way — recipes take
 * grams, not fractions of a box, and a kitchen cannot cook with "0.6 cases".
 * What was missing is the translation. 45 pieces is a bottle and 15 spare, and
 * that is the sentence someone standing in a store room actually thinks in.
 *
 * Returns "" when there is nothing to add — no chain, or less than one pack.
 */
export type PackSizes = {
  /** The rung, e.g. "box". */
  name: string;
  /** The one size everybody who sells this rung agrees on, or null if they don't. */
  agreed: number | null;
  /** Every distinct size, biggest first, with who quotes it. */
  spread: { size: number; vendors: string[] }[];
};

/**
 * What "1 box" actually means, once you ask everybody who sells one.
 *
 * His question, and there is no honest way around it:
 *
 *   "if 3 vendors have different box — 1 box 100 kg, 1 box 5 kg, 1 box 20 kg —
 *    all the same item but different vendor... now in inventory, how are you
 *    confidently showing 1 box = 50 kg? here we need to think and show in UI."
 *
 * We were showing the ITEM's stored size as though it were the truth. It is
 * only the size whoever created the rung happened to use. Once suppliers
 * disagree there IS no single box, and printing one is the same mistake as the
 * old per-unit price: a confident number that nobody can act on.
 *
 * So this reports the disagreement instead of hiding it, and the screens decide
 * what to say. Pass the suppliers who price the item; pass one supplier on that
 * supplier's own page, where the answer is never ambiguous.
 */
export function packSizes(item: Item, suppliers?: SupplierOption[] | null): PackSizes[] {
  const levels = item.pack_levels ?? [];
  if (!levels.length) return [];
  const rows = suppliers ?? [];

  return levels.map((lv) => {
    const bySize = new Map<number, string[]>();
    for (const s of rows) {
      if (s.pack_level_id !== lv.id) continue;
      const own = parseFloat(s.pack_size_override ?? "");
      const size = Number.isFinite(own) && own > 0 ? own : parseFloat(lv.base_size) || 0;
      if (size <= 0) continue;
      bySize.set(size, [...(bySize.get(size) ?? []), s.vendor_name]);
    }
    // Nobody prices this rung: the item's own size is all we have, and it is
    // not contradicted by anyone.
    if (bySize.size === 0) {
      const own = parseFloat(lv.base_size) || 0;
      return { name: lv.name, agreed: own > 0 ? own : null, spread: [] };
    }
    const spread = [...bySize.entries()]
      .map(([size, vendors]) => ({ size, vendors }))
      .sort((a, b) => b.size - a.size);
    return {
      name: lv.name,
      agreed: spread.length === 1 ? spread[0].size : null,
      spread,
    };
  });
}

/**
 * "a box is 100 kg from Rudra, 20 kg from Exotic, 5 kg from Farm2Land"
 *
 * Returns "" when everybody agrees — there is nothing to warn about, and a
 * notice that fires when nothing is wrong is a notice people stop reading.
 */
export function packDisagreement(
  item: Item,
  suppliers?: SupplierOption[] | null,
): string {
  const parts: string[] = [];
  for (const p of packSizes(item, suppliers)) {
    if (p.agreed !== null || p.spread.length < 2) continue;
    const each = p.spread.map((s) => `${tidy(s.size)} ${item.unit} from ${s.vendors.join(", ")}`);
    parts.push(`a ${p.name} is ${each.join(" · ")}`);
  }
  return parts.join(" — ");
}

export function stockInPacks(
  item: Item,
  qty?: string | number,
  // When given, a rung whose size the suppliers DISAGREE about is left out of
  // the count entirely. "7 boxes" is not a rounding error when a box could be
  // 100 kg or 5 kg — it is a made-up number.
  suppliers?: SupplierOption[] | null,
): string {
  const ambiguous = new Set(
    suppliers ? packSizes(item, suppliers).filter((p) => p.agreed === null).map((p) => p.name) : [],
  );
  const sized = new Map(
    suppliers
      ? packSizes(item, suppliers)
          .filter((p) => p.agreed !== null)
          .map((p) => [p.name, p.agreed as number])
      : [],
  );
  const levels = (item.pack_levels ?? []).filter((lv) => !ambiguous.has(lv.name));
  return stockInPacksFrom(item, levels, qty, sized);
}

function stockInPacksFrom(
  item: Item,
  levels: NonNullable<Item["pack_levels"]>,
  qty?: string | number,
  sized?: Map<string, number>,
): string {
  if (!levels.length) return "";
  let left = typeof qty === "number" ? qty : parseFloat(String(qty ?? item.current_stock)) || 0;
  if (left <= 0) return "";

  // The size the SUPPLIERS agree on wins over the item's stored one — they are
  // the ones filling the box.
  const sizeOf = (lv: { name: string; base_size: string }) =>
    sized?.get(lv.name) ?? parseFloat(lv.base_size) ?? 0;

  // Biggest size first, so it reads "1 box 2 packets" rather than "302 packets".
  const big = [...levels].sort((a, b) => (sizeOf(b) || 0) - (sizeOf(a) || 0));
  const parts: string[] = [];
  for (const lv of big) {
    const size = sizeOf(lv) || 0;
    if (size <= 0) continue;
    const n = Math.floor(left / size);
    if (n >= 1) {
      parts.push(`${n} ${lv.name}${n === 1 ? "" : "s"}`);
      left -= n * size;
    }
  }
  if (!parts.length) return "";
  // Round the remainder the way the rest of the app does, so "0.9999 piece"
  // never appears from floating-point drift.
  const rest = Math.round(left * 1000) / 1000;
  if (rest > 0) parts.push(`${tidy(rest)} ${item.unit}`);
  return parts.join(" + ");
}
