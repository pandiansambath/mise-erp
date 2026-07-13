"use client";

// 🛰️ CONTROL ROOM — the Mise operator's cross-tenant console. Lists every hotel,
// lets us toggle per-hotel features (entitlements → future plan tiers) and reset
// any user's password. Gated to is_platform_owner (server-enforced too).

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, API_BASE, ApiError } from "@/lib/api";
import { Badge, Button, Card, PageHeader, Spinner, StatCard, Toggle } from "@/components/ui";
import { Donut, Sparkline } from "@/components/charts";
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
  last_active?: string | null; sales_entries_7d?: number; has_traded?: boolean;
};

/** Active = traded/logged in this week · Quiet = seen in 14d · Dormant = gone cold */
function healthOf(h: HotelRow): { label: string; tone: "green" | "amber" | "slate" } {
  const days = h.last_active ? (Date.now() - new Date(h.last_active).getTime()) / 86400000 : Infinity;
  if ((h.sales_entries_7d ?? 0) > 0 || days <= 3) return { label: "Active", tone: "green" };
  if (days <= 14) return { label: "Quiet", tone: "amber" };
  return { label: "Dormant", tone: "slate" };
}
type HotelUser = { id: string; email: string; role: string; is_active: boolean };

const PLAN_TONE: Record<string, "slate" | "amber" | "green"> = {
  starter: "slate", pro: "amber", enterprise: "green",
};

type Announcement = {
  id: string; message: string; level: string;
  expires_at: string | null; is_active: boolean; created_at: string | null;
};

/** The operator's own trail — every platform.* action, newest first. */
function OperatorAuditCard() {
  type Ev = { id: string; user_email: string; action: string; summary: string; created_at: string | null };
  const [events, setEvents] = useState<Ev[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api.get<{ events: Ev[] }>("/platform/audit").then((r) => setEvents(r.events)).catch(() => {});
  }, []);
  if (events.length === 0) return null;
  return (
    <Card className="mise-feel mb-6">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <h3 className="font-semibold text-fg">🧾 Operator audit trail</h3>
        <span className="text-xs text-fg-faint">{events.length} actions · {open ? "hide ▴" : "show ▾"}</span>
      </button>
      {open && (
        <ul className="mise-fade mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {events.map((e) => (
            <li key={e.id} className="mise-well flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-fg">{e.summary}</span>
              <span className="shrink-0 text-fg-faint">
                {e.user_email} · {e.created_at ? new Date(e.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** 📣 Broadcast a banner into every hotel's app shell. */
function AnnouncementsCard() {
  const confirm = useConfirm();
  const [list, setList] = useState<Announcement[]>([]);
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState<"info" | "warn">("info");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get<{ announcements: Announcement[] }>("/platform/announcements")
      .then((r) => setList(r.announcements))
      .catch(() => {});
  useEffect(() => { load(); }, []);

  async function send() {
    if (message.trim().length < 3) return;
    const ok = await confirm({
      title: "Broadcast to every hotel?",
      message: `This banner appears in ALL hotels' apps${expires ? ` until ${expires}` : " until you withdraw it"}.`,
      confirmText: "Broadcast",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.post("/platform/announcements", {
        message: message.trim(),
        level,
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      });
      setMessage("");
      setExpires("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(a: Announcement) {
    const ok = await confirm({
      title: "Withdraw this broadcast?",
      message: "It disappears from every hotel's app immediately.",
      confirmText: "Withdraw",
      tone: "danger",
    });
    if (!ok) return;
    await api.delete(`/platform/announcements/${a.id}`);
    await load();
  }

  return (
    <Card className="mise-feel mb-6">
      <h3 className="font-semibold text-fg">📣 Broadcast to all hotels</h3>
      <p className="text-xs text-fg-faint">a dismissible banner in every hotel&apos;s app — maintenance notices, new features, price changes</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            placeholder="e.g. Mise gets new charts tonight 22:00–22:15 — nothing you need to do."
            className="mise-well w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          />
        </div>
        <Toggle on={level === "warn"} onChange={(v) => setLevel(v ? "warn" : "info")} label="⚠ warning tone" />
        <label className="block">
          <span className="block text-[11px] text-fg-faint">Auto-expires (optional)</span>
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="mise-well mt-1 rounded-lg px-2.5 py-1.5 text-sm outline-none" />
        </label>
        <Button variant="primary" onClick={send} busy={busy} disabled={message.trim().length < 3}>
          Broadcast
        </Button>
      </div>
      {list.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {list.slice(0, 6).map((a) => (
            <li key={a.id} className="mise-well flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-fg">
                {a.level === "warn" ? "⚠️" : "📣"} {a.message}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {a.is_active ? <Badge tone="green">live</Badge> : <Badge tone="slate">off</Badge>}
                {a.expires_at && <span className="text-[11px] text-fg-faint">until {a.expires_at.slice(0, 10)}</span>}
                {a.is_active && (
                  <button type="button" onClick={() => withdraw(a)} className="mise-press rounded-md border border-rose-500/40 px-2 py-0.5 text-xs text-rose-300 hover:bg-rose-500/10">
                    withdraw
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HotelCard({
  hotel, features, plans, onToggle, onApplyPlan, onSuspend,
}: {
  hotel: HotelRow;
  features: FeatureDef[];
  plans: PlanDef[];
  onToggle: (key: string, value: boolean) => Promise<void>;
  onApplyPlan: (plan: string) => Promise<void>;
  onSuspend: (active: boolean) => Promise<void>;
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
  const [suspendBusy, setSuspendBusy] = useState(false);

  async function toggleSuspend() {
    const suspending = hotel.is_active;
    const ok = await confirm({
      title: suspending ? `Suspend ${hotel.name}?` : `Reactivate ${hotel.name}?`,
      message: suspending
        ? "Every user of this hotel is blocked from logging in until you reactivate. No data is deleted."
        : "Users of this hotel will be able to log in again.",
      confirmText: suspending ? "Suspend hotel" : "Reactivate",
      tone: suspending ? "danger" : "default",
    });
    if (!ok) return;
    setSuspendBusy(true);
    try { await onSuspend(!suspending); } finally { setSuspendBusy(false); }
  }

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
    <Card className="mise-feel space-y-4">
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
            <Badge tone={healthOf(hotel).tone}>{healthOf(hotel).label}</Badge>
            {!hotel.is_active && <Badge tone="red">suspended</Badge>}
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
      <div className="mise-well rounded-xl p-3">
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
            className="mise-press rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {planBusy ? "Applying…" : "Apply plan"}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-fg-faint">
          Applying a plan sets its feature preset + user limit. You can still fine-tune individual toggles below.
        </p>
      </div>

      {/* feature toggles */}
      <div className="mise-well rounded-xl p-3">
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

      {/* password reset + suspend */}
      <div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openReset}
            className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-fg-soft"
          >
            🔑 {resetOpen ? "Close" : "Reset a password"}
          </button>
          <button
            type="button"
            title="Open this hotel's app on a 15-minute READ-ONLY token (audited)"
            onClick={async () => {
              const r = await api.post<{ token: string }>(`/platform/hotels/${hotel.id}/impersonate`, {});
              window.open(`/impersonate#t=${encodeURIComponent(r.token)}`, "_blank", "noopener");
            }}
            className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-violet-300"
          >
            👁 View as
          </button>
          <button
            type="button"
            onClick={toggleSuspend}
            disabled={suspendBusy}
            className={`mise-press rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
              hotel.is_active
                ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                : "border-brand-500/40 bg-brand-500/10 text-brand-300 hover:bg-brand-500/20"
            }`}
          >
            {suspendBusy ? "…" : hotel.is_active ? "⛔ Suspend" : "▶ Reactivate"}
          </button>
        </div>
        {resetOpen && (
          <div className="mise-fade mise-well mt-3 space-y-2 rounded-xl p-3">
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
                    className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={submitReset}
                  disabled={busy || !targetId || pw.length < 8}
                  className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
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
  const [sel, setSel] = useState<string | null>(null); // drawer: the hotel under the glass
  const [healthFilter, setHealthFilter] = useState<"all" | "Active" | "Quiet" | "Dormant" | "suspended">("all");
  const [sortKey, setSortKey] = useState<"name" | "health" | "last" | "sales" | "users">("health");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  // the console clock — UTC, ticking
  const [utc, setUtc] = useState("");
  const [nowTs] = useState(() => Date.now()); // frozen at mount — render-pure "days ago" math
  useEffect(() => {
    const tick = () => setUtc(new Date().toISOString().slice(11, 19));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

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

  async function suspend(hotelId: string, active: boolean) {
    const res = await api.post<{ is_active: boolean }>(`/platform/hotels/${hotelId}/suspend`, { active });
    setHotels((hs) => hs.map((h) => (h.id === hotelId ? { ...h, is_active: res.is_active } : h)));
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
    const rank: Record<string, number> = { Active: 0, Quiet: 1, Dormant: 2 };
    let list = hotels.filter(
      (h) =>
        !s ||
        h.name.toLowerCase().includes(s) ||
        (h.admin_email ?? "").toLowerCase().includes(s) ||
        (h.city ?? "").toLowerCase().includes(s),
    );
    if (healthFilter === "suspended") list = list.filter((h) => !h.is_active);
    else if (healthFilter !== "all") list = list.filter((h) => h.is_active && healthOf(h).label === healthFilter);
    const val = (h: HotelRow): number | string => {
      if (sortKey === "name") return h.name.toLowerCase();
      if (sortKey === "health") return rank[healthOf(h).label] ?? 3;
      if (sortKey === "last") return h.last_active ? -new Date(h.last_active).getTime() : Infinity;
      if (sortKey === "sales") return -(h.sales_entries_7d ?? 0);
      return -h.user_count;
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
    });
  }, [hotels, q, healthFilter, sortKey, sortDir]);

  if (!user?.is_platform_owner) return <Spinner />; // layout redirects; this is a flash-guard
  if (loading) return <Spinner />;

  const totalUsers = hotels.reduce((s, h) => s + h.user_count, 0);
  const aiOn = hotels.filter((h) => h.features["ai_copilot"] !== false).length;
  const active = hotels.filter((h) => h.is_active).length;

  return (
    <div className="mise-cr-grid -m-4 p-4 sm:-m-6 sm:p-6">
      {/* the console strip — mono, dense, always-on telemetry */}
      <div className="mise-well mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
        <span className="flex items-center gap-2 text-fg">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand-400" />
          MISE CONTROL
        </span>
        <span>fleet {hotels.length}</span>
        <span className="text-brand-300">{active} up</span>
        {hotels.length - active > 0 && <span className="text-rose-300">{hotels.length - active} suspended</span>}
        <span className="ml-auto tabular-nums">{utc} UTC</span>
      </div>
      <PageHeader title="All hotels" subtitle="Every restaurant on Mise — flip features, reset access, all in one place." />

      {err && <Card className="mb-4"><p className="text-sm text-rose-400">{err}</p></Card>}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Hotels" value={String(hotels.length)} accent="brand" hint={`${active} active`} />
        <StatCard label="Total users" value={String(totalUsers)} accent="slate" />
        <StatCard label="AI enabled" value={`${aiOn}/${hotels.length}`} accent="copper" hint="Ask Mise" />
        <StatCard label="Features" value={String(features.length)} accent="amber" hint="per hotel" />
      </div>

      {/* platform analytics — computed live from the fleet */}
      {hotels.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="mise-feel">
            <h3 className="font-semibold text-fg">Signups — last 12 months</h3>
            <p className="text-xs text-fg-faint">new hotels joining Mise per month</p>
            {(() => {
              const now = new Date();
              const months: string[] = [];
              for (let i = 11; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
              }
              const counts = months.map(
                (m) => hotels.filter((h) => h.created_at.slice(0, 7) === m).length,
              );
              return (
                <div className="mise-well mt-4 rounded-xl p-4">
                  <Sparkline data={counts} height={56} className="w-full" />
                  <div className="mt-2 flex justify-between text-[10px] text-fg-faint">
                    <span>{months[0]}</span>
                    <span>{counts.reduce((s, n) => s + n, 0)} total</span>
                    <span>{months[11]}</span>
                  </div>
                </div>
              );
            })()}
          </Card>
          <Card className="mise-feel">
            <h3 className="font-semibold text-fg">Fleet by plan</h3>
            <p className="text-xs text-fg-faint">who&apos;s on which tier</p>
            <div className="mt-4">
              <Donut
                centerLabel="hotels"
                centerValue={String(hotels.length)}
                segments={[
                  { label: "Starter", value: hotels.filter((h) => h.plan === "starter").length, color: "#94a3b8" },
                  { label: "Pro", value: hotels.filter((h) => h.plan === "pro").length, color: "#f59e0b" },
                  { label: "Enterprise", value: hotels.filter((h) => h.plan === "enterprise").length, color: "#10b981" },
                ].filter((s) => s.value > 0)}
              />
            </div>
          </Card>
        </div>
      )}

      {hotels.length > 0 && (
        <Card className="mise-feel mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-fg">Signup funnel</h3>
            <span className="text-xs text-fg-faint">signed up → actually trading</span>
          </div>
          {(() => {
            const traded = hotels.filter((h) => h.has_traded).length;
            const pct = hotels.length > 0 ? (traded / hotels.length) * 100 : 0;
            return (
              <div className="mt-4 space-y-2">
                <div className="mise-well flex items-center justify-between rounded-xl px-4 py-2.5 text-sm">
                  <span className="text-fg-soft">Signed up</span>
                  <b className="font-mono text-fg">{hotels.length}</b>
                </div>
                <div className="mise-well relative overflow-hidden rounded-xl px-4 py-2.5 text-sm">
                  <span aria-hidden className="absolute inset-y-0 left-0 bg-brand-500/15 transition-all duration-700" style={{ width: `${pct}%` }} />
                  <span className="relative flex items-center justify-between">
                    <span className="text-fg-soft">Recorded their first sale</span>
                    <b className="font-mono text-brand-300">{traded} · {pct.toFixed(0)}%</b>
                  </span>
                </div>
                {hotels.length - traded > 0 && (
                  <p className="text-[11px] text-fg-faint">
                    {hotels.length - traded} hotel{hotels.length - traded === 1 ? " is" : "s are"} stalled at an empty dashboard — a call away from activating.
                  </p>
                )}
              </div>
            );
          })()}
        </Card>
      )}

      <OperatorAuditCard />

      <AnnouncementsCard />

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
              className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {savingPrices ? "Saving…" : "Save prices"}
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {plans.map((p) => (
              <div key={p.key} className="mise-well rounded-xl p-3">
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
                  className="mise-well mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
            ))}
          </div>
          {priceMsg && <p className="mt-2 text-xs text-brand-400">{priceMsg}</p>}
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search hotels by name, city or admin email…"
          className="mise-well w-full max-w-md rounded-lg px-3 py-2 text-sm outline-none"
        />
        {(["all", "Active", "Quiet", "Dormant", "suspended"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setHealthFilter(f)}
            className={`mise-press rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide transition ${
              healthFilter === f ? "mise-raised text-fg" : "text-fg-faint hover:text-fg-soft"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card><p className="text-sm text-fg-faint">No hotels match.</p></Card>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  {(
                    [
                      ["name", "Hotel"],
                      ["health", "Status"],
                      ["last", "Last active"],
                      ["sales", "Sales 7d"],
                      ["users", "Users"],
                    ] as const
                  ).map(([k, label]) => (
                    <th key={k} className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
                          else {
                            setSortKey(k);
                            setSortDir(1);
                          }
                        }}
                        className="uppercase tracking-[0.14em] hover:text-fg-soft"
                      >
                        {label} {sortKey === k ? (sortDir === 1 ? "↑" : "↓") : ""}
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-2.5">Plan</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((h) => {
                  const hp = healthOf(h);
                  const days = h.last_active
                    ? Math.max(0, Math.floor((nowTs - new Date(h.last_active).getTime()) / 86400000))
                    : null;
                  return (
                    <tr
                      key={h.id}
                      onClick={() => setSel(h.id)}
                      className={`cursor-pointer border-b border-line transition hover:bg-glass/5 ${!h.is_active ? "opacity-60" : ""}`}
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-fg">{h.name}</p>
                        <p className="text-[11px] text-fg-faint">
                          {h.city ? `${h.city} · ` : ""}
                          {h.admin_email ?? "no admin"}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        {!h.is_active ? <Badge tone="red">suspended</Badge> : <Badge tone={hp.tone}>{hp.label}</Badge>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-fg-soft">
                        {days == null ? "never" : days === 0 ? "today" : `${days}d ago`}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-fg-soft">{h.sales_entries_7d ?? 0}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-fg-soft">
                        {h.user_count}/{h.max_users >= 100000 ? "∞" : h.max_users}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="rounded-full bg-glass/10 px-2 py-0.5 font-mono text-[10px] uppercase text-fg-soft">
                          {h.plan}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-fg-faint">›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* the drawer: one hotel under the glass, full controls */}
      {sel && (() => {
        const h = hotels.find((x) => x.id === sel);
        if (!h) return null;
        return (
          <>
            <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onClick={() => setSel(null)} aria-hidden />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Manage ${h.name}`}
              className="mise-drawer-in fixed inset-y-0 right-0 z-50 w-[32rem] max-w-full overflow-y-auto overscroll-contain border-l border-glass/15 bg-shell p-4 shadow-2xl shadow-black/60"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">Hotel console</p>
                <button type="button" onClick={() => setSel(null)} className="mise-press rounded-lg px-2 py-1 text-fg-faint hover:text-fg" aria-label="Close">
                  ✕
                </button>
              </div>
              <HotelCard
                hotel={h}
                features={features}
                plans={plans}
                onToggle={(k, v) => toggle(h.id, k, v)}
                onApplyPlan={(pl) => applyPlan(h.id, pl)}
                onSuspend={(a) => suspend(h.id, a)}
              />
            </div>
          </>
        );
      })()}
    </div>
  );
}
