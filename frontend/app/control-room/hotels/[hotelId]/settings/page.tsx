"use client";

// hotels/[hotelId]/settings — plan, features, access, danger zone.
//
// The hotel's name and plan chip already live in the layout above this page
// (rubric C5) — everything here is controls, never a repeat of identity.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, Spinner, Toggle } from "@/components/ui";
import { Select } from "@/components/Select";
import { DeleteHotel } from "@/components/DeleteHotel";
import { useConfirm } from "@/components/confirm";
import { useFleet } from "@/components/controlroom/FleetProvider";
import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";

type HotelUser = { id: string; email: string; role: string; is_active: boolean };

/** The 34 features, grouped for a master/detail pane (AccessModal.tsx style)
 *  instead of one flat scrolling list of switches. Read straight from
 *  backend/app/platform_admin/features.py's own section comments — there is
 *  no `group` field on the wire, so this names the same six clusters the
 *  registry is already written in. Anything the backend adds later that
 *  isn't in this map still renders, under "Other". */
const FEATURE_GROUPS: { key: string; label: string; keys: string[] }[] = [
  { key: "core", label: "Core", keys: ["dashboard", "inventory", "vendors", "purchasing", "recipes", "sales", "expenses", "reports", "settings"] },
  { key: "ops", label: "Operations", keys: ["waste", "stock_take", "price_comparison", "party_orders", "money"] },
  { key: "compliance", label: "Compliance", keys: ["food_safety", "allergens", "documents", "audit"] },
  { key: "people", label: "People", keys: ["employees", "attendance", "rota", "payroll", "self_service", "hiring", "talent"] },
  { key: "guests", label: "Guests & platform", keys: ["ordering", "delivery", "branded_site", "multi_site", "api_access"] },
  { key: "ai", label: "AI", keys: ["ai_copilot", "ai_scan", "ai_insights", "ai_web"] },
];

function ErrorCard({ title, error, retry }: { title: string; error: ApiError; retry: () => void }) {
  return (
    <div className="mise-card-inset relative flex items-start gap-3 overflow-hidden p-4 pl-5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-rose-400" />
      <span className="font-mono text-2xl font-bold leading-none text-danger">{error.status || "!"}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-soft">{errorCopy(error)}</p>
      </div>
      <button type="button" onClick={retry} className="mise-btn-flat mise-press shrink-0 px-3 py-1.5 text-xs font-semibold">
        Retry
      </button>
    </div>
  );
}

export default function HotelSettingsPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = use(params);
  const { user } = useAuth();
  const router = useRouter();
  const confirm = useConfirm();
  const { hotels, features, plans, loading, error, reload } = useFleet();
  const usersQ = useOperatorQuery<{ users: HotelUser[] }>(`/platform/hotels/${hotelId}/users`);

  const hotel = hotels.find((h) => h.id === hotelId);

  const [planSel, setPlanSel] = useState(hotel?.plan ?? "");
  const [planBusy, setPlanBusy] = useState(false);
  const [planMsg, setPlanMsg] = useState<string | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);

  const [comp, setComp] = useState(Boolean(hotel?.is_comp));
  const [aiDay, setAiDay] = useState(hotel?.ai_daily_override ? String(hotel.ai_daily_override) : "");
  const [aiMonth, setAiMonth] = useState(hotel?.ai_monthly_override ? String(hotel.ai_monthly_override) : "");
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagMsg, setFlagMsg] = useState<string | null>(null);
  const [flagErr, setFlagErr] = useState<string | null>(null);

  const [group, setGroup] = useState(FEATURE_GROUPS[0].key);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toggleErr, setToggleErr] = useState<{ key: string; msg: string } | null>(null);

  const [targetId, setTargetId] = useState("");
  const [pw, setPw] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetErr, setResetErr] = useState<string | null>(null);

  // Keep the editors in step if the hotel row changes underneath us (another
  // tab, or our own reload() after a save).
  useEffect(() => {
    if (!hotel) return;
    setPlanSel(hotel.plan);
    setComp(Boolean(hotel.is_comp));
    setAiDay(hotel.ai_daily_override ? String(hotel.ai_daily_override) : "");
    setAiMonth(hotel.ai_monthly_override ? String(hotel.ai_monthly_override) : "");
  }, [hotel]);

  useEffect(() => {
    if (usersQ.data && !targetId) {
      const admin = usersQ.data.users.find((u) => u.email === hotel?.admin_email) ?? usersQ.data.users[0];
      if (admin) setTargetId(admin.id);
    }
  }, [usersQ.data, hotel?.admin_email, targetId]);

  if (!user?.is_platform_owner) return null;
  if (loading && hotels.length === 0) return <Spinner />;
  if (error) return <ErrorCard title="Could not load the fleet" error={error} retry={reload} />;
  if (!hotel) return null; // the hotel layout above already renders the not-found state

  async function applyPlan() {
    const p = plans.find((x) => x.key === planSel);
    const ok = await confirm({
      title: `Move ${hotel!.name} to ${p?.label ?? planSel}?`,
      message: "This applies that plan's feature preset. You can still fine-tune individual toggles below afterwards.",
      confirmText: "Apply plan",
    });
    if (!ok) return;
    setPlanBusy(true);
    setPlanMsg(null);
    setPlanErr(null);
    try {
      await api.post(`/platform/hotels/${hotelId}/plan`, { plan: planSel });
      reload();
      setPlanMsg("Applied ✓");
    } catch (e) {
      setPlanErr(e instanceof ApiError ? e.message : "Could not apply that plan.");
    } finally {
      setPlanBusy(false);
    }
  }

  async function saveFlags() {
    setFlagBusy(true);
    setFlagMsg(null);
    setFlagErr(null);
    try {
      await api.patch(`/platform/hotels/${hotelId}/flags`, {
        is_comp: comp,
        // Blank means "use the plan", not zero — sending 0 would mean no AI.
        ai_daily_override: aiDay ? Number(aiDay) : 0,
        ai_monthly_override: aiMonth ? Number(aiMonth) : 0,
      });
      reload();
      setFlagMsg("Saved ✓");
    } catch (e) {
      setFlagErr(e instanceof ApiError ? e.message : "Could not save.");
    } finally {
      setFlagBusy(false);
    }
  }

  async function doToggle(key: string, value: boolean) {
    setBusyKey(key);
    setToggleErr(null);
    try {
      await api.patch(`/platform/hotels/${hotelId}/features`, { features: { [key]: value } });
      reload();
    } catch (e) {
      setToggleErr({ key, msg: e instanceof ApiError ? e.message : "Could not save that." });
    } finally {
      setBusyKey(null);
    }
  }

  async function submitReset() {
    if (!targetId || pw.length < 8) return;
    const who = usersQ.data?.users.find((u) => u.id === targetId)?.email ?? "this user";
    const ok = await confirm({
      title: "Reset this password?",
      message: `Set a new password for ${who} at ${hotel!.name}. They'll need the new password to log in.`,
      confirmText: "Reset password",
    });
    if (!ok) return;
    setResetBusy(true);
    setResetErr(null);
    setResetMsg(null);
    try {
      const res = await api.post<{ ok: boolean; email: string }>(`/platform/hotels/${hotelId}/reset-password`, {
        user_id: targetId,
        new_password: pw,
      });
      setResetMsg(`Password updated for ${res.email}. Share "${pw}" with them securely.`);
      setPw("");
    } catch (e) {
      setResetErr(e instanceof ApiError ? e.message : "Could not reset password.");
    } finally {
      setResetBusy(false);
    }
  }

  const currentGroup = FEATURE_GROUPS.find((g) => g.key === group) ?? FEATURE_GROUPS[0];
  const groupFeatures = currentGroup.keys
    .map((k) => features.find((f) => f.key === k))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));
  const knownKeys = new Set(FEATURE_GROUPS.flatMap((g) => g.keys));
  const otherFeatures = features.filter((f) => !knownKeys.has(f.key));
  const groupsShown =
    otherFeatures.length > 0 ? [...FEATURE_GROUPS, { key: "other", label: "Other", keys: otherFeatures.map((f) => f.key) }] : FEATURE_GROUPS;
  const activeFeatures = group === "other" ? otherFeatures : groupFeatures;

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle="Plan, entitlements, access and the danger zone." />

      {/* Subscription — plan + operator overrides, two mise-well blocks in
          ONE bordered card (material law: one border per box). */}
      <section className="mise-card-inset space-y-3 p-4">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">Subscription</h3>

        <div className="mise-well rounded-xl p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Plan</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[10rem] flex-1">
              <Select
                value={planSel}
                onChange={setPlanSel}
                options={plans.map((p) => ({ value: p.key, label: `${p.label} · ${p.price_hint}` }))}
              />
            </div>
            <button
              type="button"
              onClick={applyPlan}
              disabled={planBusy}
              data-tone="brand"
              className="mise-btn-flat mise-press px-3 py-2 text-xs font-semibold"
            >
              {planBusy ? "Applying…" : "Apply plan"}
            </button>
          </div>
          {planMsg && <p className="mt-1.5 text-[11px] text-brand-300">{planMsg}</p>}
          {planErr && <p className="mt-1.5 text-[11px] text-rose-300">{planErr}</p>}
        </div>

        <div className="mise-well rounded-xl p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Operator overrides</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-xs text-fg-soft">
              <input type="checkbox" checked={comp} onChange={(e) => setComp(e.target.checked)} className="h-4 w-4 accent-amber-500" />
              <span>
                Comped account
                <span className="block text-[10px] text-fg-faint">full access, never billed, excluded from revenue</span>
              </span>
            </label>
            <label className="text-xs text-fg-soft">
              <span className="block">AI calls/day</span>
              <input
                value={aiDay}
                onChange={(e) => setAiDay(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="plan default"
                className="mise-well mt-1 w-28 rounded-lg px-2.5 py-1.5 text-fg outline-none"
              />
            </label>
            <label className="text-xs text-fg-soft">
              <span className="block">AI tokens/month</span>
              <input
                value={aiMonth}
                onChange={(e) => setAiMonth(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="plan default"
                className="mise-well mt-1 w-32 rounded-lg px-2.5 py-1.5 text-fg outline-none"
              />
            </label>
            <button type="button" onClick={saveFlags} disabled={flagBusy} className="mise-btn-flat mise-press px-3 py-2 text-xs font-semibold">
              {flagBusy ? "Saving…" : "Save overrides"}
            </button>
          </div>
          {flagMsg && <p className="mt-1.5 text-[11px] text-brand-300">{flagMsg}</p>}
          {flagErr && <p className="mt-1.5 text-[11px] text-rose-300">{flagErr}</p>}
        </div>
      </section>

      {/* Features — master/detail per AccessModal.tsx, not a 34-row scroll. */}
      <section className="mise-card-inset p-0">
        <div className="flex items-baseline justify-between gap-3 p-4 pb-0">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">Features</h3>
          <span className="font-mono text-[11px] tabular-nums text-fg-faint">
            {features.filter((f) => hotel!.features[f.key] !== false).length} of {features.length} on
          </span>
        </div>
        <div className="mt-3 grid sm:grid-cols-[12rem_1fr]">
          <nav className="mise-noscrollbar flex shrink-0 gap-1 overflow-x-auto border-t border-line p-2 sm:flex-col sm:overflow-y-auto sm:border-r sm:border-t-0">
            {groupsShown.map((g) => {
              const on = g.key === group;
              const gFeatures = g.keys.map((k) => features.find((f) => f.key === k)).filter((f): f is NonNullable<typeof f> => Boolean(f));
              const live = gFeatures.filter((f) => hotel!.features[f.key] !== false).length;
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGroup(g.key)}
                  className={`mise-press flex shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition sm:shrink ${
                    on ? "mise-btn-key" : "text-fg-soft hover:bg-glass/[0.06]"
                  }`}
                >
                  <span className="whitespace-nowrap">{g.label}</span>
                  <span className={`shrink-0 font-mono text-[10px] tabular-nums ${on ? "text-white/80" : "text-fg-faint"}`}>
                    {live}/{gFeatures.length}
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="min-w-0 space-y-2 p-3">
            {activeFeatures.map((f) => {
              const on = hotel!.features[f.key] !== false;
              return (
                <div key={f.key}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm text-fg">{f.label}</span>
                      <span className="block truncate text-[11px] text-fg-faint">{f.description}</span>
                    </span>
                    <Toggle on={on} disabled={busyKey === f.key} onChange={(v) => doToggle(f.key, v)} />
                  </div>
                  {toggleErr?.key === f.key && <p className="mt-1 text-[11px] text-rose-300">{toggleErr.msg}</p>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Access — reset a user's password. */}
      <section className="mise-card-inset space-y-3 p-4">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">Access</h3>
        {usersQ.loading && !usersQ.data ? (
          <Spinner />
        ) : usersQ.error ? (
          <ErrorCard title="Could not load this hotel's users" error={usersQ.error} retry={usersQ.reload} />
        ) : (usersQ.data?.users.length ?? 0) === 0 ? (
          <p className="text-sm text-fg-faint">No users in this hotel.</p>
        ) : (
          <div className="mise-well space-y-2 rounded-xl p-3">
            <div>
              <label className="block text-xs font-medium text-fg-faint">User</label>
              <div className="mt-1">
                <Select
                  value={targetId}
                  onChange={setTargetId}
                  options={(usersQ.data?.users ?? []).map((u) => ({ value: u.id, label: `${u.email} · ${u.role.replace(/_/g, " ")}` }))}
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
              disabled={resetBusy || !targetId || pw.length < 8}
              data-tone="brand"
              className="mise-btn-flat mise-press px-4 py-2 text-sm font-semibold"
            >
              {resetBusy ? "Setting…" : "Set password"}
            </button>
            {resetMsg && <p className="text-xs text-brand-300">{resetMsg}</p>}
            {resetErr && <p className="text-xs text-rose-300">{resetErr}</p>}
          </div>
        )}
      </section>

      {/* Danger zone — deliberately last and quiet. Reused as-is: it already
          counts what would be destroyed and requires typing the handle. */}
      <section className="mise-card-inset p-4">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">Danger zone</h3>
        <DeleteHotel
          hotelId={hotelId}
          hotelName={hotel.name}
          handle={hotel.handle}
          onDeleted={() => {
            reload();
            router.replace("/control-room/fleet");
          }}
        />
      </section>
    </div>
  );
}
