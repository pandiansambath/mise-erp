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

/** What a supplier's price buys, named: "bottle", or the base unit. */
export function levelName(item: Item, levelId?: string | null): string {
  if (!levelId) return item.unit;
  return (item.pack_levels ?? []).find((l) => l.id === levelId)?.name ?? item.unit;
}

/** The price of ONE base unit, whatever size the supplier happens to quote. */
export function pricePerBase(item: Item, sup?: SupplierOption | null): number {
  if (!sup) return 0;
  const price = parseFloat(sup.price_per_unit) || 0;
  const size = baseSizeOf(item, sup.pack_level_id);
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
  for (const lv of item.pack_levels ?? []) {
    const size = parseFloat(lv.base_size) || 0;
    if (size <= 0) continue;
    out.push({
      label: lv.name,
      price: perBase * size,
      note: `${tidy(size)} ${item.unit}`,
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
export function orderSizes(item: Item): { id: string | null; name: string; base: number }[] {
  return [
    { id: null, name: item.unit, base: 1 },
    ...(item.pack_levels ?? []).map((lv: PackLevel) => ({
      id: lv.id,
      name: lv.name,
      base: parseFloat(lv.base_size) || 1,
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
export function stockInPacks(item: Item, qty?: string | number): string {
  const levels = item.pack_levels ?? [];
  if (!levels.length) return "";
  let left = typeof qty === "number" ? qty : parseFloat(String(qty ?? item.current_stock)) || 0;
  if (left <= 0) return "";

  // Biggest size first, so it reads "1 box 2 packets" rather than "302 packets".
  const big = [...levels].sort(
    (a, b) => (parseFloat(b.base_size) || 0) - (parseFloat(a.base_size) || 0),
  );
  const parts: string[] = [];
  for (const lv of big) {
    const size = parseFloat(lv.base_size) || 0;
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
