"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { CURRENCIES, type CurrencyCode, useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { Logo } from "@/components/Logo";
import { THEMES, themeVars, useTheme, type ThemeKey } from "@/lib/theme";

// `hideIfPerm`: hide the item when the user ALSO has this permission — used so
// "My Space" (self-service) shows only for staff, not managers/owners who have
// the full management view.
type NavItem = { href: string; label: string; icon: string; perm?: string; hideIfPerm?: string };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/my", label: "My Space", icon: "🙋", perm: "attendance:self", hideIfPerm: "attendance:read" },
  { href: "/reports", label: "Reports (P&L)", icon: "📈", perm: "reports:read" },
  { href: "/money", label: "Money", icon: "💰", perm: "reports:read" },
  { href: "/vendors", label: "Vendors", icon: "🤝", perm: "vendors:read" },
  { href: "/price-comparison", label: "Price Comparison", icon: "⚖", perm: "vendors:read" },
  { href: "/inventory", label: "Inventory", icon: "📦", perm: "inventory:read" },
  { href: "/recipes", label: "Recipes", icon: "🍲", perm: "recipes:read" },
  { href: "/waste", label: "Waste", icon: "🗑️", perm: "inventory:read" },
  { href: "/purchasing", label: "Purchasing", icon: "🛒", perm: "indent:read" },
  { href: "/sales", label: "Sales & Cash", icon: "🧾", perm: "sales:read" },
  { href: "/expenses", label: "Expenses", icon: "💸", perm: "expenses:read" },
  { href: "/employees", label: "Employees", icon: "🧑‍🍳", perm: "employees:read" },
  { href: "/attendance", label: "Attendance", icon: "🕒", perm: "attendance:read" },
  { href: "/payroll", label: "Payroll", icon: "💷", perm: "payroll:read" },
  { href: "/documents", label: "Documents", icon: "📁", perm: "documents:read" },
  { href: "/staff", label: "Staff", icon: "👥", perm: "users:read" },
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
        className="rounded-lg border border-glass/15 bg-glass/5 px-2 py-1.5 text-sm text-fg-soft outline-none transition focus:border-brand-500"
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

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change theme"
        title="Theme"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-glass/15 hover:bg-glass/5"
      >
        <span className="h-4 w-4 rounded-full ring-1 ring-glass/25" style={{ background: THEMES[theme].brand["500"] }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="mise-pop absolute right-0 z-40 mt-2 w-52 rounded-xl border border-glass/10 bg-paper-2/95 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-fg-faint">Theme</p>
            {(Object.keys(THEMES) as ThemeKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => { setTheme(k); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-glass/5 ${theme === k ? "font-semibold text-fg" : "text-fg-soft"}`}
              >
                {/* two-tone swatch: the theme's surface with its accent inside */}
                <span
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-md ring-1 ring-glass/25"
                  style={{ background: THEMES[k].surfaces[1] }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: THEMES[k].brand["500"] }} />
                </span>
                {THEMES[k].label}
                {theme === k && <span className="ml-auto text-brand-400">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <Logo size={32} />
      <span className="font-display text-lg font-semibold tracking-tight text-fg">Mise</span>
    </div>
  );
}

function NavLinks({
  items,
  pathname,
  onClick,
}: {
  items: NavItem[];
  pathname: string;
  onClick?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClick}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition duration-200 ${
              active
                ? "bg-brand-600 text-white shadow-lg shadow-brand-600/25"
                : "text-fg-faint hover:translate-x-0.5 hover:bg-glass/5 hover:text-fg"
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

/** Drifting aurora behind the whole app — same ingredient as the landing,
    dialled down so tables stay crisp. Colours follow the chosen theme via
    the --mise-aurora-* variables set by themeVars(). */
function ShellAurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="mise-aurora mise-aurora-shift opacity-40">
        <span style={{ left: "-8%", top: "-14%", width: 560, height: 560, background: "radial-gradient(circle, var(--mise-aurora-1), transparent 68%)" }} />
        <span style={{ right: "-10%", top: "10%", width: 520, height: 520, background: "radial-gradient(circle, var(--mise-aurora-2), transparent 70%)", animationDelay: "8s" }} />
        <span style={{ left: "35%", bottom: "-28%", width: 620, height: 620, background: "radial-gradient(circle, var(--mise-aurora-3), transparent 72%)", animationDelay: "14s" }} />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { user, hotel, logout } = useAuth();
  const { applyDefault } = useCurrency();
  const { theme } = useTheme();

  // Default the display currency to the hotel's currency (unless the user chose one).
  useEffect(() => {
    if (hotel?.base_currency) applyDefault(hotel.base_currency);
  }, [hotel, applyDefault]);

  const navItems = NAV.filter(
    (item) =>
      (!item.perm || can(user?.role, item.perm)) &&
      (!item.hideIfPerm || !can(user?.role, item.hideIfPerm))
  );

  return (
    <div
      data-mode={THEMES[theme].light ? "light" : "dark"}
      style={{ ...themeVars(theme), colorScheme: THEMES[theme].light ? "light" : "dark" }}
      className="mise-app min-h-screen bg-shell text-fg lg:grid lg:h-screen lg:grid-cols-[16rem_1fr] lg:overflow-hidden"
    >
      <ShellAurora />

      {/* Desktop sidebar — fixed, scrolls on its own if the nav is long */}
      <aside className="relative hidden border-r border-glass/10 bg-shell/80 backdrop-blur-xl lg:flex lg:h-screen lg:flex-col lg:overflow-y-auto">
        <Brand />
        <NavLinks items={navItems} pathname={pathname} />
        <div className="mt-auto border-t border-glass/10 p-4 text-xs text-fg-faint">
          {hotel && (
            <p className="truncate text-sm font-semibold text-fg">
              {hotel.name}
              {hotel.city ? ` · ${hotel.city}` : ""}
            </p>
          )}
          <p className="mt-1 truncate text-fg-soft">{user?.email}</p>
          <p className="mt-0.5">{user?.role.replace(/_/g, " ")}</p>
        </div>
      </aside>

      {/* Mobile slide-over */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="mise-fade absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="mise-drawer absolute left-0 top-0 flex h-full w-64 flex-col border-r border-glass/10 bg-shell/95 shadow-2xl shadow-black/50 backdrop-blur-xl">
            <Brand />
            <NavLinks items={navItems} pathname={pathname} onClick={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="relative flex min-h-screen flex-col lg:h-screen lg:min-h-0 lg:overflow-hidden">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-glass/10 bg-shell/70 px-4 py-3 backdrop-blur-xl lg:px-8">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="rounded-lg p-2 text-fg-soft hover:bg-glass/5 lg:hidden"
          >
            <span className="block h-0.5 w-5 bg-current" />
            <span className="mt-1 block h-0.5 w-5 bg-current" />
            <span className="mt-1 block h-0.5 w-5 bg-current" />
          </button>
          <h1 className="font-display text-sm font-semibold text-fg lg:hidden">Mise</h1>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <ThemeSwitcher />
            <CurrencySwitcher />
            <span className="hidden text-sm text-fg-faint lg:inline">{user?.email}</span>
            <button
              onClick={logout}
              className="rounded-lg border border-glass/15 px-3 py-1.5 text-sm font-medium text-fg-soft hover:bg-glass/5"
            >
              Log out
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
