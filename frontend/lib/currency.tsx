"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// Money is STORED in the hotel's base currency (NIRAI = GBP). This is a
// DISPLAY-ONLY conversion for viewing in another currency. Rates are static
// for now (approx, GBP base) — later we can fetch live rates per hotel.
export const CURRENCIES = {
  GBP: { symbol: "£", label: "British Pound", rate: 1 },
  INR: { symbol: "₹", label: "Indian Rupee", rate: 106.5 },
  USD: { symbol: "$", label: "US Dollar", rate: 1.27 },
  EUR: { symbol: "€", label: "Euro", rate: 1.17 },
  AED: { symbol: "د.إ", label: "UAE Dirham", rate: 4.66 },
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
