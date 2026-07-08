"use client";

// 🛰️ CONTROL ROOM — the Mise operator's cross-tenant console. Lists every hotel,
// lets us toggle per-hotel features (entitlements → future plan tiers) and reset
// any user's password. Gated to is_platform_owner (server-enforced too).

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, API_BASE, ApiError } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner, StatCard } from "@/components/ui";
import { Select } from "@/components/Select";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";

type FeatureDef = { key: string; label: string; description: string; default: boolean; enforced: boolean };
type PlanDef = {
  key: string; label: string; price_hint: string; max_users: number;
  blurb: string; highlights: string[]; off_features: string[];
};
type HotelRow = {
  id: string; name: string; city: string | null; country: string; base_currency: string;
  created_at: string; has_logo: boolean; is_active: boolean;
  user_count: number; admin_email: string | null; plan: string; max_users: number;
  features: Record<string, boolean>;
};
type HotelUser = { id: string; email: string; role: string; is_active: boolean };

const PLAN_TONE: Record<string, "slate" | "amber" | "green"> = {
  starter: "slate", pro: "amber", enterprise: "green",
};

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
        on ? "bg-brand-500" : "bg-glass/20"
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

function HotelCard({
  hotel, features, plans, onToggle, onApplyPlan,
}: {
  hotel: HotelRow;
  features: FeatureDef[];
  plans: PlanDef[];
  onToggle: (key: string, value: boolean) => Promise<void>;
  onApplyPlan: (plan: string) => Promise<void>;
}) {
  const confirm = useConfirm();
  const [resetOpen, setResetOpen] = useState(false);
  const [users, setUsers] = useState<HotelUser[] | null>(null);
  const [targetId, setTargetId] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [planSel, setPlanSel] = useState(hotel.plan);
  const [planBusy, setPlanBusy] = useState(false);

  async function applyPlan() {
    if (planSel === hotel.plan) return;
    const p = plans.find((x) => x.key === planSel);
    const ok = await confirm({
      title: `Move ${hotel.name} to ${p?.label ?? planSel}?`,
      message: "This applies that plan's feature preset (you can still fine-tune toggles after).",
      confirmText: "Apply plan",
    });
    if (!ok) return;
    setPlanBusy(true);
    try { await onApplyPlan(planSel); } finally { setPlanBusy(false); }
  }

  const created = new Date(hotel.created_at).toLocaleDateString();

  async function openReset() {
    setResetOpen((o) => !o);
    setMsg(null);
    if (users === null) {
      try {
        const res = await api.get<{ users: HotelUser[] }>(`/platform/hotels/${hotel.id}/users`);
        setUsers(res.users);
        const admin = res.users.find((u) => u.email === hotel.admin_email) ?? res.users[0];
        if (admin) setTargetId(admin.id);
      } catch {
        setUsers([]);
      }
    }
  }

  async function doToggle(key: string, value: boolean) {
    setBusyKey(key);
    try { await onToggle(key, value); } finally { setBusyKey(null); }
  }

  async function submitReset() {
    if (!targetId || pw.length < 8) return;
    const who = users?.find((u) => u.id === targetId)?.email ?? "this user";
    const ok = await confirm({
      title: "Reset this password?",
      message: `Set a new password for ${who} at ${hotel.name}. They'll need the new password to log in.`,
      confirmText: "Reset password",
    });
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.post<{ ok: boolean; email: string }>(
        `/platform/hotels/${hotel.id}/reset-password`,
        { user_id: targetId, new_password: pw },
      );
      setMsg(`✓ Password updated for ${res.email}. Share “${pw}” with them securely.`);
      setPw("");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not reset password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      {/* header */}
      <div className="flex items-start gap-3">
        {hotel.has_logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${API_BASE}/api/hotels/${hotel.id}/logo`}
            alt=""
            className="h-11 w-11 shrink-0 rounded-xl object-contain ring-1 ring-glass/15"
          />
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-lg font-semibold text-brand-300 ring-1 ring-brand-400/30">
            {hotel.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-fg">{hotel.name}</h3>
            <Badge tone={PLAN_TONE[hotel.plan] ?? "slate"}>{hotel.plan}</Badge>
            {!hotel.is_active && <Badge tone="red">inactive</Badge>}
          </div>
          <p className="truncate text-xs text-fg-faint">
            {[hotel.city, hotel.country].filter(Boolean).join(" · ")} · {hotel.base_currency} · joined {created}
          </p>
          <p className="mt-0.5 truncate text-xs text-fg-soft">
            👤 {hotel.admin_email ?? "—"} · {hotel.user_count}/{hotel.max_users >= 100000 ? "∞" : hotel.max_users} user{hotel.user_count === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {/* plan */}
      <div className="rounded-xl border border-line bg-paper-2/40 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Subscription plan</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[9rem] flex-1">
            <Select
              value={planSel}
              onChange={setPlanSel}
              options={plans.map((p) => ({ value: p.key, label: `${p.label} · ${p.price_hint}` }))}
            />
          </div>
          <button
            type="button"
            onClick={applyPlan}
            disabled={planBusy || planSel === hotel.plan}
            className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {planBusy ? "Applying…" : "Apply plan"}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-fg-faint">
          Applying a plan sets its feature preset + user limit. You can still fine-tune individual toggles below.
        </p>
      </div>

      {/* feature toggles */}
      <div className="rounded-xl border border-line bg-paper-2/40 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Features</p>
        <div className="space-y-2">
          {features.map((f) => {
            const on = hotel.features[f.key] !== false;
            return (
              <div key={f.key} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm text-fg">{f.label}</span>
                  <span className="block truncate text-[11px] text-fg-faint">{f.description}</span>
                </span>
                <Toggle on={on} disabled={busyKey === f.key} onChange={(v) => doToggle(f.key, v)} />
              </div>
            );
          })}
        </div>
      </div>

      {/* password reset */}
      <div>
        <button
          type="button"
          onClick={openReset}
          className="rounded-lg border border-line-2 px-3 py-1.5 text-sm font-medium text-fg-soft transition hover:bg-paper-2"
        >
          🔑 {resetOpen ? "Close" : "Reset a password"}
        </button>
        {resetOpen && (
          <div className="mise-fade mt-3 space-y-2 rounded-xl border border-line bg-paper-2/40 p-3">
            {users === null ? (
              <p className="text-sm text-fg-faint">Loading users…</p>
            ) : users.length === 0 ? (
              <p className="text-sm text-fg-faint">No users in this hotel.</p>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-fg-faint">User</label>
                  <div className="mt-1">
                    <Select
                      value={targetId}
                      onChange={setTargetId}
                      options={users.map((u) => ({ value: u.id, label: `${u.email} · ${u.role.replace(/_/g, " ")}` }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-fg-faint">New password (min 8)</label>
                  <input
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="temporary password"
                    className="mt-1 w-full rounded-lg border border-line-2 bg-glass/5 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
                  />
                </div>
                <button
                  type="button"
                  onClick={submitReset}
                  disabled={busy || !targetId || pw.length < 8}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {busy ? "Setting…" : "Set password"}
                </button>
                {msg && <p className="text-xs text-fg-soft">{msg}</p>}
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function ControlRoomPage() {
  const { user } = useAuth();
  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [plans, setPlans] = useState<PlanDef[]>([]);
  const [hotels, setHotels] = useState<HotelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const [f, p, h] = await Promise.all([
      api.get<{ features: FeatureDef[] }>("/platform/features"),
      api.get<{ plans: PlanDef[] }>("/platform/plans"),
      api.get<{ hotels: HotelRow[] }>("/platform/hotels"),
    ]);
    setFeatures(f.features);
    setPlans(p.plans);
    setHotels(h.hotels);
  }, []);

  async function applyPlan(hotelId: string, plan: string) {
    const res = await api.post<{ plan: string; features: Record<string, boolean> }>(
      `/platform/hotels/${hotelId}/plan`, { plan },
    );
    const maxUsers = plans.find((p) => p.key === res.plan)?.max_users ?? 100000;
    setHotels((hs) => hs.map((h) =>
      h.id === hotelId ? { ...h, plan: res.plan, features: res.features, max_users: maxUsers } : h,
    ));
  }

  useEffect(() => {
    if (!user?.is_platform_owner) { setLoading(false); return; }
    load().catch(() => setErr("Could not load the Control Room.")).finally(() => setLoading(false));
  }, [load, user]);

  // Plan-price editor (operator sets the displayed prices; the landing reads them).
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [savingPrices, setSavingPrices] = useState(false);
  const [priceMsg, setPriceMsg] = useState<string | null>(null);
  useEffect(() => {
    setPriceEdits(Object.fromEntries(plans.map((p) => [p.key, p.price_hint])));
  }, [plans]);

  async function savePrices() {
    setSavingPrices(true);
    setPriceMsg(null);
    try {
      const res = await api.patch<{ plans: PlanDef[] }>("/platform/plans/prices", { prices: priceEdits });
      setPlans(res.plans);
      setPriceMsg("Saved ✓ — live on the landing page.");
    } catch {
      setPriceMsg("Could not save prices.");
    } finally {
      setSavingPrices(false);
    }
  }

  async function toggle(hotelId: string, key: string, value: boolean) {
    const prev = hotels;
    setHotels((hs) => hs.map((h) => (h.id === hotelId ? { ...h, features: { ...h.features, [key]: value } } : h)));
    try {
      const res = await api.patch<{ features: Record<string, boolean> }>(
        `/platform/hotels/${hotelId}/features`, { features: { [key]: value } },
      );
      setHotels((hs) => hs.map((h) => (h.id === hotelId ? { ...h, features: res.features } : h)));
    } catch {
      setHotels(prev); // revert on failure
    }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return hotels;
    return hotels.filter((h) =>
      h.name.toLowerCase().includes(s) || (h.admin_email ?? "").toLowerCase().includes(s) || (h.city ?? "").toLowerCase().includes(s),
    );
  }, [hotels, q]);

  if (!user?.is_platform_owner) return <Spinner />; // layout redirects; this is a flash-guard
  if (loading) return <Spinner />;

  const totalUsers = hotels.reduce((s, h) => s + h.user_count, 0);
  const aiOn = hotels.filter((h) => h.features["ai_copilot"] !== false).length;
  const active = hotels.filter((h) => h.is_active).length;

  return (
    <div>
      <PageHeader title="All hotels" subtitle="Every restaurant on Mise — flip features, reset access, all in one place." />

      {err && <Card className="mb-4"><p className="text-sm text-rose-400">{err}</p></Card>}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Hotels" value={String(hotels.length)} accent="brand" hint={`${active} active`} />
        <StatCard label="Total users" value={String(totalUsers)} accent="slate" />
        <StatCard label="AI enabled" value={`${aiOn}/${hotels.length}`} accent="copper" hint="Ask Mise" />
        <StatCard label="Features" value={String(features.length)} accent="amber" hint="per hotel" />
      </div>

      {plans.length > 0 && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-fg">Plans &amp; pricing</h3>
              <p className="text-xs text-fg-faint">Edit each plan&apos;s displayed price — it updates the public pricing page instantly.</p>
            </div>
            <button
              onClick={savePrices}
              disabled={savingPrices}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {savingPrices ? "Saving…" : "Save prices"}
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {plans.map((p) => (
              <div key={p.key} className="rounded-xl border border-line bg-paper-2/40 p-3">
                <p className="flex items-center justify-between text-sm font-medium text-fg">
                  {p.label}
                  <span className="text-[11px] text-fg-faint">
                    {p.max_users >= 100000 ? "∞ users" : `${p.max_users} users`}
                  </span>
                </p>
                <input
                  value={priceEdits[p.key] ?? ""}
                  onChange={(e) => setPriceEdits({ ...priceEdits, [p.key]: e.target.value })}
                  placeholder="e.g. £79/mo"
                  className="mt-2 w-full rounded-lg border border-line-2 bg-glass/5 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
                />
              </div>
            ))}
          </div>
          {priceMsg && <p className="mt-2 text-xs text-brand-400">{priceMsg}</p>}
        </Card>
      )}

      <div className="mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search hotels by name, city or admin email…"
          className="w-full max-w-md rounded-lg border border-line-2 bg-glass/5 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
        />
      </div>

      {filtered.length === 0 ? (
        <Card><p className="text-sm text-fg-faint">No hotels match &ldquo;{q}&rdquo;.</p></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map((h) => (
            <HotelCard key={h.id} hotel={h} features={features} plans={plans} onToggle={(k, v) => toggle(h.id, k, v)} onApplyPlan={(p) => applyPlan(h.id, p)} />
          ))}
        </div>
      )}
    </div>
  );
}
