// Strict input sanitizers — enforce the RIGHT data type at the keystroke, so a
// number field can never hold letters and a unit field can never hold digits.
// Pure functions (easy to reuse in any onChange).

/** Keep only a valid number string: digits, and (if allowed) a single decimal point.
 *  Empty stays empty so a field can be cleared. */
export function numeric(raw: string, opts: { decimal?: boolean } = {}): string {
  const decimal = opts.decimal !== false; // default: allow decimals
  let s = raw.replace(decimal ? /[^0-9.]/g : /[^0-9]/g, "");
  if (decimal) {
    const i = s.indexOf(".");
    if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
  }
  return s;
}

/** Strip digits — for unit / pack names ("kg", "box", "dozen"), which are words,
 *  never numbers. */
export function noDigits(raw: string): string {
  return raw.replace(/[0-9]/g, "");
}
