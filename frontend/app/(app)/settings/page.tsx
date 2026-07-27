"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type HotelLanding, type LandingConfig } from "@/lib/api";
import HotelSite, { DEFAULT_LANDING, HERO_STYLES, LANDING_THEMES, PALETTES } from "@/components/site/HotelSite";
import { SITE_FONTS } from "@/components/site/fonts";
import { Card, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { CURRENCIES, type CurrencyCode, useCurrency } from "@/lib/currency";
import { numeric } from "@/lib/sanitize";

// Settings → Email alerts: what lands in your inbox is YOUR call, per action.
const ALERTS: { key: string; emoji: string; title: string; desc: string }[] = [
  { key: "new_order", emoji: "🛎️", title: "New online order",
    desc: "a customer places a pickup or delivery order from your public menu" },
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
        className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
          on ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// The alert sender is accounts@<our-domain>; derive it from the current host so
// it stays correct on any domain (takes the registrable domain, so a hotel
// subdomain like acme.dineai.cloud still shows accounts@dineai.cloud).
function senderEmail(): string {
  if (typeof window === "undefined") return "accounts@mise.app";
  const domain = window.location.hostname.split(".").slice(-2).join(".");
  return `accounts@${domain}`;
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

  // Hotel @username for the global chat directory.
  const [username, setUsername] = useState("");
  const [unameSuggestion, setUnameSuggestion] = useState("");
  const [unameMsg, setUnameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [unameBusy, setUnameBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    api.get<{ username: string | null; suggestion: string }>("/talent/me/username")
      .then((r) => { setUsername(r.username ?? ""); setUnameSuggestion(r.suggestion); })
      .catch(() => {});
  }, [isAdmin]);

  async function saveUsername() {
    setUnameBusy(true); setUnameMsg(null);
    try {
      const r = await api.post<{ username: string }>("/talent/me/username", { username });
      setUsername(r.username);
      setUnameMsg({ ok: true, text: "Saved — other hotels can find you at @" + r.username });
    } catch (e) {
      setUnameMsg({ ok: false, text: e instanceof ApiError ? e.message : "Could not save" });
    } finally { setUnameBusy(false); }
  }

  // Public landing page (<username>.dineai.cloud) — customizable branding.
  const [land, setLand] = useState<LandingConfig>({});
  const [landBusy, setLandBusy] = useState(false);
  const [landSaved, setLandSaved] = useState(false);
  useEffect(() => { if (hotel?.landing) setLand(hotel.landing); }, [hotel?.landing]);
  function setL<K extends keyof LandingConfig>(k: K, v: LandingConfig[K]) {
    setLand((p) => ({ ...p, [k]: v }));
    setLandSaved(false);
  }
  async function saveLanding() {
    setLandBusy(true);
    try {
      await api.patch("/hotels/me", { landing: land });
      await refreshHotel();
      setLandSaved(true);
    } catch { /* keep the form; a transient failure shouldn't wipe edits */ }
    finally { setLandBusy(false); }
  }
  // Feed the REAL site component with this hotel, so the preview is the page.
  const previewData: HotelLanding = {
    hotel_id: hotel?.id ?? "preview",
    name: hotel?.name || "Your restaurant",
    username: hotel?.username ?? null,
    city: hotel?.city ?? null,
    has_logo: !!hotel?.has_logo,
    logo_url: hotel?.id && hotel?.has_logo ? `/api/hotels/${hotel.id}/logo` : null,
    order_url: hotel?.id ? `/order/${hotel.id}` : "#",
    landing: { ...DEFAULT_LANDING, ...(hotel?.landing ?? {}) },
  };

  const siteHost = hotel?.username
    ? `${hotel.username}.${typeof window !== "undefined" ? window.location.hostname.split(".").slice(-2).join(".") : "dineai.cloud"}`
    : null;

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
          ...(isAdmin ? [["#s-handle", "🆔 Hotel handle"], ["#s-site", "🌐 Public page"]] : []),
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
          Sent from <b className="text-fg-soft">{senderEmail()}</b> to{" "}
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

      {isAdmin && (
        <Card className="mise-feel mb-6" id="s-handle">
          <h3 className="font-semibold text-fg">🆔 Your hotel handle (@username)</h3>
          <p className="mt-1 text-sm text-fg-faint">
            Pick a unique handle so other Mise hotels can find you in{" "}
            <b className="text-fg-soft">Messages → New</b> and start a chat about lending or
            hiring staff. 3–40 lowercase letters, numbers or underscores.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-fg-faint">@</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              placeholder={unameSuggestion || "your_hotel"}
              className="mise-well w-56 rounded-lg px-3 py-2 text-sm text-fg outline-none"
            />
            <button
              onClick={saveUsername}
              disabled={unameBusy || username.length < 3}
              className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {unameBusy ? "Saving…" : "Save handle"}
            </button>
            {!username && unameSuggestion && (
              <button onClick={() => setUsername(unameSuggestion)} className="text-xs text-brand-400 underline">
                use @{unameSuggestion}
              </button>
            )}
          </div>
          {unameMsg && (
            <p className={`mt-2 text-sm ${unameMsg.ok ? "text-emerald-500" : "text-rose-400"}`}>{unameMsg.text}</p>
          )}
        </Card>
      )}

      {isAdmin && (
        <Card className="mise-feel mb-6" id="s-site">
          <h3 className="font-semibold text-fg">🌐 Your public page</h3>
          <p className="mt-1 text-sm text-fg-faint">
            The branded page shown at{" "}
            {siteHost ? (
              <a href={`https://${siteHost}`} target="_blank" rel="noreferrer" className="text-brand-400 underline">
                {siteHost}
              </a>
            ) : (
              <span>your subdomain — set a handle above first</span>
            )}
            . Customize it below; it goes live the moment you save.
          </p>

          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            {/* ── editor ─────────────────────────────────────────────── */}
            <div className="space-y-5">
              {/* hero photo */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-fg-faint">Hero photo</span>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {HERO_STYLES.map((h) => {
                    const on = (land.hero ?? "warm") === h.key;
                    return (
                      <button
                        key={h.key}
                        type="button"
                        onClick={() => setL("hero", h.key)}
                        title={h.label}
                        className={`group relative aspect-[16/10] overflow-hidden rounded-xl border-2 transition ${on ? "border-brand-500" : "border-transparent hover:border-line"}`}
                      >
                        <span
                          className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-110"
                          style={{ backgroundImage: `url(/site/hero-${h.key}.jpg)` }}
                        />
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-[9px] font-semibold text-white">
                          {h.label}
                        </span>
                        {on && <span className="absolute right-1 top-1 rounded-full bg-brand-500 px-1 text-[9px] font-bold text-white">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* theme + accent */}
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-fg-faint">Theme</span>
                  <div className="mt-1.5 flex gap-1.5">
                    {LANDING_THEMES.map((th) => {
                      const on = (land.theme ?? "dark") === th.key;
                      return (
                        <button
                          key={th.key}
                          type="button"
                          onClick={() => setL("theme", th.key)}
                          className={`rounded-lg border px-3 py-1.5 text-xs ${on ? "border-brand-500 bg-brand-500/10 text-fg" : "border-line text-fg-faint hover:bg-paper-2"}`}
                        >
                          {th.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* colour palette — a dual-tone pair drives every gradient */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-fg-faint">Colour palette</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PALETTES.map((pl) => {
                    const on = (land.accent ?? "").toLowerCase() === pl.a && (land.accent2 ?? "").toLowerCase() === pl.b;
                    return (
                      <button
                        key={pl.key}
                        type="button"
                        title={pl.label}
                        onClick={() => { setL("accent", pl.a); setL("accent2", pl.b); }}
                        className={`h-9 w-9 rounded-full border-2 transition hover:scale-110 ${on ? "border-fg" : "border-transparent"}`}
                        style={{ background: `linear-gradient(135deg, ${pl.a}, ${pl.b})` }}
                      />
                    );
                  })}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-fg-faint">
                    From
                    <input
                      type="color"
                      value={land.accent || "#4f46e5"}
                      onChange={(e) => setL("accent", e.target.value)}
                      className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-fg-faint">
                    To
                    <input
                      type="color"
                      value={land.accent2 || "#0ea5e9"}
                      onChange={(e) => setL("accent2", e.target.value)}
                      className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent"
                    />
                  </label>
                  <span
                    className="h-7 flex-1 rounded-lg"
                    style={{ background: `linear-gradient(135deg, ${land.accent || "#4f46e5"}, ${land.accent2 || "#0ea5e9"})` }}
                  />
                </div>
              </div>

              {/* display font */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-fg-faint">Display font</span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SITE_FONTS.map((f) => {
                    const on = (land.font ?? "serif") === f.key;
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setL("font", f.key)}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition ${f.className} ${on ? "border-brand-500 bg-brand-500/10 text-fg" : "border-line text-fg-faint hover:bg-paper-2"}`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
                <label className="mt-2 flex items-center gap-2 text-sm text-fg-soft">
                  <input
                    type="checkbox"
                    checked={land.title_gradient !== false}
                    onChange={(e) => setL("title_gradient", e.target.checked)}
                  />
                  Paint the name with the gradient
                </label>
              </div>

              {/* wording */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-fg-soft">Tagline <span className="text-fg-faint">(under your name)</span></label>
                  <input
                    value={land.tagline || ""}
                    maxLength={90}
                    onChange={(e) => setL("tagline", e.target.value)}
                    placeholder="Authentic South-Indian, since 1998"
                    className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm text-fg outline-none"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-[130px_1fr]">
                  <div>
                    <label className="text-xs font-medium text-fg-soft">Story heading</label>
                    <input
                      value={land.about_title ?? ""}
                      maxLength={40}
                      onChange={(e) => setL("about_title", e.target.value)}
                      placeholder="Our story"
                      className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm text-fg outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-fg-soft">Story</label>
                    <textarea
                      value={land.about || ""}
                      maxLength={400}
                      rows={3}
                      onChange={(e) => setL("about", e.target.value)}
                      placeholder="A short paragraph about your restaurant…"
                      className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm text-fg outline-none"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                  <div>
                    <label className="text-xs font-medium text-fg-soft">Quote</label>
                    <input
                      value={land.quote || ""}
                      maxLength={140}
                      onChange={(e) => setL("quote", e.target.value)}
                      placeholder="A line you love"
                      className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm text-fg outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-fg-soft">Said by</label>
                    <input
                      value={land.quote_by || ""}
                      maxLength={40}
                      onChange={(e) => setL("quote_by", e.target.value)}
                      placeholder="Chef Anand"
                      className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm text-fg outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* visit us */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-fg-faint">Visit us</span>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  <input
                    value={land.address || ""}
                    maxLength={120}
                    onChange={(e) => setL("address", e.target.value)}
                    placeholder="Address"
                    className="mise-well w-full rounded-lg px-3 py-2 text-sm text-fg outline-none"
                  />
                  <input
                    value={land.phone || ""}
                    maxLength={40}
                    onChange={(e) => setL("phone", e.target.value)}
                    placeholder="Phone"
                    className="mise-well w-full rounded-lg px-3 py-2 text-sm text-fg outline-none"
                  />
                  <input
                    value={land.hours || ""}
                    maxLength={80}
                    onChange={(e) => setL("hours", e.target.value)}
                    placeholder="Mon–Sun · 12–11"
                    className="mise-well w-full rounded-lg px-3 py-2 text-sm text-fg outline-none"
                  />
                </div>
                <p className="mt-1 text-[11px] text-fg-faint">Leave any of these blank to hide that card.</p>
              </div>

              {/* switches */}
              <div className="space-y-2 border-t border-line pt-4">
                <label className="flex items-center gap-2 text-sm text-fg-soft">
                  <input type="checkbox" checked={!!land.show_gallery} onChange={(e) => setL("show_gallery", e.target.checked)} />
                  Show the dish gallery
                </label>
                <label className="flex items-center gap-2 text-sm text-fg-soft">
                  <input type="checkbox" checked={!!land.show_order} onChange={(e) => setL("show_order", e.target.checked)} />
                  Show an ordering button
                </label>
                {land.show_order && (
                  <input
                    value={land.cta_label ?? ""}
                    maxLength={26}
                    onChange={(e) => setL("cta_label", e.target.value)}
                    placeholder="Order online"
                    className="mise-well ml-6 w-56 rounded-lg px-3 py-1.5 text-sm text-fg outline-none"
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  onClick={saveLanding}
                  disabled={landBusy}
                  className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {landBusy ? "Saving…" : "Save public page"}
                </button>
                {landSaved && <span className="text-sm text-emerald-500">✓ Saved — it’s live</span>}
                {siteHost && (
                  <a href={`https://${siteHost}`} target="_blank" rel="noreferrer" className="text-sm text-brand-400 underline">
                    Open it →
                  </a>
                )}
              </div>
            </div>

            {/* ── the REAL page, live ────────────────────────────────── */}
            <div className="lg:sticky lg:top-4 lg:self-start">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-fg-faint">Live preview</p>
                <p className="text-[11px] text-fg-faint">scroll it ↓</p>
              </div>
              <div className="overflow-hidden rounded-2xl border border-line shadow-2xl shadow-black/30">
                <div className="flex items-center gap-1.5 border-b border-line bg-paper-2 px-3 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                  <span className="ml-2 truncate text-[11px] text-fg-faint">{siteHost || "yourhandle.dineai.cloud"}</span>
                </div>
                <div className="max-h-[560px] overflow-y-auto overscroll-contain">
                  <HotelSite data={previewData} config={land} preview />
                </div>
              </div>
            </div>
          </div>
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
