"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { CURRENCIES, type CurrencyCode, useCurrency } from "@/lib/currency";
import { numeric } from "@/lib/sanitize";

// Settings → Email alerts: what lands in your inbox is YOUR call, per action.
const ALERTS: { key: string; emoji: string; title: string; desc: string }[] = [
  { key: "job_application", emoji: "🧑‍🍳", title: "New job applicant",
    desc: "someone applies to one of your vacancies on the careers board" },
  { key: "price_rise", emoji: "📈", title: "Supplier price rise",
    desc: "a vendor moves a price UP — every dish using that item just got costlier" },
  { key: "low_stock", emoji: "📉", title: "Low stock",
    desc: "an item crosses below its minimum level — time to reorder" },
  { key: "broadcast", emoji: "📣", title: "Mise announcements",
    desc: "important platform notes from the Mise team" },
  { key: "security_login", emoji: "🛡️", title: "Every sign-in",
    desc: "a heads-up email each time your account is opened (quiet by default)" },
];

function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`mise-press relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
        on ? "bg-brand-500" : "mise-well bg-line/60"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
          on ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const { currency, setCurrency } = useCurrency();
  const { user, hotel, refreshHotel } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN";

  const [allowance, setAllowance] = useState("0");
  const [penalty, setPenalty] = useState("0");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [savedPolicy, setSavedPolicy] = useState(false);

  const [minWage, setMinWage] = useState("11.44");
  const [savingWage, setSavingWage] = useState(false);
  const [savedWage, setSavedWage] = useState(false);

  // Email alerts + two-step sign-in (per-user, stored server-side).
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  const [twofa, setTwofa] = useState(false);

  useEffect(() => {
    api
      .get<{ prefs: Record<string, boolean>; twofa_email: boolean }>("/auth/me/notifications")
      .then((r) => {
        setPrefs(r.prefs);
        setTwofa(r.twofa_email);
      })
      .catch(() => setPrefs({}));
  }, []);

  function togglePref(key: string) {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next); // optimistic — the switch answers instantly
    api.patch("/auth/me/notifications", { prefs: { [key]: next[key] } }).catch(() => {
      setPrefs(prefs); // roll back on failure
    });
  }

  function toggleTwofa() {
    const next = !twofa;
    setTwofa(next);
    api.patch("/auth/me/notifications", { twofa_email: next }).catch(() => setTwofa(!next));
  }

  // Stripe billing (test mode) — owner only.
  const [billing, setBilling] = useState<{
    configured: boolean;
    status: string;
    has_customer: boolean;
    test_mode: boolean;
  } | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingBanner, setBillingBanner] = useState<"success" | "cancelled" | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    api.get<typeof billing>("/billing/status").then(setBilling).catch(() => setBilling(null));
    const flag = new URLSearchParams(window.location.search).get("billing");
    if (flag === "success" || flag === "cancelled") {
      setBillingBanner(flag);
      window.history.replaceState(null, "", "/settings"); // don't re-announce on refresh
    }
  }, [isAdmin]);

  async function goToStripe(path: "/billing/checkout" | "/billing/portal") {
    setBillingBusy(true);
    try {
      const r = await api.post<{ url: string }>(path, {});
      window.location.assign(r.url); // Stripe hosts the page; card details never touch us
    } catch {
      setBillingBusy(false);
    }
  }

  const SUB_TONE: Record<string, string> = {
    free: "bg-line/40 text-fg-soft",
    trialing: "bg-sky-500/15 text-sky-400",
    active: "bg-emerald-500/15 text-emerald-400",
    past_due: "bg-amber-500/15 text-amber-500",
    canceled: "bg-rose-500/15 text-rose-400",
  };

  useEffect(() => {
    if (hotel) {
      setAllowance(String(hotel.break_allowance_minutes ?? 0));
      setPenalty(hotel.break_penalty_per_min ?? "0");
      setMinWage(hotel.min_hourly_rate ?? "11.44");
    }
  }, [hotel]);

  async function saveMinWage(e: React.FormEvent) {
    e.preventDefault();
    setSavingWage(true);
    setSavedWage(false);
    try {
      await api.patch("/hotels/me", { min_hourly_rate: minWage || "0" });
      await refreshHotel();
      setSavedWage(true);
    } finally {
      setSavingWage(false);
    }
  }

  async function saveBreakPolicy(e: React.FormEvent) {
    e.preventDefault();
    setSavingPolicy(true);
    setSavedPolicy(false);
    try {
      await api.patch("/hotels/me", {
        break_allowance_minutes: parseInt(allowance || "0", 10),
        break_penalty_per_min: penalty || "0",
      });
      setSavedPolicy(true);
    } finally {
      setSavingPolicy(false);
    }
  }

  const inputCls = "mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none";

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Display preferences, house rules and account." />

      <div className="mise-well mb-6 flex flex-wrap gap-1.5 rounded-xl p-1.5">
        {[
          ["#s-display", "💱 Display"],
          ["#s-alerts", "🔔 Email & 2FA"],
          ...(isAdmin
            ? [["#s-billing", "💳 Billing"], ["#s-attendance", "⏱️ Attendance rules"], ["#s-payroll", "💷 Payroll"]]
            : []),
          ["#s-account", "👤 Account"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="mise-raised mise-press rounded-lg px-3 py-1.5 text-xs font-medium text-fg-soft">
            {label}
          </a>
        ))}
      </div>

      <Card className="mise-feel mb-6" id="s-display">
        <h3 className="font-semibold text-fg">Display currency</h3>
        <p className="mt-1 text-sm text-fg-faint">
          Amounts are stored in the restaurant&apos;s base currency (GBP). This converts
          what you see — it doesn&apos;t change the underlying figures.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {(Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => {
            const active = currency === code;
            return (
              <button
                key={code}
                onClick={() => setCurrency(code)}
                className={`mise-press flex items-center justify-between rounded-lg border px-4 py-3 text-left transition ${
                  active
                    ? "border-brand-500 bg-brand-400/10"
                    : "mise-raised border-line"
                }`}
              >
                <span className="font-medium text-fg">
                  {CURRENCIES[code].symbol} {code}
                </span>
                <span className="text-sm text-fg-faint">{CURRENCIES[code].label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-fg-faint">
          Indicative rates (per £1): {" "}
          {(Object.keys(CURRENCIES) as CurrencyCode[])
            .map((c) => `${CURRENCIES[c].symbol}${CURRENCIES[c].rate}`)
            .join("  ·  ")}
        </p>
      </Card>

      <Card className="mise-feel mb-6" id="s-alerts">
        <h3 className="font-semibold text-fg">Email alerts</h3>
        <p className="mt-1 text-sm text-fg-faint">
          Sent from <b className="text-fg-soft">accounts@milagurestaurant.com</b> to{" "}
          <b className="text-fg-soft">{user?.email}</b>. Pick exactly which moments deserve an
          email — everything else stays in the app.
        </p>
        <div className="mt-4 space-y-1">
          {ALERTS.map((a) => (
            <div
              key={a.key}
              className="flex items-center justify-between gap-4 rounded-xl px-3 py-2.5 transition hover:bg-fg/[0.03]"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 text-lg" aria-hidden>{a.emoji}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{a.title}</p>
                  <p className="text-xs text-fg-faint">{a.desc}</p>
                </div>
              </div>
              {prefs ? (
                <Switch on={!!prefs[a.key]} onToggle={() => togglePref(a.key)} label={a.title} />
              ) : (
                <span className="h-6 w-11 animate-pulse rounded-full bg-line/50" />
              )}
            </div>
          ))}
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-4 rounded-xl px-3 py-2.5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 text-lg" aria-hidden>🔐</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">Two-step sign-in (2FA)</p>
                <p className="text-xs text-fg-faint">
                  after your password, a 6-digit code lands in your inbox — even a stolen
                  password can&apos;t open your kitchen
                </p>
              </div>
            </div>
            <Switch on={twofa} onToggle={toggleTwofa} label="Two-step sign-in" />
          </div>
          <p className="mt-2 px-3 text-xs text-fg-faint">
            📱 SMS codes to your phone are coming later (needs an SMS provider) — email codes
            work today.
          </p>
        </div>
      </Card>

      {isAdmin && (
        <Card className="mise-feel mb-6" id="s-billing">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-fg">Billing</h3>
            {billing && (
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${
                  SUB_TONE[billing.status] ?? SUB_TONE.free
                }`}
              >
                {billing.status === "free" ? "no subscription" : billing.status.replace("_", " ")}
              </span>
            )}
          </div>
          {billingBanner === "success" && (
            <p className="mise-tick-in mt-3 rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-500">
              🎉 Subscription started — welcome to Mise Pro! Stripe will email your invoices.
            </p>
          )}
          {billingBanner === "cancelled" && (
            <p className="mt-3 rounded-xl bg-line/30 px-3.5 py-2.5 text-sm text-fg-soft">
              Checkout closed — nothing was charged. Come back any time.
            </p>
          )}
          <p className="mt-1 text-sm text-fg-faint">
            Mise Pro: £49/month per venue, 14-day free trial. Payments run on Stripe&apos;s
            hosted checkout — your card details never touch our servers.
          </p>
          {billing?.test_mode && (
            <p className="mise-well mt-3 rounded-xl px-3.5 py-2.5 text-xs text-fg-soft">
              🧪 <b>Test mode</b> — no real money. Use card{" "}
              <code className="font-mono text-fg">4242 4242 4242 4242</code>, any future expiry,
              any CVC. Card <code className="font-mono text-fg">4000 0000 0000 0341</code> fails
              on purpose (to try the past-due flow).
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            {billing && !billing.configured ? (
              <p className="text-sm text-fg-faint">Billing isn&apos;t configured on this server yet.</p>
            ) : (
              <>
                {billing && (billing.status === "free" || billing.status === "canceled") && (
                  <button
                    type="button"
                    disabled={billingBusy}
                    onClick={() => goToStripe("/billing/checkout")}
                    className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    {billingBusy ? "Opening Stripe…" : "Start 14-day free trial →"}
                  </button>
                )}
                {billing?.has_customer && (
                  <button
                    type="button"
                    disabled={billingBusy}
                    onClick={() => goToStripe("/billing/portal")}
                    className="mise-raised mise-press rounded-lg px-4 py-2 text-sm font-medium text-fg-soft"
                  >
                    Manage billing (card, invoices, cancel)
                  </button>
                )}
              </>
            )}
          </div>
        </Card>
      )}

      {isAdmin && (
        <Card className="mise-feel mb-6" id="s-attendance">
          <h3 className="font-semibold text-fg">Attendance: break &amp; penalty policy</h3>
          <p className="mt-1 text-sm text-fg-faint">
            Paid break minutes allowed per shift. Minutes beyond this are flagged on the
            timesheet and charged at the penalty rate below.
          </p>
          <form onSubmit={saveBreakPolicy} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-48">
              <label className="block text-sm font-medium text-fg-soft">Break allowance (minutes)</label>
              <input value={allowance} onChange={(e) => setAllowance(e.target.value)} inputMode="numeric" className={inputCls} />
            </div>
            <div className="sm:w-48">
              <label className="block text-sm font-medium text-fg-soft">
                Penalty per extra minute ({hotel?.base_currency ?? "GBP"})
              </label>
              <input value={penalty} onChange={(e) => setPenalty(e.target.value)} inputMode="decimal" className={inputCls} />
            </div>
            <button type="submit" disabled={savingPolicy} className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {savingPolicy ? "Saving…" : "Save policy"}
            </button>
            {savedPolicy && <span className="text-sm text-brand-400">Saved ✓</span>}
          </form>
          <p className="mt-2 text-xs text-fg-faint">
            Set allowance to 0 with a 0 penalty to disable break penalties.
          </p>
        </Card>
      )}

      {isAdmin && (
        <Card className="mise-feel mb-6" id="s-payroll">
          <h3 className="font-semibold text-fg">Payroll: minimum wage</h3>
          <p className="mt-1 text-sm text-fg-faint">
            The lowest hourly rate you&apos;re allowed to pay. Payroll blocks any run where
            an hourly employee&apos;s rate is below this. Set it to your country&apos;s statutory
            minimum (UK 2024 = £11.44) and update it when the law changes.
          </p>
          <form onSubmit={saveMinWage} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-56">
              <label className="block text-sm font-medium text-fg-soft">
                Minimum hourly rate ({hotel?.base_currency ?? "GBP"})
              </label>
              <input
                value={minWage}
                onChange={(e) => setMinWage(numeric(e.target.value))}
                inputMode="decimal"
                className={inputCls}
              />
            </div>
            <button type="submit" disabled={savingWage} className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {savingWage ? "Saving…" : "Save"}
            </button>
            {savedWage && <span className="text-sm text-brand-400">Saved ✓</span>}
          </form>
        </Card>
      )}

      <Card className="mise-feel mb-6" id="s-account">
        <h3 className="font-semibold text-fg">Account</h3>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-fg-faint">Email</dt>
            <dd className="font-medium text-fg">{user?.email}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">Role</dt>
            <dd className="font-medium text-fg">{user?.role.replace(/_/g, " ")}</dd>
          </div>
        </dl>
      </Card>

      <Card className="mise-feel border-rose-500/30">
        <h3 className="font-semibold text-rose-300">Danger zone</h3>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-fg">Reset this device&apos;s local data</p>
            <p className="text-xs text-fg-faint">clears theme, dismissed banners, tour progress and cached preferences on THIS browser — your restaurant data is untouched</p>
          </div>
          <button
            type="button"
            onClick={() => {
              try {
                const keep = localStorage.getItem("mise_token");
                localStorage.clear();
                if (keep) localStorage.setItem("mise_token", keep);
              } catch { /* ignore */ }
              window.location.reload();
            }}
            className="mise-press rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm font-medium text-rose-300 hover:bg-rose-500/10"
          >
            Reset local data
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div>
            <p className="text-sm text-fg">Close your Mise account</p>
            <p className="text-xs text-fg-faint">handled personally so nothing is lost by accident — email us and we action it same-day</p>
          </div>
          <a href="mailto:support@mise.app?subject=Close%20my%20Mise%20account" className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-fg-soft">
            Contact support
          </a>
        </div>
      </Card>
    </div>
  );
}
