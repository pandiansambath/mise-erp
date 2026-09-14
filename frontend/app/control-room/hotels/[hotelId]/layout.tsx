"use client";

// hotels/[hotelId] — identity + action bar + the four sub-tabs, rendered
// ONCE so nothing beneath it repeats a hotel's name or plan chip (rubric
// C5 · "ONE BORDER PER BOX" — pages below render bare sections, this is the
// only bordered frame around a hotel's own name).

import { use, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { API_BASE, api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EmptyState, Spinner } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { useFleet } from "@/components/controlroom/FleetProvider";
import { healthOf } from "@/components/controlroom/health";
import { openSupportView } from "@/components/controlroom/viewAs";
import { errorCopy } from "@/components/controlroom/useOperatorQuery";

const PLAN_CHIP_TONE: Record<string, string> = { starter: "slate", pro: "sky", enterprise: "tier" };

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

export default function HotelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ hotelId: string }>;
}) {
  const { hotelId } = use(params);
  const { user } = useAuth();
  const { hotels, loading, error, reload } = useFleet();
  const confirm = useConfirm();
  const pathname = usePathname();
  const [suspendBusy, setSuspendBusy] = useState(false);
  const [viewAsBusy, setViewAsBusy] = useState(false);

  if (!user?.is_platform_owner) return null; // flash-guard; layout above redirects

  if (loading && hotels.length === 0) return <Spinner />;
  if (error) return <ErrorCard title="Could not load the fleet" error={error} retry={reload} />;

  const hotel = hotels.find((h) => h.id === hotelId);
  if (!hotel) {
    return (
      <EmptyState
        chef={false}
        icon="?"
        title="Hotel not found"
        body="It may have been permanently deleted, or the link is wrong."
        action={
          <Link href="/control-room/fleet" className="mise-btn-flat mise-press px-3 py-1.5 text-xs font-semibold">
            Back to Hotels
          </Link>
        }
      />
    );
  }

  const hp = healthOf(hotel);
  const tabs = [
    { href: `/control-room/hotels/${hotelId}`, label: "Vitals", exact: true },
    { href: `/control-room/hotels/${hotelId}/activity`, label: "Activity", exact: false },
    { href: `/control-room/hotels/${hotelId}/ai`, label: "AI", exact: false },
    { href: `/control-room/hotels/${hotelId}/settings`, label: "Settings", exact: false },
  ];

  async function toggleSuspend() {
    const suspending = hotel!.is_active;
    const ok = await confirm({
      title: suspending ? `Suspend ${hotel!.name}?` : `Reactivate ${hotel!.name}?`,
      message: suspending
        ? "Every user of this hotel is blocked from logging in until you reactivate. No data is deleted."
        : "Users of this hotel will be able to log in again.",
      confirmText: suspending ? "Suspend hotel" : "Reactivate",
      tone: suspending ? "danger" : "default",
    });
    if (!ok) return;
    setSuspendBusy(true);
    try {
      await api.post(`/platform/hotels/${hotelId}/suspend`, { active: !suspending });
      reload();
    } finally {
      setSuspendBusy(false);
    }
  }

  async function viewAs() {
    setViewAsBusy(true);
    try {
      await openSupportView(hotelId);
    } finally {
      setViewAsBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="mise-card-inset p-4">
        <div className="flex flex-wrap items-start gap-3">
          {hotel.has_logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${API_BASE}/api/hotels/${hotel.id}/logo`}
              alt=""
              className="h-12 w-12 shrink-0 rounded-xl object-contain ring-1 ring-glass/15"
            />
          ) : (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-lg font-semibold text-brand-300 ring-1 ring-brand-400/30">
              {hotel.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-display text-xl font-semibold text-fg">{hotel.name}</h2>
              <span className="mise-chip" data-tone={PLAN_CHIP_TONE[hotel.plan] ?? "slate"}>
                {hotel.plan.toUpperCase()} {hotel.max_users >= 100000 ? "∞" : hotel.max_users}
              </span>
              <span className="mise-chip" data-tone={!hotel.is_active ? "red" : hp.tone}>
                {!hotel.is_active ? "suspended" : hp.label}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-fg-faint">
              {[hotel.city, hotel.country].filter(Boolean).join(" · ")} · {hotel.base_currency} · joined{" "}
              {new Date(hotel.created_at).toLocaleDateString()}
            </p>
            <p className="mt-0.5 truncate text-xs text-fg-soft">
              {hotel.admin_email ?? "no admin"} · {hotel.user_count}/{hotel.max_users >= 100000 ? "∞" : hotel.max_users} seats
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={viewAs}
              disabled={viewAsBusy}
              title="Open this hotel's app on a short-lived, read-only token (audited)"
              className="mise-btn-flat mise-press px-3 py-1.5 text-xs font-semibold text-fg-soft"
            >
              {viewAsBusy ? "Opening…" : "View as"}
            </button>
            <button
              type="button"
              onClick={toggleSuspend}
              disabled={suspendBusy}
              data-tone={hotel.is_active ? "danger" : "brand"}
              className="mise-btn-flat mise-press px-3 py-1.5 text-xs font-semibold"
            >
              {suspendBusy ? "…" : hotel.is_active ? "Suspend" : "Reactivate"}
            </button>
          </div>
        </div>
      </div>

      <nav
        aria-label={`${hotel.name} sections`}
        className="mise-well mise-noscrollbar flex w-fit max-w-full gap-1 overflow-x-auto rounded-2xl p-1.5"
      >
        {tabs.map((t) => {
          const on = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`mise-press shrink-0 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                on ? "mise-btn-key" : "text-fg-soft hover:bg-glass/[0.06] hover:text-brand-300"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
