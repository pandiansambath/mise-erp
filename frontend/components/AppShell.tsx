"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { CURRENCIES, type CurrencyCode, useCurrency } from "@/lib/currency";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/price-comparison", label: "Price Comparison", icon: "⚖" },
  { href: "/inventory", label: "Inventory", icon: "📦" },
  { href: "/recipes", label: "Recipes", icon: "🍲" },
  { href: "/profile", label: "Profile", icon: "👤" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

function CurrencySwitcher() {
  const { currency, setCurrency } = useCurrency();
  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">Display currency</span>
      <select
        aria-label="Display currency"
        value={currency}
        onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-500"
      >
        {(Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => (
          <option key={code} value={code}>
            {CURRENCIES[code].symbol} {code}
          </option>
        ))}
      </select>
    </label>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-5 py-5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
        M
      </div>
      <span className="text-lg font-semibold tracking-tight text-slate-900">Mise</span>
    </div>
  );
}

function NavLinks({ pathname, onClick }: { pathname: string; onClick?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClick}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              active
                ? "bg-brand-600 text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <span aria-hidden className="text-base">
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="hidden border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <Brand />
        <NavLinks pathname={pathname} />
        <div className="mt-auto border-t border-slate-200 p-4 text-xs text-slate-500">
          <p className="truncate font-medium text-slate-700">{user?.email}</p>
          <p className="mt-0.5">{user?.role.replace(/_/g, " ")}</p>
        </div>
      </aside>

      {/* Mobile slide-over */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col bg-white shadow-xl">
            <Brand />
            <NavLinks pathname={pathname} onClick={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-h-screen flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:px-8">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          >
            <span className="block h-0.5 w-5 bg-current" />
            <span className="mt-1 block h-0.5 w-5 bg-current" />
            <span className="mt-1 block h-0.5 w-5 bg-current" />
          </button>
          <h1 className="text-sm font-semibold text-slate-700 lg:hidden">Mise</h1>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <CurrencySwitcher />
            <span className="hidden text-sm text-slate-500 lg:inline">{user?.email}</span>
            <button
              onClick={logout}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Log out
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
