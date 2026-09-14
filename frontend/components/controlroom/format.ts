// Control Room number formatting.
//
// AI spend is billed in USD (the model provider's currency) no matter which
// currency a hotel trades in — the app everywhere else is GBP-first via
// useCurrency(), but that hook would silently relabel a dollar cost as a
// pound one. This is the one place in the Control Room a number is money, so
// it gets its own tiny formatter instead.

export function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact integers for a dense table — 12,345 stays 12,345, no abbreviation. */
export function n(v: number): string {
  return v.toLocaleString("en-GB");
}

/** "3d ago" / "today" / "never" — the console's own idiom, reused everywhere
 *  a "last seen" figure appears so every page speaks the same way. */
export function agoDays(iso: string | null | undefined, nowTs: number): string {
  if (!iso) return "never";
  const days = Math.max(0, Math.floor((nowTs - new Date(iso).getTime()) / 86400000));
  return days === 0 ? "today" : `${days}d ago`;
}
