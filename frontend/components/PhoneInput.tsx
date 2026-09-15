"use client";

/** A phone number with its country code, chosen rather than typed.
 *
 *     "Phone numbers need a country code. Pick the region from a dropdown
 *      (India → +91) and then type the number — which will ignore so many
 *      confusions."
 *
 *  The confusions are real and specific. A UK restaurant with an Indian
 *  supplier ends up with `9876543210`, `09876543210`, `+91 9876543210` and
 *  `0091-98765 43210` in the same table, all meaning the same person. Nobody
 *  can search that, and a `tel:` link works for some of them and not others.
 *
 *  WHAT THIS STORES, and why it is one string
 *
 *  A single string, `"+91 9876543210"` — dial code, one space, the rest. Not
 *  two columns, because every phone field in this app is already a plain
 *  `String` on its model and splitting them would mean a migration per table
 *  (employees, vendors, orders, riders, applicants, the landing page's contact
 *  details) for a formatting concern. One canonical shape, parseable back into
 *  its two parts by the same function that wrote it, is worth more here than
 *  normalising the storage.
 *
 *  It is deliberately NOT strict E.164 (`+919876543210`, no spaces). The space
 *  is what makes it readable to the person reading it back off the screen and
 *  dialling it, and every `tel:` consumer strips spaces anyway.
 *
 *  WHAT IT DOES NOT DO
 *
 *  It does not validate that the number is real, or that its length matches
 *  the country. libphonenumber is 500 kB and this is a field somebody types a
 *  supplier's mobile into — a wrong-length warning that fires on a legitimate
 *  extension is worse than no warning. The country code is the part that was
 *  ambiguous; the rest is the user's business.
 */

import { useMemo } from "react";

export type Country = { code: string; name: string; dial: string; flag: string };

/** Ordered so the two that matter here are first, then alphabetical.
 *  Not all 200: a longer list is slower to scan and this covers where his
 *  restaurants, their staff and their suppliers actually are. "Other" at the
 *  end keeps a number from anywhere else enterable. */
export const COUNTRIES: Country[] = [
  { code: "GB", name: "United Kingdom", dial: "+44", flag: "🇬🇧" },
  { code: "IN", name: "India", dial: "+91", flag: "🇮🇳" },
  { code: "IE", name: "Ireland", dial: "+353", flag: "🇮🇪" },
  { code: "AE", name: "United Arab Emirates", dial: "+971", flag: "🇦🇪" },
  { code: "AU", name: "Australia", dial: "+61", flag: "🇦🇺" },
  { code: "BD", name: "Bangladesh", dial: "+880", flag: "🇧🇩" },
  { code: "CA", name: "Canada", dial: "+1", flag: "🇨🇦" },
  { code: "CN", name: "China", dial: "+86", flag: "🇨🇳" },
  { code: "DE", name: "Germany", dial: "+49", flag: "🇩🇪" },
  { code: "ES", name: "Spain", dial: "+34", flag: "🇪🇸" },
  { code: "FR", name: "France", dial: "+33", flag: "🇫🇷" },
  { code: "IT", name: "Italy", dial: "+39", flag: "🇮🇹" },
  { code: "LK", name: "Sri Lanka", dial: "+94", flag: "🇱🇰" },
  { code: "MY", name: "Malaysia", dial: "+60", flag: "🇲🇾" },
  { code: "NL", name: "Netherlands", dial: "+31", flag: "🇳🇱" },
  { code: "NP", name: "Nepal", dial: "+977", flag: "🇳🇵" },
  { code: "NZ", name: "New Zealand", dial: "+64", flag: "🇳🇿" },
  { code: "PK", name: "Pakistan", dial: "+92", flag: "🇵🇰" },
  { code: "PL", name: "Poland", dial: "+48", flag: "🇵🇱" },
  { code: "PT", name: "Portugal", dial: "+351", flag: "🇵🇹" },
  { code: "RO", name: "Romania", dial: "+40", flag: "🇷🇴" },
  { code: "SG", name: "Singapore", dial: "+65", flag: "🇸🇬" },
  { code: "TH", name: "Thailand", dial: "+66", flag: "🇹🇭" },
  { code: "US", name: "United States", dial: "+1", flag: "🇺🇸" },
  { code: "ZA", name: "South Africa", dial: "+27", flag: "🇿🇦" },
];

/** Longest dial code first, so `+1` never wins against `+19…`-style prefixes
 *  and `+9` never shadows `+91`. Sorting matters more than it looks. */
const BY_LENGTH = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

/** Split a stored value back into its two parts.
 *
 *  Tolerant on the way IN, because there is existing data written before this
 *  component existed, and it must not be mangled: a number with no recognised
 *  dial code keeps its digits and simply shows the default country, so nothing
 *  is silently reassigned to the wrong country.
 */
export function splitPhone(value: string, fallback = "GB"): { country: string; number: string } {
  const raw = (value ?? "").trim();
  if (!raw) return { country: fallback, number: "" };

  // "0091…" and "00 91…" are the other way people write an international call.
  const normalised = raw.startsWith("00") ? `+${raw.slice(2).trimStart()}` : raw;

  if (normalised.startsWith("+")) {
    const compact = normalised.replace(/[\s-]/g, "");
    const hit = BY_LENGTH.find((c) => compact.startsWith(c.dial));
    if (hit) return { country: hit.code, number: compact.slice(hit.dial.length) };
    // A + we do not recognise is still a real number. Keep it whole rather
    // than discard the country the user typed.
    return { country: fallback, number: normalised };
  }
  return { country: fallback, number: raw };
}

/** The canonical shape: "+44 7700900123". Empty number → empty string, NOT a
 *  bare dial code — "+44" alone in a database column looks like a phone number
 *  and is not one. */
export function joinPhone(countryCode: string, number: string): string {
  const digits = (number ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const c = COUNTRIES.find((x) => x.code === countryCode) ?? COUNTRIES[0];
  return `${c.dial} ${digits}`;
}

export function PhoneInput({
  value,
  onChange,
  defaultCountry = "GB",
  placeholder = "Phone",
  className = "",
  inputClassName = "",
  id,
  required,
  disabled,
  "aria-label": ariaLabel = "Phone number",
}: {
  value: string;
  onChange: (next: string) => void;
  /** The restaurant's own country, where the caller knows it. */
  defaultCountry?: string;
  placeholder?: string;
  className?: string;
  /** So each page keeps its own field styling — this app has several. */
  inputClassName?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const { country, number } = useMemo(
    () => splitPhone(value, defaultCountry),
    [value, defaultCountry],
  );

  return (
    <div className={`flex min-w-0 items-stretch gap-1.5 ${className}`}>
      <select
        value={country}
        disabled={disabled}
        onChange={(e) => onChange(joinPhone(e.target.value, number))}
        aria-label="Country code"
        // shrink-0 and a fixed width: a select that squeezes below its content
        // shows "+9" and the user picks the wrong country. A flex item collapses
        // below its content long before the row wraps — a trap this repo has
        // already paid for.
        className={`mise-card-inset w-[5.5rem] shrink-0 rounded-xl bg-transparent px-2 py-2 text-sm text-fg outline-none ${inputClassName}`}
      >
        {COUNTRIES.map((c) => (
          // The flag is decoration; the DIAL CODE is the label, because that is
          // what the person is choosing. A flag alone is unreadable at 14px and
          // renders as two letters on Windows.
          <option key={c.code} value={c.code} title={c.name}>
            {c.flag} {c.dial}
          </option>
        ))}
      </select>
      <input
        id={id}
        value={number}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(joinPhone(country, e.target.value))}
        inputMode="tel"
        autoComplete="tel-national"
        aria-label={ariaLabel}
        placeholder={placeholder}
        className={`mise-card-inset min-w-0 flex-1 rounded-xl bg-transparent px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-faint ${inputClassName}`}
      />
    </div>
  );
}
