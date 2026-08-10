// How a quantity is written down.
//
// A real user's words: "Quantity should be in grams — no need like 1.5000,
// want like 1.5 kilo". Both halves of that are true and they are separate
// faults:
//
//   1.5000   the database column is Numeric(12,3), so every quantity arrives
//            as "1.500" and fourteen places in the app printed it raw. The
//            shared formatter already trimmed this; those places never called
//            it. That is the actual bug.
//
//   grams    0.25 kg is a number a spreadsheet writes. A chef says 250 g. When
//            a weighed quantity falls below one whole unit, say it in the
//            small unit instead of putting a zero in front of it.
//
// One function, one home. It used to live in components/ItemPicker.tsx, which
// is why half the app never found it.

/** Units a kitchen splits in two: kg→g, litre→ml. */
export function weighedParts(unit: string): { big: string; sub: string; per: number } | null {
  const u = unit.trim().toLowerCase();
  if (u === "kg" || u === "kilo" || u === "kilogram") return { big: "kg", sub: "g", per: 1000 };
  if (u === "litre" || u === "liter" || u === "l") return { big: "litre", sub: "ml", per: 1000 };
  return null;
}

export type QtyStyle = "compact" | "split";

/** Trim the trailing zeros a decimal column always carries, keeping the
 *  decimals that actually mean something. 1.500 → 1.5, 23.000 → 23. */
export function trimZeros(n: number, places = 3): number {
  return Number(n.toFixed(places));
}

/**
 * Write a quantity the way a person would say it.
 *
 *   fmtQty("1.500", "kg")              "1.5 kg"
 *   fmtQty("0.250", "kg")              "250 g"          below one, use grams
 *   fmtQty("1.500", "kg", "split")     "1 kg 500 g"
 *   fmtQty("23.000", "pack")           "23 pack"
 *   fmtQty("3.000", "piece")           "3 piece"
 *
 * `style` defaults to compact — his example was "1.5 kilo", not "1 kg 500 g".
 * Split is kept because it genuinely reads better on an order sheet, and it is
 * what the picker has always used.
 */
export function fmtQty(
  quantity: string | number | null | undefined,
  unit: string,
  style: QtyStyle = "compact",
  places = 3,
): string {
  const n = typeof quantity === "number" ? quantity : parseFloat(String(quantity ?? ""));
  if (!Number.isFinite(n)) return `${quantity ?? "—"} ${unit}`.trim();

  const parts = weighedParts(unit);
  if (!parts) return `${trimZeros(n, places)} ${unit}`;

  const { big, sub, per } = parts;

  if (style === "split") {
    const whole = Math.floor(n);
    const small = Math.round((n - whole) * per);
    if (whole && small) return `${whole} ${big} ${small} ${sub}`;
    if (whole) return `${whole} ${big}`;
    return `${small} ${sub}`;
  }

  // Under one whole unit, say it small: 0.25 kg is 250 g. A leading "0." is
  // where a decimal starts looking like a typo.
  if (n !== 0 && Math.abs(n) < 1) return `${trimZeros(n * per, 0)} ${sub}`;
  return `${trimZeros(n, places)} ${big}`;
}

/** Just the number, no unit — for table cells that carry the unit in a header. */
export function fmtQtyNumber(
  quantity: string | number | null | undefined,
  places = 3,
): string {
  const n = typeof quantity === "number" ? quantity : parseFloat(String(quantity ?? ""));
  if (!Number.isFinite(n)) return String(quantity ?? "—");
  return String(trimZeros(n, places));
}

/**
 * Decimal hours the way a person says them: 6.98 → "6h 59m".
 *
 * His words: "6.98 means? bro we need clearly like 6 hr 50 min... it should be
 * very clear to users. for users only we developing project, not for our sake."
 * Right — 6.98 is a number for a spreadsheet. Nobody has ever worked
 * nought-point-nine-eight of an hour.
 *
 * This lived inside app/(app)/attendance/page.tsx, where it was correct and
 * invisible to everyone else — so the history table, My Space and payroll all
 * printed the raw decimal beside it. Same fault as the quantity formatter: a
 * good function with no shared home.
 */
export function fmtHours(dec: string | number | null | undefined): string {
  if (dec == null || dec === "") return "—";
  const n = typeof dec === "number" ? dec : parseFloat(dec);
  if (!Number.isFinite(n)) return "—";
  const mins = Math.round(n * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h && !m) return "0m";
  if (!m) return `${h}h`;
  if (!h) return `${m}m`;
  return `${h}h ${m}m`;
}
