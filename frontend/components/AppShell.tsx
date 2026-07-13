"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { API_BASE, api, featureOn } from "@/lib/api";
import { CURRENCIES, type CurrencyCode, useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { Logo } from "@/components/Logo";
import CommandPalette from "@/components/CommandPalette";
import { Copilot } from "@/components/Copilot";
import NotificationBell from "@/components/NotificationBell";
import { Select } from "@/components/Select";
import { Tour, shouldAutoStartTour } from "@/components/Tour";
import { THEMES, themeVars, useTheme, type ThemeKey } from "@/lib/theme";

// `hideIfPerm`: hide the item when the user ALSO has this permission — used so
// "My Space" (self-service) shows only for staff, not managers/owners who have
// the full management view.
type NavItem = {
  href: string; label: string; icon: string; perm?: string; hideIfPerm?: string;
  // `feature`: hide this item when the hotel has that entitlement turned off.
  feature?: string;
  /** sidebar section + palette search hints */
  group: string;
  keywords?: string;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "▦", group: "Overview", keywords: "home overview" },
  { href: "/my", label: "My Space", icon: "🙋", perm: "attendance:self", hideIfPerm: "attendance:read", group: "Overview", keywords: "self service" },
  { href: "/how-it-works", label: "How it works", icon: "📘", group: "Overview", keywords: "help guide formulas" },
  { href: "/reports", label: "Reports (P&L)", icon: "📈", perm: "reports:read", feature: "reports", group: "Money", keywords: "profit loss pnl food cost" },
  { href: "/money", label: "Money", icon: "💰", perm: "reports:read", group: "Money", keywords: "cash in out" },
  { href: "/sales", label: "Sales & Cash", icon: "🧾", perm: "sales:read", group: "Money", keywords: "takings till revenue" },
  { href: "/expenses", label: "Expenses", icon: "💸", perm: "expenses:read", feature: "expenses", group: "Money", keywords: "costs spend petty" },
  { href: "/payroll", label: "Payroll", icon: "💷", perm: "payroll:read", feature: "payroll", group: "Money", keywords: "payslip salary wages" },
  { href: "/inventory", label: "Inventory", icon: "📦", perm: "inventory:read", group: "Stock", keywords: "stock items shelf" },
  { href: "/stock-take", label: "Stock-take", icon: "📋", perm: "inventory:read", feature: "stock_take", group: "Stock", keywords: "count variance" },
  { href: "/purchasing", label: "Purchasing", icon: "🛒", perm: "indent:read", group: "Stock", keywords: "po indent order buy" },
  { href: "/vendors", label: "Vendors", icon: "🤝", perm: "vendors:read", group: "Stock", keywords: "suppliers" },
  { href: "/price-comparison", label: "Price Comparison", icon: "⚖", perm: "vendors:read", feature: "price_comparison", group: "Stock", keywords: "cheapest vendor" },
  { href: "/waste", label: "Waste", icon: "🗑️", perm: "inventory:read", feature: "waste", group: "Stock", keywords: "spoilage bin" },
  { href: "/recipes", label: "Recipes", icon: "🍲", perm: "recipes:read", group: "Kitchen", keywords: "dishes menu costing" },
  { href: "/party-order", label: "Party Order", icon: "🎉", perm: "recipes:read", feature: "party_orders", group: "Kitchen", keywords: "event catering" },
  { href: "/allergens", label: "Allergens", icon: "⚠️", perm: "recipes:read", feature: "allergens", group: "Kitchen" },
  { href: "/food-safety", label: "Food Safety", icon: "🌡️", perm: "inventory:read", feature: "food_safety", group: "Kitchen", keywords: "temperature haccp" },
  { href: "/employees", label: "Employees", icon: "🧑‍🍳", perm: "employees:read", feature: "employees", group: "People", keywords: "team hr" },
  { href: "/attendance", label: "Attendance", icon: "🕒", perm: "attendance:read", feature: "attendance", group: "People", keywords: "punch clock present" },
  { href: "/rota", label: "Rota", icon: "🗓️", perm: "employees:read", feature: "rota", group: "People", keywords: "shifts schedule week" },
  { href: "/hiring", label: "Hiring", icon: "🧑‍💼", perm: "employees:read", feature: "employees", group: "People", keywords: "jobs vacancy recruit applicants careers board" },
  { href: "/staff", label: "Staff", icon: "👥", perm: "users:read", group: "People", keywords: "users accounts roles" },
  { href: "/documents", label: "Documents", icon: "📁", perm: "documents:read", feature: "documents", group: "Admin", keywords: "files certificates" },
  { href: "/audit", label: "Audit log", icon: "📜", perm: "users:read", group: "Admin", keywords: "history who changed" },
];

const NAV_GROUPS = ["Overview", "Money", "Stock", "Kitchen", "People", "Admin"];

function CurrencySwitcher() {
  const { currency, setCurrency } = useCurrency();
  return (
    <Select
      value={currency}
      onChange={(v) => setCurrency(v as CurrencyCode)}
      className="w-28"
      options={(Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => ({
        value: code,
        label: `${CURRENCIES[code].symbol} ${code}`,
      }))}
    />
  );
}

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const keys = Object.keys(THEMES) as ThemeKey[];
  const light = keys.filter((k) => THEMES[k].light);
  const dark = keys.filter((k) => !THEMES[k].light);
  const nice = (k: ThemeKey) => THEMES[k].label.replace(/\s*\((Light|Dark)\)$/i, "");

  const Row = ({ k }: { k: ThemeKey }) => (
    <button
      type="button"
      onClick={() => { setTheme(k); setOpen(false); }}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition hover:bg-glass/5 ${
        theme === k ? "font-semibold text-fg" : "text-fg-soft"
      }`}
    >
      {/* two-tone swatch: the theme's surface with its accent inside */}
      <span
        className="grid h-5 w-5 shrink-0 place-items-center rounded-md ring-1 ring-glass/25"
        style={{ background: THEMES[k].surfaces[1] }}
      >
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: THEMES[k].brand["500"] }} />
      </span>
      {nice(k)}
      {theme === k && <span className="ml-auto text-brand-400">✓</span>}
    </button>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change theme"
        title="Theme"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-glass/15 transition hover:bg-glass/5 active:scale-95"
      >
        <span className="h-4 w-4 rounded-full ring-1 ring-glass/25" style={{ background: THEMES[theme].brand["500"] }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="mise-pop absolute right-0 z-40 mt-2 max-h-[min(70vh,26rem)] w-56 overflow-y-auto overscroll-contain rounded-xl border border-glass/10 bg-paper-2/95 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">☀ Light</p>
            {light.map((k) => <Row key={k} k={k} />)}
            <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">🌙 Dark</p>
            {dark.map((k) => <Row key={k} k={k} />)}
          </div>
        </>
      )}
    </div>
  );
}

/** Top-right account menu — where the user's identity, Profile, Settings and
    Log out live (the usual place on most apps). */
function UserMenu() {
  const { user, hotel, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const initial = (user?.email?.[0] || "?").toUpperCase();
  const role = user?.role?.replace(/_/g, " ") ?? "";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account"
        title={user?.email}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white ring-1 ring-glass/20 transition hover:brightness-110 active:scale-95"
      >
        {initial}
      </button>
      {open && (
        <div className="mise-pop absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-glass/10 bg-paper-2/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="border-b border-glass/10 px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-fg">{hotel?.name ?? "Mise"}</p>
            <p className="mt-0.5 truncate text-xs text-fg-soft">{user?.email}</p>
            {role && (
              <span className="mt-1.5 inline-block rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-300">
                {role}
              </span>
            )}
          </div>
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg-soft transition hover:bg-glass/5"
          >
            <span aria-hidden>👤</span> Profile &amp; hotel
          </Link>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg-soft transition hover:bg-glass/5"
          >
            <span aria-hidden>⚙</span> Settings
          </Link>
          <button
            type="button"
            onClick={() => { setOpen(false); logout(); }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-rose-300 transition hover:bg-rose-500/10"
          >
            <span aria-hidden>⎋</span> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function Brand() {
  const { hotel } = useAuth();
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      {hotel?.has_logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${API_BASE}/api/hotels/${hotel.id}/logo`}
          alt={hotel.name}
          className="h-8 w-8 rounded-lg object-contain"
        />
      ) : (
        <Logo size={32} />
      )}
      <span className="max-w-[9rem] truncate font-display text-lg font-semibold tracking-tight text-fg">
        {hotel?.has_logo ? hotel.name : "Mise"}
      </span>
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
    <nav className="flex flex-col px-3">
      {NAV_GROUPS.map((group) => {
        const inGroup = items.filter((i) => i.group === group);
        if (inGroup.length === 0) return null;
        return (
          <div key={group} className="mb-1.5">
            <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint/70">
              {group}
            </p>
            <div className="flex flex-col gap-0.5">
              {inGroup.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClick}
                    data-tour={item.href.slice(1)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition duration-200 ${
                      active
                        ? "mise-raised !bg-brand-600 text-white"
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
            </div>
          </div>
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

/** Purple ribbon while the operator is inside a hotel on a read-only token. */
function ImpersonationBanner() {
  const [imp, setImp] = useState(false);
  useEffect(() => {
    try {
      const tok = localStorage.getItem("mise_token");
      if (!tok) return;
      const payload = JSON.parse(atob(tok.split(".")[1] ?? ""));
      setImp(Boolean(payload?.imp));
    } catch { /* not a JWT — ignore */ }
  }, []);
  if (!imp) return null;
  return (
    <div className="flex items-center justify-center gap-3 border-b border-violet-400/30 bg-violet-500/15 px-4 py-1.5 text-xs font-medium text-violet-200">
      <span aria-hidden>🔍</span>
      Read-only support view — changes are disabled · expires in ≤15 min
      <button
        type="button"
        onClick={() => {
          try { localStorage.removeItem("mise_token"); } catch { /* ignore */ }
          window.location.assign("/login");
        }}
        className="mise-press rounded-md border border-violet-300/40 px-2 py-0.5 hover:bg-violet-400/10"
      >
        Leave
      </button>
    </div>
  );
}

/** Operator broadcast banner — platform announcements shown to every hotel
 *  until they expire; each user can dismiss (remembered locally). */
function AnnouncementBanner() {
  type Ann = { id: string; message: string; level: string };
  const [anns, setAnns] = useState<Ann[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    try {
      setDismissed(JSON.parse(localStorage.getItem("mise.dismissed.announcements") ?? "[]"));
    } catch { /* ignore */ }
    api
      .get<{ announcements: Ann[] }>("/platform/announcements/active")
      .then((r) => setAnns(r.announcements))
      .catch(() => {});
  }, []);
  const visible = anns.filter((a) => !dismissed.includes(a.id));
  if (visible.length === 0) return null;
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-20);
    setDismissed(next);
    try { localStorage.setItem("mise.dismissed.announcements", JSON.stringify(next)); } catch { /* ignore */ }
  };
  return (
    <div className="space-y-1.5 px-4 pt-3 lg:px-8">
      {visible.map((a) => (
        <div
          key={a.id}
          className={`mise-pop flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm backdrop-blur ${
            a.level === "warn"
              ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
              : "border-brand-500/30 bg-brand-500/10 text-brand-200"
          }`}
        >
          <span aria-hidden>{a.level === "warn" ? "⚠️" : "📣"}</span>
          <p className="min-w-0 flex-1">{a.message}</p>
          <button
            type="button"
            onClick={() => dismiss(a.id)}
            aria-label="Dismiss"
            className="mise-press shrink-0 rounded-lg px-2 py-0.5 text-fg-faint transition hover:text-fg"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/** Phone-only bottom tab bar — thumb-reach navigation for the five daily stops. */
function MobileTabBar({ onSearch, items }: { onSearch: () => void; items: NavItem[] }) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState(false);
  useEffect(() => setSheet(false), [pathname]); // navigating closes the sheet

  // Four anchor tabs around the centre launcher — only ones this user can see.
  const has = new Set(items.map((n) => n.href));
  const tabs = [
    { href: "/dashboard", icon: "▦", label: "Home" },
    { href: "/sales", icon: "🧾", label: "Sales" },
    { href: "/inventory", icon: "📦", label: "Stock" },
    { href: "/money", icon: "💰", label: "Money" },
  ].filter((t) => t.href === "/dashboard" || has.has(t.href));
  for (const n of items) {
    if (tabs.length >= 4) break;
    if (!tabs.some((t) => t.href === n.href)) tabs.push({ href: n.href, icon: n.icon, label: n.label.split(" ")[0] });
  }

  const Tab = ({ t }: { t: { href: string; icon: string; label: string } }) => {
    const active = pathname.startsWith(t.href);
    return (
      <Link
        key={t.href}
        href={t.href}
        className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
          active ? "text-brand-300" : "text-fg-faint"
        }`}
      >
        <span
          aria-hidden
          className={`grid h-8 w-12 place-items-center rounded-xl text-lg leading-none transition-all duration-200 ${
            active ? "mise-raised" : "opacity-80"
          }`}
        >
          {t.icon}
        </span>
        {t.label}
      </Link>
    );
  };

  return (
    <>
      {/* the everything-sheet: every section this user can open, grouped */}
      {sheet && (
        <>
          <div className="fixed inset-0 z-30 bg-black/55 backdrop-blur-[2px] lg:hidden" onClick={() => setSheet(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="All sections"
            className="mise-drawer-in fixed inset-x-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 max-h-[68dvh] overflow-y-auto overscroll-contain rounded-2xl border border-glass/15 bg-paper/[0.98] p-4 shadow-2xl shadow-black/60 backdrop-blur-xl lg:hidden"
          >
            <button
              type="button"
              onClick={() => {
                setSheet(false);
                onSearch();
              }}
              className="mise-well mise-press flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-sm text-fg-faint"
            >
              <span aria-hidden>⌕</span> Search or do anything…
              <span className="ml-auto rounded-full bg-copper-500/15 px-2 py-0.5 text-[10px] font-medium text-copper-300">1-click</span>
            </button>
            {NAV_GROUPS.map((g) => {
              const group = items.filter((n) => n.group === g);
              if (!group.length) return null;
              return (
                <div key={g} className="mt-4">
                  <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-faint">{g}</p>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {group.map((n) => {
                      const active = pathname.startsWith(n.href);
                      return (
                        <Link
                          key={n.href}
                          href={n.href}
                          className={`mise-raised mise-press flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-center text-[10px] font-medium leading-tight ${
                            active ? "text-brand-300 ring-1 ring-brand-400/40" : "text-fg-soft"
                          }`}
                        >
                          <span aria-hidden className="text-lg leading-none">{n.icon}</span>
                          <span className="line-clamp-2">{n.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <nav
        aria-label="Quick navigation"
        className="fixed inset-x-0 bottom-0 z-40 lg:hidden"
      >
        {/* the bar announces itself: a lit brand hairline above the shelf */}
        <span aria-hidden className="block h-[2px] bg-gradient-to-r from-transparent via-brand-400/70 to-transparent" />
        <div className="flex items-stretch justify-around border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(0,0,0,0.45)] backdrop-blur-md">
          {tabs.slice(0, 2).map((t) => (
            <Tab key={t.href} t={t} />
          ))}
          {/* centre launcher — raised out of the shelf, opens everything */}
          <button
            type="button"
            onClick={() => setSheet((v) => !v)}
            aria-label={sheet ? "Close sections" : "All sections"}
            aria-expanded={sheet}
            className="relative -mt-5 flex flex-col items-center px-2"
          >
            <span
              className={`mise-press grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-xl text-white shadow-lg shadow-brand-500/40 ring-4 ring-paper transition-transform duration-200 ${
                sheet ? "rotate-45" : ""
              }`}
              aria-hidden
            >
              ＋
            </span>
            <span className={`mt-1 pb-2 text-[10px] font-medium ${sheet ? "text-brand-300" : "text-fg-faint"}`}>All</span>
          </button>
          {tabs.slice(2, 4).map((t) => (
            <Tab key={t.href} t={t} />
          ))}
        </div>
      </nav>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pathname = usePathname();

  // ⌘K / Ctrl+K from anywhere; "g then <letter>" jumps (g d = dashboard,
  // g i = inventory, g s = sales, g m = money, g r = reports); "?" opens ⌘K.
  const gRef = useRef(0);
  useEffect(() => {
    const JUMPS: Record<string, string> = {
      d: "/dashboard", i: "/inventory", s: "/sales", m: "/money", r: "/reports", p: "/payroll",
    };
    const onJump = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.key.toLowerCase() === "g") {
        gRef.current = Date.now();
        return;
      }
      const target = JUMPS[e.key.toLowerCase()];
      if (target && Date.now() - gRef.current < 900) {
        e.preventDefault();
        window.location.assign(target);
      }
      gRef.current = 0;
    };
    window.addEventListener("keydown", onJump);
    return () => window.removeEventListener("keydown", onJump);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const { user, hotel } = useAuth();
  const { applyDefault } = useCurrency();
  const { theme } = useTheme();

  // Default the display currency to the hotel's currency (unless the user chose one).
  useEffect(() => {
    if (hotel?.base_currency) applyDefault(hotel.base_currency);
  }, [hotel, applyDefault]);

  // First-time visitors get the guided tour automatically (once). The tour lives
  // here — not on a page — so it survives the page-to-page navigation it drives.
  useEffect(() => {
    if (shouldAutoStartTour()) {
      const t = window.setTimeout(() => setTourOpen(true), 700);
      return () => window.clearTimeout(t);
    }
  }, []);
  useEffect(() => {
    const h = () => setTourOpen(true);
    window.addEventListener("mise:tour", h);
    return () => window.removeEventListener("mise:tour", h);
  }, []);

  const navItems = NAV.filter(
    (item) =>
      (!item.perm || can(user?.role, item.perm)) &&
      (!item.hideIfPerm || !can(user?.role, item.hideIfPerm)) &&
      (!item.feature || featureOn(hotel, item.feature))
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
        <div className="mt-auto p-3" />
      </aside>

      {/* Mobile slide-over */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="mise-fade absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="mise-drawer absolute left-0 top-0 flex h-full w-64 flex-col overflow-hidden border-r border-glass/10 bg-shell/95 shadow-2xl shadow-black/50 backdrop-blur-xl">
            <Brand />
            <div className="flex-1 overflow-y-auto overscroll-contain pb-6">
              <NavLinks items={navItems} pathname={pathname} onClick={() => setOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      <div className="relative flex min-h-screen flex-col lg:h-screen lg:min-h-0 lg:overflow-hidden">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-glass/10 bg-shell/70 px-3 py-3 backdrop-blur-xl sm:gap-3 sm:px-4 lg:px-8">
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-brand-400/30 to-transparent" />
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
          {/* ⌘K search — a well that invites the finger */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="mise-well mise-press hidden items-center gap-2.5 rounded-xl px-3.5 py-2 text-sm text-fg-faint transition hover:text-fg-soft sm:flex sm:w-56 lg:w-72"
            aria-label="Open command palette"
          >
            <span aria-hidden>⌕</span>
            <span className="flex-1 text-left">Jump to…</span>
            <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="mise-press rounded-lg p-2 text-fg-soft hover:bg-glass/5 sm:hidden"
            aria-label="Search"
          >
            ⌕
          </button>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
            <NotificationBell />
            <ThemeSwitcher />
            <div className="hidden sm:block">
              <CurrencySwitcher />
            </div>
            <UserMenu />
          </div>
        </header>

        {/* pb is generous so the floating "Ask Mise" launcher (bottom-right) never
            covers a page's last action button. */}
        <main className="flex-1 overflow-y-auto px-4 pb-28 pt-6 lg:px-8 lg:pb-28 lg:pt-8">
          <ImpersonationBanner />
          <AnnouncementBanner />
          {children}
        </main>
      </div>

      {/* Guided tour (walks through pages) + project-aware AI assistant. Both float
          on every page. The Copilot only appears when the hotel has AI enabled. */}
      <MobileTabBar onSearch={() => setPaletteOpen(true)} items={navItems} />
      <Tour open={tourOpen} onClose={() => setTourOpen(false)} />
      {featureOn(hotel, "ai_copilot") && <Copilot />}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={navItems.map((n) => ({ href: n.href, label: n.label, icon: n.icon, keywords: n.keywords, group: n.group }))}
      />
    </div>
  );
}
