"use client";

// Your plan, in plain terms: what you're on, what you're actually using of it,
// and exactly what each tier includes.
//
// The comparison table is rendered from the SAME registry the server enforces
// entitlements from, so this page can never promise something the app then
// blocks. Anything you can see here, you can hold us to.

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";

type PlanRow = {
  key: string;
  label: string;
  price_hint: string;
  price_annual_hint: string;
  blurb: string;
  max_users: number;
  highlights: string[];
  includes: Record<string, boolean>;
  ai_model_label: string;
  ai_daily_requests: number;
  ai_monthly_tokens: number;
  trial_days: number;
};

type FeatureRow = {
  key: string;
  label: string;
  description: string;
  is_ai: boolean;
  core: boolean;
  plans: Record<string, boolean>;
};

type Usage = {
  plan?: string;
  model?: string;
  month_calls?: number;
  month_tokens?: number;
  today_calls?: number;
  daily_limit?: number;
  monthly_token_limit?: number;
  included?: boolean;
};

function Meter({ used, cap, label }: { used: number; cap: number; label: string }) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  // amber past 75%, rose past 90% — you should see a wall coming, not hit it
  const tone = pct >= 90 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-brand-500";
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-fg-soft">{label}</span>
        <span className="text-fg-faint">
          {used.toLocaleString()} / {cap > 0 ? cap.toLocaleString() : "—"}
        </span>
      </div>
      <div className="mise-well mt-1.5 h-2 overflow-hidden rounded-full">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function PlanPage() {
  const { user } = useAuth();
  const isOwner = can(user?.role, "settings:write");

  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    Promise.all([
      api
        .get<{ features: FeatureRow[]; plans: PlanRow[] }>("/platform/plans/matrix")
        .then((d) => {
          setFeatures(d.features);
          setPlans(d.plans);
        }),
      api.get<Usage>("/assistant/usage").then(setUsage).catch(() => {}),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  const current = plans.find((p) => p.label === usage?.plan) ?? null;
  // AI first — it's the metered one, so it's what people actually wonder about
  const rows = showAll ? features : features.filter((f) => f.is_ai || !f.core);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Your plan"
        subtitle="What you're on, what you're using, and what each tier includes."
      />

      {/* where you stand today */}
      {current && (
        <Card className="mise-feel mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-faint">
                Current plan
              </p>
              <p className="mt-0.5 text-2xl font-semibold text-fg">{current.label}</p>
              <p className="text-sm text-fg-faint">
                {current.price_hint} · up to{" "}
                {current.max_users >= 100000 ? "unlimited" : current.max_users} users
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-fg-faint">AI model</p>
              <p className="mt-0.5 text-lg font-semibold text-brand-400">
                {current.ai_model_label}
              </p>
              <p className="text-xs text-fg-faint">
                {current.includes.ai_scan ? "chat + scanning" : "chat only"}
              </p>
            </div>
          </div>

          {usage && current.ai_daily_requests > 0 && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Meter
                label="AI calls today"
                used={usage.today_calls ?? 0}
                cap={usage.daily_limit ?? current.ai_daily_requests}
              />
              <Meter
                label="AI tokens this month"
                used={usage.month_tokens ?? 0}
                cap={usage.monthly_token_limit ?? current.ai_monthly_tokens}
              />
            </div>
          )}
        </Card>
      )}

      {/* the tiers */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        {plans.map((p) => {
          const mine = current?.key === p.key;
          return (
            <Card
              key={p.key}
              className={`mise-feel flex flex-col ${
                mine ? "border-brand-400/50 ring-1 ring-brand-400/30" : ""
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold text-fg">{p.label}</h3>
                {mine && (
                  <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-brand-300">
                    YOUR PLAN
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-fg-faint">{p.blurb}</p>
              <p className="mt-3 text-2xl font-semibold text-fg">
                {p.price_hint}
                <span className="ml-1.5 text-xs font-normal text-fg-faint">
                  or {p.price_annual_hint}
                </span>
              </p>
              <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-paper-2 px-2.5 py-1 text-[11px] text-fg-soft">
                ✦ AI on <b className="text-fg">{p.ai_model_label}</b>
                {p.ai_daily_requests > 0 && <span>· {p.ai_daily_requests}/day</span>}
              </p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm text-fg-soft">
                {p.highlights.map((h) => (
                  <li key={h} className="flex gap-2">
                    <span className="mt-0.5 shrink-0 text-brand-400">✓</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
              {!mine && isOwner && (
                <Link
                  href="/settings?tab=billing"
                  className="mise-press mt-4 rounded-xl bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-700"
                >
                  {p.trial_days > 0 ? `Try free for ${p.trial_days} days` : "Switch to this"}
                </Link>
              )}
            </Card>
          );
        })}
      </div>

      {/* the honest table */}
      <Card className="mise-feel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-fg">What each plan includes</h3>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-soft hover:bg-paper-2"
          >
            {showAll ? "Hide the basics" : `Show all ${features.length} features`}
          </button>
        </div>
        <p className="mt-1 text-xs text-fg-faint">
          Straight from the same list the app checks before it lets anyone in — so what you
          see here is what you get.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-fg-faint">
                <th className="py-2 pr-4 text-left font-medium">Feature</th>
                {plans.map((p) => (
                  <th key={p.key} className="px-3 py-2 text-center font-medium">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.key} className={`border-b border-line/60 ${f.is_ai ? "bg-brand-500/5" : ""}`}>
                  <td className="py-2 pr-4">
                    <span className="text-fg">
                      {f.is_ai && <span className="mr-1 text-brand-400">✦</span>}
                      {f.label}
                    </span>
                    <span className="block text-[11px] text-fg-faint">{f.description}</span>
                  </td>
                  {plans.map((p) => (
                    <td key={p.key} className="px-3 py-2 text-center">
                      {f.plans[p.key] ? (
                        <span className="text-emerald-400">✓</span>
                      ) : (
                        <span className="text-fg-faint/50">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
