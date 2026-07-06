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
type HotelRow = {
  id: string; name: string; city: string | null; country: string; base_currency: string;
  created_at: string; has_logo: boolean; is_active: boolean;
  user_count: number; admin_email: string | null; features: Record<string, boolean>;
};
type HotelUser = { id: string; email: string; role: string; is_active: boolean };

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
  hotel, features, onToggle,
}: {
  hotel: HotelRow;
  features: FeatureDef[];
  onToggle: (key: string, value: boolean) => Promise<void>;
}) {
  const confirm = useConfirm();
  const [resetOpen, setResetOpen] = useState(false);
  const [users, setUsers] = useState<HotelUser[] | null>(null);
  const [targetId, setTargetId] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

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
            {!hotel.is_active && <Badge tone="red">inactive</Badge>}
          </div>
          <p className="truncate text-xs text-fg-faint">
            {[hotel.city, hotel.country].filter(Boolean).join(" · ")} · {hotel.base_currency} · joined {created}
          </p>
          <p className="mt-0.5 truncate text-xs text-fg-soft">
            👤 {hotel.admin_email ?? "—"} · {hotel.user_count} user{hotel.user_count === 1 ? "" : "s"}
          </p>
        </div>
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
  const [hotels, setHotels] = useState<HotelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const [f, h] = await Promise.all([
      api.get<{ features: FeatureDef[] }>("/platform/features"),
      api.get<{ hotels: HotelRow[] }>("/platform/hotels"),
    ]);
    setFeatures(f.features);
    setHotels(h.hotels);
  }, []);

  useEffect(() => {
    if (!user?.is_platform_owner) { setLoading(false); return; }
    load().catch(() => setErr("Could not load the Control Room.")).finally(() => setLoading(false));
  }, [load, user]);

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

  if (!user?.is_platform_owner) {
    return (
      <div>
        <PageHeader title="Control Room" subtitle="Platform operators only" />
        <Card><p className="text-sm text-fg-soft">You don&apos;t have access to the Control Room. This area is for the Mise operator.</p></Card>
      </div>
    );
  }
  if (loading) return <Spinner />;

  const totalUsers = hotels.reduce((s, h) => s + h.user_count, 0);
  const aiOn = hotels.filter((h) => h.features["ai_copilot"] !== false).length;
  const active = hotels.filter((h) => h.is_active).length;

  return (
    <div>
      <PageHeader title="🛰️ Control Room" subtitle="Every hotel on Mise — features, access & support in one place." />

      {err && <Card className="mb-4"><p className="text-sm text-rose-400">{err}</p></Card>}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Hotels" value={String(hotels.length)} accent="brand" hint={`${active} active`} />
        <StatCard label="Total users" value={String(totalUsers)} accent="slate" />
        <StatCard label="AI enabled" value={`${aiOn}/${hotels.length}`} accent="copper" hint="Ask Mise" />
        <StatCard label="Features" value={String(features.length)} accent="amber" hint="per hotel" />
      </div>

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
            <HotelCard key={h.id} hotel={h} features={features} onToggle={(k, v) => toggle(h.id, k, v)} />
          ))}
        </div>
      )}
    </div>
  );
}
