"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// Money is STORED in the hotel's base currency (NIRAI = GBP). This is a
// DISPLAY-ONLY conversion for viewing in another currency. Rates are static
// for now (approx, GBP base) — later we can fetch live rates per hotel.
// EVERY REGION, NOT FIVE.
//
//   "also add all region currency here. it gonna affect nothing, so we can add
//    all region currency here. Have a search functionality that I can search
//    india or inr — both are valid and point same inr."
//
// One caution he did not ask for and should have. These rates are STATIC
// approximations against GBP, and money is the thing this whole product exists
// to get right, so adding forty more of them multiplies the number of figures
// that can quietly drift. What stops that being dangerous is that this
// conversion is DISPLAY ONLY: every amount is stored and reported in the
// hotel's own currency, and this only changes how it is drawn on screen. The
// picker now says so out loud rather than leaving somebody to assume these are
// dealing rates.
//
// `where` exists for the search. Typing "india" has to find INR, so each row
// carries the countries that use it — a currency is looked for by the place far
// more often than by its code.
export const CURRENCIES = {
  GBP: { symbol: "£", label: "British Pound", rate: 1.0, where: "United Kingdom England Scotland Wales britain uk" },
  INR: { symbol: "₹", label: "Indian Rupee", rate: 106.5, where: "India bharat hindustan" },
  USD: { symbol: "$", label: "US Dollar", rate: 1.27, where: "United States America USA" },
  EUR: { symbol: "€", label: "Euro", rate: 1.17, where: "Europe Eurozone France Germany Spain Italy Ireland Netherlands Portugal Greece" },
  AED: { symbol: "د.إ", label: "UAE Dirham", rate: 4.66, where: "United Arab Emirates Dubai Abu Dhabi" },
  AUD: { symbol: "A$", label: "Australian Dollar", rate: 1.92, where: "Australia" },
  CAD: { symbol: "C$", label: "Canadian Dollar", rate: 1.73, where: "Canada" },
  NZD: { symbol: "NZ$", label: "New Zealand Dollar", rate: 2.09, where: "New Zealand" },
  SGD: { symbol: "S$", label: "Singapore Dollar", rate: 1.66, where: "Singapore" },
  MYR: { symbol: "RM", label: "Malaysian Ringgit", rate: 5.63, where: "Malaysia" },
  LKR: { symbol: "Rs", label: "Sri Lankan Rupee", rate: 380.0, where: "Sri Lanka ceylon" },
  PKR: { symbol: "₨", label: "Pakistani Rupee", rate: 353.0, where: "Pakistan" },
  BDT: { symbol: "৳", label: "Bangladeshi Taka", rate: 151.0, where: "Bangladesh" },
  NPR: { symbol: "Rs", label: "Nepalese Rupee", rate: 170.0, where: "Nepal" },
  SAR: { symbol: "﷼", label: "Saudi Riyal", rate: 4.76, where: "Saudi Arabia" },
  QAR: { symbol: "﷼", label: "Qatari Riyal", rate: 4.62, where: "Qatar" },
  KWD: { symbol: "د.ك", label: "Kuwaiti Dinar", rate: 0.39, where: "Kuwait" },
  BHD: { symbol: "ب.د", label: "Bahraini Dinar", rate: 0.48, where: "Bahrain" },
  OMR: { symbol: "﷼", label: "Omani Rial", rate: 0.49, where: "Oman" },
  ZAR: { symbol: "R", label: "South African Rand", rate: 23.2, where: "South Africa" },
  KES: { symbol: "KSh", label: "Kenyan Shilling", rate: 164.0, where: "Kenya" },
  NGN: { symbol: "₦", label: "Nigerian Naira", rate: 1900.0, where: "Nigeria" },
  EGP: { symbol: "E£", label: "Egyptian Pound", rate: 62.0, where: "Egypt" },
  CHF: { symbol: "CHF", label: "Swiss Franc", rate: 1.12, where: "Switzerland" },
  SEK: { symbol: "kr", label: "Swedish Krona", rate: 13.4, where: "Sweden" },
  NOK: { symbol: "kr", label: "Norwegian Krone", rate: 13.7, where: "Norway" },
  DKK: { symbol: "kr", label: "Danish Krone", rate: 8.7, where: "Denmark" },
  PLN: { symbol: "zł", label: "Polish Zloty", rate: 5.0, where: "Poland" },
  CZK: { symbol: "Kč", label: "Czech Koruna", rate: 29.0, where: "Czechia Czech Republic" },
  HUF: { symbol: "Ft", label: "Hungarian Forint", rate: 460.0, where: "Hungary" },
  RON: { symbol: "lei", label: "Romanian Leu", rate: 5.8, where: "Romania" },
  TRY: { symbol: "₺", label: "Turkish Lira", rate: 43.0, where: "Turkey Turkiye" },
  JPY: { symbol: "¥", label: "Japanese Yen", rate: 190.0, where: "Japan" },
  CNY: { symbol: "¥", label: "Chinese Yuan", rate: 9.1, where: "China" },
  HKD: { symbol: "HK$", label: "Hong Kong Dollar", rate: 9.9, where: "Hong Kong" },
  KRW: { symbol: "₩", label: "South Korean Won", rate: 1740.0, where: "South Korea" },
  THB: { symbol: "฿", label: "Thai Baht", rate: 41.0, where: "Thailand" },
  IDR: { symbol: "Rp", label: "Indonesian Rupiah", rate: 20500.0, where: "Indonesia Bali" },
  PHP: { symbol: "₱", label: "Philippine Peso", rate: 73.0, where: "Philippines" },
  VND: { symbol: "₫", label: "Vietnamese Dong", rate: 32000.0, where: "Vietnam" },
  BRL: { symbol: "R$", label: "Brazilian Real", rate: 6.9, where: "Brazil" },
  MXN: { symbol: "Mex$", label: "Mexican Peso", rate: 23.5, where: "Mexico" },
  ARS: { symbol: "$", label: "Argentine Peso", rate: 1300.0, where: "Argentina" },
  ILS: { symbol: "₪", label: "Israeli Shekel", rate: 4.7, where: "Israel" },
  MUR: { symbol: "₨", label: "Mauritian Rupee", rate: 58.0, where: "Mauritius" },
  MVR: { symbol: "Rf", label: "Maldivian Rufiyaa", rate: 19.6, where: "Maldives" },
  FJD: { symbol: "FJ$", label: "Fijian Dollar", rate: 2.9, where: "Fiji" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;
const STORAGE_KEY = "mise_currency";
const BASE: CurrencyCode = "GBP"; // the currency amounts are stored in

interface CurrencyState {
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  /** Set a default (e.g. the hotel's currency) only if the user hasn't chosen one. */
  applyDefault: (c: string) => void;
  /** Format a base-currency (GBP) amount into the selected currency. */
  format: (gbpAmount: string | number | null | undefined) => string;
}

const CurrencyContext = createContext<CurrencyState | null>(null);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<CurrencyCode>(BASE);
  const userPicked = useRef(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) as CurrencyCode | null;
    if (saved && saved in CURRENCIES) {
      userPicked.current = true;
      setCurrencyState(saved);
    }
  }, []);

  const setCurrency = useCallback((c: CurrencyCode) => {
    userPicked.current = true;
    setCurrencyState(c);
    window.localStorage.setItem(STORAGE_KEY, c);
  }, []);

  const applyDefault = useCallback((c: string) => {
    if (!userPicked.current && c in CURRENCIES) {
      setCurrencyState(c as CurrencyCode);
    }
  }, []);

  const format = useCallback(
    (gbpAmount: string | number | null | undefined) => {
      const n = typeof gbpAmount === "string" ? parseFloat(gbpAmount) : gbpAmount ?? 0;
      const value = (Number.isFinite(n) ? (n as number) : 0) * CURRENCIES[currency].rate;
      const formatted = value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `${CURRENCIES[currency].symbol}${formatted}`;
    },
    [currency]
  );

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, applyDefault, format }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyState {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
